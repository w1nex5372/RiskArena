import "reflect-metadata";
import { Room, Client } from "colyseus";
import axios from "axios";
import { ArenaState, Player } from "../schemas/ArenaState";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const SKIP_AUTH = process.env.SKIP_AUTH === "true";

// ── Game constants ────────────────────────────────────────────────────────────
const ARENA_WIDTH = 800;
const FLOOR_Y = 360;
const PLAYER_SPEED = 4;           // units per tick
const GRAVITY = 1.5;              // applied every tick
const JUMP_VELOCITY = -20;        // negative = upward
const JUMP_COOLDOWN_MS = 800;
const ATTACK_RANGE = 90;          // px distance for melee hit

// ── Ability constants ─────────────────────────────────────────────────────────
const BASH_RANGE = 120;
const BASH_DMG = 20;
const BASH_STUN_MS = 1500;
const BASH_COOLDOWN_MS = 8000;

const FIREBALL_DMG = 25;
const FIREBALL_KNOCKBACK = 100;
const FIREBALL_COOLDOWN_MS = 6000;

const BLINK_OFFSET = 80;          // teleport this far past the opponent
const BLINK_COOLDOWN_MS = 5000;
const ATTACK_DMG_MIN = 15;
const ATTACK_DMG_MAX = 25;
const ATTACK_COOLDOWN_MS = 600;
const ATTACK_ANIM_MS = 250;       // how long "attacking" state lasts
const HURT_ANIM_MS = 300;
const ACTIVE_BLOCK_REDUCTION = 0.65;
const TICK_MS = 66;               // ~15 FPS
const COUNTDOWN_SECS = 3;
const FINISH_CLEANUP_MS = 12_000; // room lives 12s after match ends

const CLASS_HP: Record<string, number> = {
  warrior: 150,
  mage: 100,
  rogue: 120,
};

// Starting X positions for slot 0 (left) and slot 1 (right)
const SLOT_START_X = [150, 650];

// ─────────────────────────────────────────────────────────────────────────────

export class ArenaRoom extends Room<ArenaState> {
  maxClients = 2;
  private lastJumpTime: Map<string, number> = new Map();

  onCreate(_options: any) {
    this.setState(new ArenaState());
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    // Client sends its current input state (held keys)
    this.onMessage("input", (client, data: {
      left: boolean; right: boolean; attack: boolean; ability: boolean; up: boolean; block?: boolean
    }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && this.state.phase === "battle") {
        player.inputState = {
          left: !!data.left,
          right: !!data.right,
          attack: !!data.attack,
          ability: !!data.ability,
          up: !!data.up,
          block: !!data.block,
        };
      }
    });
  }

  // ── Auth: validate session token against FastAPI ────────────────────────────
  async onAuth(_client: Client, options: { sessionToken?: string; devUsername?: string }) {
    if (SKIP_AUTH) {
      // In dev mode: try to get the real user via session token so loadout fetch works.
      // Falls back to a placeholder if the backend isn't reachable.
      if (options.sessionToken) {
        try {
          const res = await axios.get(`${FASTAPI_URL}/api/me`, {
            headers: { Authorization: `Bearer ${options.sessionToken}` },
            timeout: 3000,
          });
          return res.data;
        } catch {}
      }
      return {
        id: "dev-user-1",
        first_name: options.devUsername || "Player",
        class_name: "warrior",
      };
    }

    const token = options?.sessionToken;
    if (!token) throw new Error("No session token provided");

    try {
      const res = await axios.get(`${FASTAPI_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      return res.data;
    } catch (err: any) {
      throw new Error("Invalid or expired session");
    }
  }

  onJoin(client: Client, _options: any, auth: any) {
    const player = new Player();
    player.sessionId = client.sessionId;
    player.userId = String(auth?.id ?? auth?.user_id ?? client.sessionId);
    player.username = auth?.first_name || auth?.username || "Player";
    player.characterClass = (auth?.class_name || "warrior").toLowerCase();
    player.characterBuildJson = JSON.stringify(auth?.character_build_json || {});
    player.battleSpritesheetPath = String(auth?.character_spritesheet_path || "");
    player.battleSpritesheetHash = String(auth?.character_spritesheet_hash || "");
    player.slotIndex = this.state.players.size; // 0 = left, 1 = right
    player.x = SLOT_START_X[player.slotIndex] ?? 400;
    player.y = FLOOR_Y;
    player.facingRight = player.slotIndex === 0;
    player.maxHp = CLASS_HP[player.characterClass] ?? 100;
    player.hp = player.maxHp;

    // Fetch equipment bonuses (fire-and-forget but applied before battle starts)
    this.fetchAndApplyLoadout(player).catch(() => {});

    this.state.players.set(client.sessionId, player);

    console.log(`[ArenaRoom] ${player.username} joined (slot ${player.slotIndex})`);

    if (this.state.players.size === 2) {
      this.startCountdown();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const leaving = this.state.players.get(client.sessionId);

    if (!consented && leaving && (this.state.phase === "battle" || this.state.phase === "countdown")) {
      // Mark player as disconnected visually
      leaving.state = "disconnected";
      try {
        await this.allowReconnection(client, 10); // hold 10 seconds
        // Player reconnected! Restore state
        leaving.state = "idle";
        console.log(`[ArenaRoom] ${leaving.username} reconnected`);
        return;
      } catch (e) {
        // Timeout expired — declare forfeit
      }
    }

    // Forfeit / voluntary leave
    if (leaving && this.state.phase === "battle") {
      // Opponent wins by forfeit
      let winnerId = "";
      this.state.players.forEach((_p, sid) => {
        if (sid !== client.sessionId) winnerId = sid;
      });
      if (winnerId) this.endMatch(winnerId, client.sessionId, true);
    }

    this.state.players.delete(client.sessionId);
    console.log(`[ArenaRoom] ${leaving?.username ?? client.sessionId} left`);
  }

  onDispose() {
    console.log("[ArenaRoom] room disposed");
  }

  // ── Private: fetch loadout bonuses from FastAPI and apply to player ─────────
  private async fetchAndApplyLoadout(player: Player) {
    if (!INTERNAL_SECRET) {
      console.warn("[ArenaRoom] INTERNAL_SECRET is not configured; skipping loadout fetch");
      return;
    }
    try {
      const res = await axios.get(
        `${FASTAPI_URL}/api/internal/user-loadout/${player.userId}`,
        { headers: { "x-internal-secret": INTERNAL_SECRET }, timeout: 3000 }
      );
      const d = res.data;
      player.attackBonus    = Number(d.attack_bonus    || 0);
      player.abilityBonus   = Number(d.ability_bonus   || 0);
      player.defendReduction = Math.min(0.5, Number(d.defend_reduction || 0)); // already a ratio from backend
      player.hpBonus        = Number(d.hp_bonus        || 0);
      player.hasWeapon      = Boolean(d.has_weapon);
      player.weaponEnchant = Number(d.weapon_enchant) || 0;
      player.battleSpritesheetPath = String(d.battle_spritesheet_path || "");
      player.battleSpritesheetHash = String(d.battle_spritesheet_hash || "");
      player.characterBuildJson = JSON.stringify(d.character_build_json || {});
      // Apply HP bonus
      player.maxHp += player.hpBonus;
      player.hp     = player.maxHp;
      console.log(`[ArenaRoom] loadout applied for ${player.username}: hasWeapon=${player.hasWeapon} atk=${player.attackBonus}`);
    } catch (err: any) {
      console.warn(`[ArenaRoom] loadout fetch failed for ${player.username} (userId=${player.userId}): ${err?.message}`);
    }
  }

  // ── Private: countdown then start battle ─────────────────────────────────
  private startCountdown() {
    this.state.phase = "countdown";
    this.state.countdown = COUNTDOWN_SECS;

    const tick = this.clock.setInterval(() => {
      this.state.countdown--;
      if (this.state.countdown <= 0) {
        tick.clear();
        this.state.phase = "battle";
        console.log("[ArenaRoom] battle started");
      }
    }, 1000);
  }

  // ── Private: main game tick (~15 FPS) ────────────────────────────────────
  private tick() {
    if (this.state.phase !== "battle") return;

    const now = Date.now();

    this.state.players.forEach((player, sessionId) => {
      if (player.state === "dead" || player.state === "disconnected") return;

      // ── Timed expiry (always runs, even while stunned) ──────────────────
      if (player.isStunned && now >= player.stunUntil) {
        player.isStunned = false;
        if (player.state !== "jumping") player.state = "idle";
      }
      if (player.abilityCharges === 0 && now >= player.abilityCooldownUntil) {
        player.abilityCharges = 1;
      }

      const input = player.inputState;
      const attackPressed = input.attack && !player.previousInputState.attack;
      const abilityPressed = input.ability && !player.previousInputState.ability;

      if (player.isStunned) {
        player.isBlocking = false;
      }

      if (!player.isStunned) {
        // Reset timed animation states
        if (player.state === "hurt"      && now >= player.hurtUntil)   player.state = "idle";
        if (player.state === "attacking" && now >= player.attackUntil) player.state = "idle";

        const canBlock =
          input.block &&
          player.isGrounded &&
          player.state !== "attacking" &&
          player.state !== "hurt";
        player.isBlocking = canBlock;
        if (canBlock) {
          player.state = "blocking";
        } else if (player.state === "blocking") {
          player.state = "idle";
        }

        // Movement
        if (player.state !== "attacking" && !player.isBlocking) {
          if (input.left) {
            player.x -= PLAYER_SPEED;
            player.facingRight = false;
            if (player.state === "idle") player.state = "walking";
          } else if (input.right) {
            player.x += PLAYER_SPEED;
            player.facingRight = true;
            if (player.state === "idle") player.state = "walking";
          } else if (player.state === "walking") {
            player.state = "idle";
          }
          player.x = Math.max(40, Math.min(ARENA_WIDTH - 40, player.x));
        }

        // Jump input
        if (!player.isBlocking && input.up && player.isGrounded) {
          const lastJump = this.lastJumpTime.get(sessionId) ?? 0;
          if (now - lastJump > JUMP_COOLDOWN_MS) {
            player.velocityY = JUMP_VELOCITY;
            player.isGrounded = false;
            player.state = "jumping";
            this.lastJumpTime.set(sessionId, now);
          }
        }

        // Basic attack
        if (!player.isBlocking && attackPressed && now - player.lastAttackTime > ATTACK_COOLDOWN_MS) {
          player.lastAttackTime = now;
          player.state = "attacking";
          player.attackUntil = now + ATTACK_ANIM_MS;
          this.broadcast("weapon_swing", { sessionId, cls: player.characterClass });

          this.state.players.forEach((opp, oppSid) => {
            if (oppSid === sessionId || opp.state === "dead") return;
            const dist  = Math.abs(player.x - opp.x);
            const yDist = Math.abs(player.y - opp.y);
            if (dist <= ATTACK_RANGE && !(opp.isGrounded === false && yDist > 40)) {
              const dmg = ATTACK_DMG_MIN + Math.floor(Math.random() * (ATTACK_DMG_MAX - ATTACK_DMG_MIN + 1)) + player.attackBonus;
              this.dealDamage(sessionId, opp, oppSid, dmg, now);
            }
          });
        }

        // ── Class ability ───────────────────────────────────────────────
        if (!player.isBlocking && abilityPressed && player.abilityCharges > 0) {
          player.abilityCharges = 0;
          const cls = player.characterClass;
          this.broadcast("weapon_swing", { sessionId, cls });

          if (cls === "warrior") {
            // Bash — close-range stun
            player.abilityCooldownUntil = now + BASH_COOLDOWN_MS;
            player.state = "attacking";
            player.attackUntil = now + ATTACK_ANIM_MS;

            let hit = false;
            this.state.players.forEach((opp, oppSid) => {
              if (oppSid === sessionId || opp.state === "dead") return;
              const dist  = Math.abs(player.x - opp.x);
              const yDist = Math.abs(player.y - opp.y);
              if (dist <= BASH_RANGE && !(opp.isGrounded === false && yDist > 40)) {
                hit = true;
                opp.stunUntil  = now + BASH_STUN_MS;
                opp.isStunned  = true;
                this.dealDamage(sessionId, opp, oppSid, BASH_DMG + player.abilityBonus, now);
              }
            });
            this.broadcast("ability_used", { sessionId, cls: "warrior", fromX: player.x, fromY: player.y, hit });

          } else if (cls === "mage") {
            // Fireball — ranged, dodgeable by jumping, knockback
            player.abilityCooldownUntil = now + FIREBALL_COOLDOWN_MS;

            this.state.players.forEach((opp, oppSid) => {
              if (oppSid === sessionId || opp.state === "dead") return;
              const yDist  = Math.abs(player.y - opp.y);
              const dodged = !opp.isGrounded && yDist > 60;
              this.broadcast("ability_used", {
                sessionId, cls: "mage",
                fromX: player.x, fromY: player.y,
                toX: opp.x, toY: opp.y, hit: !dodged,
              });
              if (!dodged) {
                const origX = opp.x;
                const dir   = opp.x > player.x ? 1 : -1;
                opp.x = Math.max(40, Math.min(ARENA_WIDTH - 40, opp.x + dir * FIREBALL_KNOCKBACK));
                this.dealDamageAt(sessionId, opp, oppSid, FIREBALL_DMG + player.abilityBonus, origX, opp.y, now);
              }
            });

          } else if (cls === "rogue") {
            // Blink — teleport to opposite side of opponent
            player.abilityCooldownUntil = now + BLINK_COOLDOWN_MS;

            this.state.players.forEach((opp, oppSid) => {
              if (oppSid === sessionId || opp.state === "dead") return;
              const dir  = opp.x > player.x ? 1 : -1;
              const newX = Math.max(40, Math.min(ARENA_WIDTH - 40, opp.x + dir * BLINK_OFFSET));
              this.broadcast("ability_used", {
                sessionId, cls: "rogue",
                fromX: player.x, fromY: player.y, toX: newX, toY: player.y, hit: true,
              });
              player.x = newX;
              player.facingRight = player.x < opp.x;
            });
          }
        }
      }

      // Gravity — always applies regardless of stun
      if (!player.isGrounded) {
        player.velocityY += GRAVITY;
        player.y += player.velocityY;
        if (player.y >= FLOOR_Y) {
          player.y = FLOOR_Y;
          player.velocityY = 0;
          player.isGrounded = true;
          if (player.state === "jumping") player.state = "idle";
        }
      }

      player.previousInputState = {
        attack: input.attack,
        ability: input.ability,
      };
    });

    this.state.tickNumber++;
  }

  // Applies damage and broadcasts the floating number at target's position
  private dealDamage(attackerSid: string, target: Player, targetSid: string, dmg: number, now: number) {
    this.dealDamageAt(attackerSid, target, targetSid, dmg, target.x, target.y, now);
  }

  private dealDamageAt(attackerSid: string, target: Player, targetSid: string, dmg: number, nx: number, ny: number, now: number) {
    const attacker = this.state.players.get(attackerSid);
    const blocked = Boolean(attacker && target.isBlocking && this.isAttackerInFront(target, attacker));
    const passiveMultiplier = 1 - target.defendReduction;
    const blockMultiplier = blocked ? 1 - ACTIVE_BLOCK_REDUCTION : 1;
    const effectiveDmg = Math.max(1, Math.round(dmg * passiveMultiplier * blockMultiplier));
    target.hp = Math.max(0, target.hp - effectiveDmg);
    this.broadcast("damage_number", { x: nx, y: ny - 40, damage: effectiveDmg, blocked });
    if (target.hp <= 0) {
      target.state = "dead";
      this.endMatch(attackerSid, targetSid, false);
    } else if (!blocked) {
      target.state = "hurt";
      target.hurtUntil = now + HURT_ANIM_MS;
    }
  }

  private isAttackerInFront(target: Player, attacker: Player) {
    return target.facingRight ? attacker.x >= target.x : attacker.x <= target.x;
  }

  // ── Private: finalize match ───────────────────────────────────────────────
  private endMatch(winnerSid: string, loserSid: string, byDisconnect: boolean) {
    if (this.state.phase === "finished") return;

    this.state.phase = "finished";
    this.state.winnerId = winnerSid;
    this.state.loserId = loserSid;

    const winner = this.state.players.get(winnerSid);
    const loser = this.state.players.get(loserSid);

    console.log(
      `[ArenaRoom] match ended — winner: ${winner?.username} loser: ${loser?.username} disconnect:${byDisconnect}`
    );

    // Report result to FastAPI (fire-and-forget)
    if (winner?.userId && loser?.userId) {
      if (!INTERNAL_SECRET) {
        console.warn("[ArenaRoom] INTERNAL_SECRET is not configured; match result not reported");
        return;
      }
      axios
        .post(
          `${FASTAPI_URL}/api/internal/match-result`,
          {
            winner_user_id: winner.userId,
            loser_user_id: loser.userId,
            by_disconnect: byDisconnect,
            room_id: this.roomId,
          },
          { headers: { "x-internal-secret": INTERNAL_SECRET }, timeout: 5000 }
        )
        .catch((err) => {
          console.warn("[ArenaRoom] FastAPI match-result call failed:", err?.message);
        });
    }

    // Dispose room after grace period
    this.clock.setTimeout(() => this.disconnect(), FINISH_CLEANUP_MS);
  }
}
