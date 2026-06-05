import "reflect-metadata";
import { Room, Client } from "colyseus";
import axios from "axios";
import { ArenaState, Player } from "../schemas/ArenaState";
// Shared combat rules — single source of truth (also used by BossRaidRoom)
import { classMaxHp, resolveAbilityDamage, resolveDamage } from "../shared/combat";
import {
  classBasicAttack,
  classDefaultAbilityKey,
  classGuard,
  classMoveSpeed,
  classPassiveEffects,
} from "../shared/classes";
// Shared ability metadata helpers — single source of truth (also used by BossRaidRoom)
import {
  abilityMeta,
  abilityNumber,
  abilityCooldownMs,
  abilityAllowedForClass,
} from "../shared/abilities";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const SKIP_AUTH = process.env.SKIP_AUTH === "true";

// ── Game constants ────────────────────────────────────────────────────────────
const ARENA_WIDTH = 800;
const FLOOR_Y = 360;
const GRAVITY = 1.5;              // applied every tick
const JUMP_VELOCITY = -20;        // negative = upward
const JUMP_COOLDOWN_MS = 800;

// ── Ability constants ─────────────────────────────────────────────────────────
const BASH_RANGE = 120;
const BASH_DMG = 20;
const BASH_STUN_MS = 1500;
const BASH_COOLDOWN_MS = 8000;
const GUARDBREAK_RANGE = 105;
const GUARDBREAK_DMG = 18;
const GUARDBREAK_STUN_MS = 650;
const GUARDBREAK_COOLDOWN_MS = 7000;

const FIREBALL_DMG = 25;
const FIREBALL_KNOCKBACK = 100;
const FIREBALL_COOLDOWN_MS = 6000;

const BLINK_OFFSET = 80;          // teleport this far past the opponent
const BLINK_COOLDOWN_MS = 5000;
const ATTACK_ANIM_MS = 250;       // how long "attacking" state lasts
const HURT_ANIM_MS = 300;
const BASIC_PROJECTILE_IMPACT_DELAY_MS = 190;
const ABILITY_PROJECTILE_IMPACT_DELAY_MS = 320;
const TICK_MS = 66;               // ~15 FPS
const COUNTDOWN_SECS = 3;
const FINISH_CLEANUP_MS = 12_000; // room lives 12s after match ends
// CLASS_HP and ACTIVE_BLOCK_REDUCTION now live in ../shared/combat (single source)
// abilityMeta/abilityNumber/abilityCooldownMs/abilityAllowedForClass now live in
// ../shared/abilities (single source — also used by BossRaidRoom)

// Starting X positions for slot 0 (left) and slot 1 (right)
const SLOT_START_X = [150, 650];

// ─────────────────────────────────────────────────────────────────────────────

export class ArenaRoom extends Room<ArenaState> {
  maxClients = 2;
  private lastJumpTime: Map<string, number> = new Map();
  private loadoutReady: Set<string> = new Set();
  private countdownStarted = false;

  onCreate(_options: any) {
    this.setState(new ArenaState());
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    // Client sends its current input state (held keys)
    this.onMessage("input", (client, data: {
      left: boolean; right: boolean; attack: boolean; ability: boolean; itemAbility?: boolean; up: boolean; block?: boolean
    }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && this.state.phase === "battle") {
        player.inputState = {
          left: !!data.left,
          right: !!data.right,
          attack: !!data.attack,
          ability: !!data.ability,
          itemAbility: !!data.itemAbility,
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
    player.battleSpritesheetPath = String(auth?.battle_spritesheet_path || auth?.character_spritesheet_path || "");
    player.battleSpritesheetHash = String(auth?.battle_spritesheet_hash || auth?.character_spritesheet_hash || "");
    player.slotIndex = this.state.players.size; // 0 = left, 1 = right
    player.x = SLOT_START_X[player.slotIndex] ?? 400;
    player.y = FLOOR_Y;
    player.facingRight = player.slotIndex === 0;
    player.maxHp = classMaxHp(player.characterClass);
    player.hp = player.maxHp;
    player.maxGuard = classGuard(player.characterClass).max;
    player.guard = player.maxGuard;

    this.state.players.set(client.sessionId, player);

    console.log(`[ArenaRoom] ${player.username} joined (slot ${player.slotIndex})`);

    this.fetchAndApplyLoadout(player)
      .catch((err) => {
        console.warn(`[ArenaRoom] loadout setup failed for ${player.username}: ${err?.message}`);
      })
      .finally(() => {
        this.loadoutReady.add(client.sessionId);
        this.tryStartCountdown();
      });
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
    this.loadoutReady.delete(client.sessionId);
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
      player.attackBonus    = this.clampNumber(d.attack_bonus, 0, 500, 0);
      player.abilityBonus   = this.clampNumber(d.ability_bonus, 0, 500, 0);
      player.defendReduction = this.clampNumber(d.defend_reduction, 0, 0.85, 0);
      player.hpBonus        = this.clampNumber(d.hp_bonus, 0, 1000, 0);
      player.hasWeapon      = Boolean(d.has_weapon);
      player.weaponEnchant = this.clampNumber(d.weapon_enchant, 0, 10, 0);
      player.battleSpritesheetPath = String(d.battle_spritesheet_path || "");
      player.battleSpritesheetHash = String(d.battle_spritesheet_hash || "");
      const activeAbilityKey = String(d.active_ability_key || "");
      const abilityAllowed = this.isItemAbilityAllowedForClass(player.characterClass, activeAbilityKey);
      const defaultAbilityCooldown = this.itemAbilityDefaultCooldownMs(activeAbilityKey);
      const requestedAbilityCooldown = this.clampNumber(d.active_ability_cooldown_ms, 0, 30000, 0);
      player.activeAbilityKey = abilityAllowed ? activeAbilityKey : "";
      player.activeAbilityName = abilityAllowed ? String(d.active_ability_name || "") : "";
      player.activeAbilityIcon = abilityAllowed ? String(d.active_ability_icon || "") : "";
      player.activeAbilityCooldownMs = abilityAllowed
        ? Math.max(requestedAbilityCooldown || defaultAbilityCooldown, defaultAbilityCooldown)
        : 0;
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
  private clampNumber(value: any, min: number, max: number, fallback: number) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  private tryStartCountdown() {
    if (this.countdownStarted || this.state.phase !== "waiting" || this.state.players.size !== 2) return;
    let allReady = true;
    this.state.players.forEach((_player, sessionId) => {
      if (!this.loadoutReady.has(sessionId)) allReady = false;
    });
    if (!allReady) return;
    this.startCountdown();
  }

  private startCountdown() {
    this.countdownStarted = true;
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
      if (this.state.phase !== "battle") return;
      if (player.state === "dead" || player.state === "disconnected") return;

      // ── Timed expiry (always runs, even while stunned) ──────────────────
      if (player.isStunned && now >= player.stunUntil) {
        player.isStunned = false;
        if (player.state !== "jumping") player.state = "idle";
        this.broadcastCombatFeedback("stun_ended", player, sessionId, "READY");
      }
      if (player.abilityCharges === 0 && now >= player.abilityCooldownUntil) {
        player.abilityCharges = 1;
      }
      if (player.itemAbilityCharges === 0 && now >= player.itemAbilityCooldownUntil) {
        player.itemAbilityCharges = 1;
      }
      if (player.backstabWindowUntil > 0 && now >= player.backstabWindowUntil) {
        player.backstabWindowUntil = 0;
        player.backstabTargetSid = "";
      }
      this.updateGuard(player, now);

      const input = player.inputState;
      const attackPressed = input.attack && !player.previousInputState.attack;
      const abilityPressed = input.ability && !player.previousInputState.ability;
      const itemAbilityPressed = input.itemAbility && !player.previousInputState.itemAbility;

      if (player.isStunned) {
        player.isBlocking = false;
      }

      if (!player.isStunned) {
        // Reset timed animation states
        if (player.state === "hurt"      && now >= player.hurtUntil)   player.state = "idle";
        if (player.state === "attacking" && now >= player.attackUntil) player.state = "idle";

        const actionLocked = player.state === "hurt" || player.state === "attacking";
        const wasBlocking = player.isBlocking;
        const canBlock =
          input.block &&
          player.isGrounded &&
          player.guard > 0 &&
          !player.guardBroken &&
          !actionLocked;
        player.isBlocking = canBlock;
        if (canBlock) {
          const guard = classGuard(player.characterClass);
          player.state = "blocking";
          player.guard = Math.max(0, player.guard - guard.hold_drain_per_tick);
          player.guardRegenPausedUntil = now + guard.regen_delay_ms;
          if (player.guard <= 0) {
            player.guard = 0;
            player.isBlocking = false;
            player.state = "idle";
          }
        } else if (player.state === "blocking") {
          player.state = "idle";
        }
        if (player.isBlocking !== wasBlocking) {
          this.broadcastCombatFeedback(
            player.isBlocking ? "block_start" : "block_end",
            player,
            sessionId,
            player.isBlocking ? "BLOCK" : "",
          );
        }

        // Movement
        if (!actionLocked && !player.isBlocking) {
          const moveSpeed = classMoveSpeed(player.characterClass);
          if (input.left) {
            player.x -= moveSpeed;
            player.facingRight = false;
            if (player.state === "idle") player.state = "walking";
          } else if (input.right) {
            player.x += moveSpeed;
            player.facingRight = true;
            if (player.state === "idle") player.state = "walking";
          } else if (player.state === "walking") {
            player.state = "idle";
          }
          player.x = Math.max(40, Math.min(ARENA_WIDTH - 40, player.x));
        }

        // Jump input
        if (!actionLocked && !player.isBlocking && input.up && player.isGrounded) {
          const lastJump = this.lastJumpTime.get(sessionId) ?? 0;
          if (now - lastJump > JUMP_COOLDOWN_MS) {
            player.velocityY = JUMP_VELOCITY;
            player.isGrounded = false;
            player.state = "jumping";
            this.lastJumpTime.set(sessionId, now);
          }
        }

        // Basic attack
        const basicAttack = classBasicAttack(player.characterClass);
        if (!actionLocked && !player.isBlocking && attackPressed && now - player.lastAttackTime > basicAttack.cooldown_ms) {
          player.lastAttackTime = now;
          player.state = "attacking";
          player.attackUntil = now + ATTACK_ANIM_MS;
          const consumesBackstabWindow = this.isBackstabWindowArmed(player, now);

          let hit = false;
          let missReason = "MISS";
          let dodgedSid = "";
          let feedbackX = player.x + (player.facingRight ? 64 : -64);
          let feedbackY = player.y;
          this.state.players.forEach((opp, oppSid) => {
            if (oppSid === sessionId || opp.state === "dead") return;
            const dist  = Math.abs(player.x - opp.x);
            const yDist = Math.abs(player.y - opp.y);
            feedbackX = opp.x;
            feedbackY = opp.y;
            if (dist > basicAttack.range) {
              missReason = "OUT";
            } else if (!this.isTargetInFront(player, opp)) {
              missReason = "MISS";
            } else if (opp.isGrounded === false && yDist > 40) {
              missReason = "DODGE";
              dodgedSid = oppSid;
            }
            if (dist <= basicAttack.range && this.isTargetInFront(player, opp) && !(opp.isGrounded === false && yDist > 40)) {
              hit = true;
              const min = Math.round(basicAttack.damage_min);
              const max = Math.round(basicAttack.damage_max);
              const dmg = min + Math.floor(Math.random() * (max - min + 1)) + player.attackBonus;
              this.dealDamage(sessionId, opp, oppSid, dmg, now, {
                source: "basic",
                visualDelayMs: basicAttack.kind === "projectile" ? BASIC_PROJECTILE_IMPACT_DELAY_MS : 0,
              });
            }
          });
          if (consumesBackstabWindow) {
            player.backstabWindowUntil = 0;
            player.backstabTargetSid = "";
          }
          if (!hit && basicAttack.kind === "projectile") {
            const dir = player.facingRight ? 1 : -1;
            feedbackX = Math.max(40, Math.min(ARENA_WIDTH - 40, player.x + dir * basicAttack.range));
            feedbackY = player.y;
          }
          this.broadcast("weapon_swing", {
            sessionId,
            cls: player.characterClass,
            attackKind: basicAttack.kind || "melee",
            fromX: player.x,
            fromY: player.y,
            toX: feedbackX,
            toY: feedbackY,
            hit,
            range: basicAttack.range,
          });
          if (!hit) {
            player.misses += 1;
            if (missReason === "DODGE" && dodgedSid) {
              const dodger = this.state.players.get(dodgedSid);
              if (dodger) dodger.dodges += 1;
            }
            this.broadcastCombatFeedback(
              missReason === "DODGE" ? "dodge" : "miss",
              player,
              sessionId,
              missReason,
              feedbackX,
              feedbackY,
            );
          }
        }

        // ── Class ability ───────────────────────────────────────────────
        // Default class ability is always available; item ability is an extra equipped skill.
        if (!actionLocked && player.state !== "attacking" && !player.isBlocking && abilityPressed && player.abilityCharges > 0) {
          const abilityKey = classDefaultAbilityKey(player.characterClass);
          if (!this.executeAbility(sessionId, player, abilityKey, now, "class")) {
            player.abilityCharges = 1;
            player.state = "idle";
            player.attackUntil = 0;
          }
        }

        if (!actionLocked && player.state !== "attacking" && !player.isBlocking && itemAbilityPressed && player.itemAbilityCharges > 0 && this.isItemAbilityAllowedForClass(player.characterClass, player.activeAbilityKey)) {
          if (!this.executeAbility(sessionId, player, player.activeAbilityKey, now, "item")) {
            player.itemAbilityCharges = 1;
            player.state = "idle";
            player.attackUntil = 0;
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
        itemAbility: input.itemAbility,
      };
    });

    this.state.tickNumber++;
  }

  private executeAbility(
    sessionId: string,
    player: Player,
    abilityKey: string,
    now: number,
    slot: "class" | "item",
  ): boolean {
    const meta = abilityMeta(abilityKey);
    const abilityType = String(meta?.type || "");
    if (!meta || !abilityType || !abilityAllowedForClass(player.characterClass, abilityKey)) return false;
    const abilityDamage = (baseDamage: number) =>
      resolveAbilityDamage(baseDamage, player.abilityBonus, abilityNumber(meta, "ability_power_scale", 1));

    const cls = String(meta.class || player.characterClass);
    const defaultCooldown = abilityCooldownMs(abilityKey, 0);
    const cooldownMs = this.abilityFallbackCooldownMs(abilityType, defaultCooldown);

    if (slot === "class") {
      player.abilityCharges = 0;
      player.abilityCooldownUntil = now + cooldownMs;
    } else {
      player.itemAbilityCharges = 0;
      player.itemAbilityCooldownUntil = now + this.itemAbilityCooldownMs(player, cooldownMs);
    }
    player.state = "attacking";
    player.attackUntil = now + ATTACK_ANIM_MS;
    player.skillUses += 1;
    if (slot === "class") player.classSkillUses += 1;
    if (slot === "item") player.itemSkillUses += 1;
    this.broadcast("weapon_swing", { sessionId, cls });
    this.broadcast("ability_cast", {
      sessionId,
      cls,
      abilityKey,
      slot,
      type: abilityType,
      fromX: player.x,
      fromY: player.y,
      facingRight: player.facingRight,
      range: this.abilityFallbackRange(abilityType, meta),
      cooldownMs,
    });

    if (abilityType === "guardbreak") {
      const range = abilityNumber(meta, "range", GUARDBREAK_RANGE);
      const damage = abilityNumber(meta, "damage", GUARDBREAK_DMG);
      const effectiveDamage = abilityDamage(damage);
      const stunMs = abilityNumber(meta, "stun_ms", GUARDBREAK_STUN_MS);
      let hit = false;
      let brokeBlock = false;
      let targetX = player.x;
      let targetY = player.y;
      this.state.players.forEach((opp, oppSid) => {
        if (oppSid === sessionId || opp.state === "dead") return;
        const dist  = Math.abs(player.x - opp.x);
        const yDist = Math.abs(player.y - opp.y);
        if (dist <= range && this.isTargetInFront(player, opp) && !(opp.isGrounded === false && yDist > 40)) {
          hit = true;
          targetX = opp.x;
          targetY = opp.y;
          brokeBlock = brokeBlock || opp.isBlocking;
          if (opp.isBlocking) {
            const didBreak = this.breakGuard(opp, now, stunMs);
            if (didBreak) player.guardBreaks += 1;
          }
          opp.stunUntil = now + stunMs;
          opp.isStunned = true;
          this.dealDamage(sessionId, opp, oppSid, effectiveDamage, now, {
            ignoreBlock: !!meta.ignore_block,
            source: slot === "class" ? "classAbility" : "itemAbility",
          });
        }
      });
      if (!hit) {
        player.misses += 1;
        this.broadcastCombatFeedback("miss", player, sessionId, "MISS", targetX, targetY);
      }
      this.broadcast("ability_used", {
        sessionId, cls, abilityKey, slot,
        fromX: player.x, fromY: player.y, toX: targetX, toY: targetY,
        hit, brokeBlock, damage, effectiveDamage, stunMs, range, cooldownMs,
      });
      return true;
    }

    if (abilityType === "bash") {
      const range = abilityNumber(meta, "range", BASH_RANGE);
      const damage = abilityNumber(meta, "damage", BASH_DMG);
      const effectiveDamage = abilityDamage(damage);
      const stunMs = abilityNumber(meta, "stun_ms", BASH_STUN_MS);
      let hit = false;
      let targetX = player.x;
      let targetY = player.y;
      this.state.players.forEach((opp, oppSid) => {
        if (oppSid === sessionId || opp.state === "dead") return;
        const dist  = Math.abs(player.x - opp.x);
        const yDist = Math.abs(player.y - opp.y);
        if (dist <= range && this.isTargetInFront(player, opp) && !(opp.isGrounded === false && yDist > 40)) {
          hit = true;
          targetX = opp.x;
          targetY = opp.y;
          opp.stunUntil  = now + stunMs;
          opp.isStunned  = true;
          this.dealDamage(sessionId, opp, oppSid, effectiveDamage, now, {
            source: slot === "class" ? "classAbility" : "itemAbility",
          });
        }
      });
      if (!hit) {
        player.misses += 1;
        this.broadcastCombatFeedback("miss", player, sessionId, "MISS", targetX, targetY);
      }
      this.broadcast("ability_used", {
        sessionId, cls, abilityKey, slot,
        fromX: player.x, fromY: player.y, toX: targetX, toY: targetY,
        hit, damage, effectiveDamage, stunMs, range, cooldownMs,
      });
      return true;
    }

    if (abilityType === "projectile") {
      const damage = abilityNumber(meta, "damage", FIREBALL_DMG);
      const effectiveDamage = abilityDamage(damage);
      const knockback = abilityNumber(meta, "knockback", FIREBALL_KNOCKBACK);
      const blockedKnockbackMult = this.clampNumber(abilityNumber(meta, "blocked_knockback_mult", 1), 0, 1, 1);
      this.state.players.forEach((opp, oppSid) => {
        if (oppSid === sessionId || opp.state === "dead") return;
        const yDist  = Math.abs(player.y - opp.y);
        const dodged = !opp.isGrounded && yDist > 60;
        const blockedKnockback = Boolean(!meta.ignore_block && opp.isBlocking && this.isAttackerInFront(opp, player));
        const appliedKnockback = Math.round(knockback * (blockedKnockback ? blockedKnockbackMult : 1));
        this.broadcast("ability_used", {
          sessionId, cls, abilityKey, slot,
          fromX: player.x, fromY: player.y,
          toX: opp.x, toY: opp.y, hit: !dodged,
          damage, effectiveDamage, knockback, appliedKnockback, blockedKnockback, range: abilityNumber(meta, "range", ARENA_WIDTH), cooldownMs,
        });
        if (dodged) {
          opp.dodges += 1;
          player.misses += 1;
          this.broadcastCombatFeedback("dodge", opp, oppSid, "DODGE", opp.x, opp.y);
        }
        if (!dodged) {
          const origX = opp.x;
          const dir   = opp.x > player.x ? 1 : -1;
          this.dealDamageAt(sessionId, opp, oppSid, effectiveDamage, origX, opp.y, now, {
            source: slot === "class" ? "classAbility" : "itemAbility",
            visualDelayMs: ABILITY_PROJECTILE_IMPACT_DELAY_MS,
          });
          if (opp.state !== "dead") {
            opp.x = Math.max(40, Math.min(ARENA_WIDTH - 40, opp.x + dir * appliedKnockback));
          }
        }
      });
      return true;
    }

    if (abilityType === "blink") {
      const offset = abilityNumber(meta, "offset", BLINK_OFFSET);
      const range = abilityNumber(meta, "range", offset);
      let blinked = false;
      this.state.players.forEach((opp, oppSid) => {
        if (blinked) return;
        if (oppSid === sessionId || opp.state === "dead") return;
        const dist = Math.abs(player.x - opp.x);
        if (dist > range + 120) return;
        const dir  = opp.x > player.x ? 1 : -1;
        const basicRange = classBasicAttack(player.characterClass).range;
        const effectiveOffset = Math.min(offset, Math.max(32, basicRange - 8));
        const newX = Math.max(40, Math.min(ARENA_WIDTH - 40, opp.x + dir * effectiveOffset));
        const backstabWindowMs = this.rogueBackstabWindowMs(player);
        const backstabReady = this.isBehindTargetAt(newX, opp);
        this.broadcast("ability_used", {
          sessionId, cls, abilityKey, slot,
          fromX: player.x, fromY: player.y, toX: newX, toY: player.y, hit: true,
          mode: "target", targetSid: oppSid, targetX: opp.x, targetY: opp.y,
          backstabReady, backstabWindowMs: backstabReady ? backstabWindowMs : 0, range, offset: effectiveOffset, configuredOffset: offset, cooldownMs,
        });
        player.x = newX;
        player.facingRight = player.x < opp.x;
        player.backstabWindowUntil = backstabReady && backstabWindowMs > 0 ? now + backstabWindowMs : 0;
        player.backstabTargetSid = backstabReady && backstabWindowMs > 0 ? oppSid : "";
        blinked = true;
      });
      if (!blinked) {
        const dir = player.facingRight ? 1 : -1;
        const newX = Math.max(40, Math.min(ARENA_WIDTH - 40, player.x + dir * offset));
        this.broadcast("ability_used", {
          sessionId, cls, abilityKey, slot,
          fromX: player.x, fromY: player.y, toX: newX, toY: player.y, hit: true,
          mode: "dash", backstabReady: false, range, offset, cooldownMs,
        });
        player.x = newX;
        player.backstabWindowUntil = 0;
        player.backstabTargetSid = "";
      }
      return true;
    }

    return false;
  }

  // Applies damage and broadcasts the floating number at target's position
  private dealDamage(
    attackerSid: string,
    target: Player,
    targetSid: string,
    dmg: number,
    now: number,
    options: { ignoreBlock?: boolean; source?: "basic" | "classAbility" | "itemAbility"; visualDelayMs?: number } = {},
  ) {
    this.dealDamageAt(attackerSid, target, targetSid, dmg, target.x, target.y, now, options);
  }

  private dealDamageAt(
    attackerSid: string,
    target: Player,
    targetSid: string,
    dmg: number,
    nx: number,
    ny: number,
    now: number,
    options: { ignoreBlock?: boolean; source?: "basic" | "classAbility" | "itemAbility"; visualDelayMs?: number } = {},
  ) {
    const attacker = this.state.players.get(attackerSid);
    const targetGuard = classGuard(target.characterClass);
    const blocked = Boolean(!options.ignoreBlock && attacker && target.isBlocking && this.isAttackerInFront(target, attacker));
    const backstab = Boolean(attacker && this.isBackstab(attacker, target, options.source));
    const backstabWindow = Boolean(backstab && attacker && this.isBackstabWindowActive(attacker, targetSid, now));
    const attackProfile = attacker ? classBasicAttack(attacker.characterClass) : null;
    const backstabMultiplier = backstabWindow
      ? Number(attackProfile?.backstab_window_multiplier || classPassiveEffects(attacker?.characterClass || "").backstab_window_multiplier || attackProfile?.backstab_multiplier || 1)
      : Number(attackProfile?.backstab_multiplier || 1);
    const rawDmg = backstab
      ? Math.max(1, Math.round(dmg * backstabMultiplier))
      : dmg;
    let guardDamage = 0;
    let guardBroken = false;
    let guardRemaining = target.guard;
    if (blocked) {
      guardDamage = Math.max(1, Math.round(rawDmg * targetGuard.hit_drain_mult));
      target.guard = Math.max(0, target.guard - guardDamage);
      target.guardRegenPausedUntil = now + targetGuard.regen_delay_ms;
      guardRemaining = target.guard;
      if (target.guard <= 0) {
        guardBroken = this.breakGuard(target, now);
      }
    }
    const targetPassives = classPassiveEffects(target.characterClass);
    const frontalReduction = Number(targetPassives.frontal_damage_reduction || 0);
    const frontalPassive = Boolean(
      !blocked &&
      attacker &&
      frontalReduction > 0 &&
      this.isAttackerInFront(target, attacker),
    );
    const defendReduction = frontalPassive
      ? this.combineDamageReduction(target.defendReduction, frontalReduction)
      : target.defendReduction;
    const effectiveDmg = resolveDamage(rawDmg, {
      blocked,
      defendReduction,
      blockReduction: targetGuard.block_reduction,
    });
    if (attacker) {
      attacker.hits += 1;
      attacker.damageDealt += effectiveDmg;
      target.damageTaken += effectiveDmg;
      if (blocked) {
        target.blocks += 1;
        target.damageBlocked += Math.max(0, rawDmg - effectiveDmg);
        attacker.guardDamageDealt += guardDamage;
      }
      if (guardBroken) attacker.guardBreaks += 1;
      if (backstabWindow) {
        attacker.executes += 1;
      } else if (backstab) {
        attacker.backstabs += 1;
      }
    }
    target.hp = Math.max(0, target.hp - effectiveDmg);
    this.broadcast("damage_number", {
      x: nx,
      y: ny - 40,
      damage: effectiveDmg,
      blocked,
      guardDamage,
      guardRemaining,
      guardBroken,
      backstab,
      backstabWindow,
      frontalPassive,
      visualDelayMs: this.clampNumber(options.visualDelayMs, 0, 1000, 0),
      attackerSid,
      targetSid,
    });
    if (backstabWindow && attacker) {
      attacker.backstabWindowUntil = 0;
      attacker.backstabTargetSid = "";
    }
    if (blocked && !guardBroken) {
      this.broadcastCombatFeedback("blocked", target, targetSid, "BLOCK", nx, ny);
    } else if (!blocked && target.hp > 0 && (target.isStunned || target.stunUntil > now)) {
      this.broadcastCombatFeedback("stun", target, targetSid, "STUN", nx, ny);
    }
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

  private isBackstab(attacker: Player, target: Player, source?: string) {
    if (source !== "basic") return false;
    const multiplier = Number(classBasicAttack(attacker.characterClass).backstab_multiplier || 1);
    if (multiplier <= 1) return false;
    return this.isBehindTargetAt(attacker.x, target);
  }

  private isBehindTargetAt(attackerX: number, target: Player) {
    return target.facingRight ? attackerX < target.x : attackerX > target.x;
  }

  private rogueBackstabWindowMs(player: Player) {
    return this.clampNumber(classPassiveEffects(player.characterClass).blink_backstab_window_ms, 0, 5000, 0);
  }

  private isBackstabWindowArmed(attacker: Player, now: number) {
    return Boolean(attacker.backstabWindowUntil && now <= attacker.backstabWindowUntil);
  }

  private isBackstabWindowActive(attacker: Player, targetSid: string, now: number) {
    if (!this.isBackstabWindowArmed(attacker, now)) return false;
    return !attacker.backstabTargetSid || attacker.backstabTargetSid === targetSid;
  }

  private combineDamageReduction(a: number, b: number) {
    const first = this.clampNumber(a, 0, 0.9, 0);
    const second = this.clampNumber(b, 0, 0.9, 0);
    return 1 - ((1 - first) * (1 - second));
  }

  private updateGuard(player: Player, now: number) {
    const guard = classGuard(player.characterClass);
    player.maxGuard = guard.max;
    player.guard = Math.min(player.guard, player.maxGuard);
    if (player.guardBroken && now >= player.guardBrokenUntil) {
      player.guardBroken = false;
    }
    if (
      !player.guardBroken &&
      !player.isBlocking &&
      player.state !== "dead" &&
      player.state !== "disconnected" &&
      now >= player.guardRegenPausedUntil
    ) {
      player.guard = Math.min(player.maxGuard, player.guard + guard.regen_per_tick);
    }
  }

  private breakGuard(player: Player, now: number, stunMs?: number): boolean {
    const guard = classGuard(player.characterClass);
    const wasBroken = player.guardBroken;
    player.guard = 0;
    player.isBlocking = false;
    player.guardBroken = true;
    player.guardBrokenUntil = now + guard.break_recover_ms;
    player.guardRegenPausedUntil = now + guard.break_recover_ms + guard.regen_delay_ms;
    player.stunUntil = Math.max(player.stunUntil, now + (stunMs ?? guard.break_stun_ms));
    player.isStunned = true;
    player.state = "hurt";
    if (!wasBroken) {
      this.broadcastCombatFeedback("guard_broken", player, player.sessionId, "BREAK", player.x, player.y);
    }
    return !wasBroken;
  }

  private broadcastCombatFeedback(
    type: string,
    player: Player,
    sessionId: string,
    label: string,
    x?: number,
    y?: number,
  ) {
    if (!label && type !== "block_end" && type !== "stun_ended") return;
    const px = Number(x);
    const py = Number(y);
    this.broadcast("combat_feedback", {
      type,
      sessionId,
      x: Number.isFinite(px) ? px : player.x,
      y: Number.isFinite(py) ? py - 52 : player.y - 52,
      label,
    });
  }

  private isTargetInFront(attacker: Player, target: Player) {
    return attacker.facingRight ? target.x >= attacker.x : target.x <= attacker.x;
  }

  private itemAbilityDefaultCooldownMs(abilityKey: string) {
    return abilityCooldownMs(abilityKey, 0);
  }

  private abilityFallbackCooldownMs(abilityType: string, configuredCooldownMs: number) {
    if (configuredCooldownMs > 0) return configuredCooldownMs;
    if (abilityType === "guardbreak") return GUARDBREAK_COOLDOWN_MS;
    if (abilityType === "bash") return BASH_COOLDOWN_MS;
    if (abilityType === "projectile") return FIREBALL_COOLDOWN_MS;
    if (abilityType === "blink") return BLINK_COOLDOWN_MS;
    return 0;
  }

  private abilityFallbackRange(abilityType: string, meta: any) {
    if (abilityType === "guardbreak") return abilityNumber(meta, "range", GUARDBREAK_RANGE);
    if (abilityType === "bash") return abilityNumber(meta, "range", BASH_RANGE);
    if (abilityType === "projectile") return abilityNumber(meta, "range", ARENA_WIDTH);
    if (abilityType === "blink") return abilityNumber(meta, "range", abilityNumber(meta, "offset", BLINK_OFFSET)) + 120;
    return abilityNumber(meta, "range", 0);
  }

  private isItemAbilityAllowedForClass(className: string, abilityKey: string) {
    return abilityAllowedForClass(className, abilityKey);
  }

  private itemAbilityCooldownMs(player: Player, defaultCooldownMs: number) {
    return Math.max(player.activeAbilityCooldownMs || defaultCooldownMs, defaultCooldownMs);
  }

  private playerCombatStats(player?: Player) {
    return {
      damage_dealt: Math.round(player?.damageDealt || 0),
      damage_taken: Math.round(player?.damageTaken || 0),
      damage_blocked: Math.round(player?.damageBlocked || 0),
      guard_damage_dealt: Math.round(player?.guardDamageDealt || 0),
      blocks: Math.round(player?.blocks || 0),
      guard_breaks: Math.round(player?.guardBreaks || 0),
      dodges: Math.round(player?.dodges || 0),
      backstabs: Math.round(player?.backstabs || 0),
      executes: Math.round(player?.executes || 0),
      skill_uses: Math.round(player?.skillUses || 0),
      class_skill_uses: Math.round(player?.classSkillUses || 0),
      item_skill_uses: Math.round(player?.itemSkillUses || 0),
      hits: Math.round(player?.hits || 0),
      misses: Math.round(player?.misses || 0),
    };
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

    const winnerStats = this.playerCombatStats(winner);
    const loserStats = this.playerCombatStats(loser);
    this.broadcast("match_stats", {
      winnerSid,
      loserSid,
      winnerStats,
      loserStats,
    });

    // Report result to FastAPI (fire-and-forget)
    if (winner?.userId && loser?.userId) {
      if (!INTERNAL_SECRET) {
        console.warn("[ArenaRoom] INTERNAL_SECRET is not configured; match result not reported");
      } else {
        axios
          .post(
            `${FASTAPI_URL}/api/internal/match-result`,
            {
              winner_user_id: winner.userId,
              loser_user_id: loser.userId,
              by_disconnect: byDisconnect,
              room_id: this.roomId,
              winner_stats: winnerStats,
              loser_stats: loserStats,
            },
            { headers: { "x-internal-secret": INTERNAL_SECRET }, timeout: 5000 }
          )
          .catch((err) => {
            console.warn("[ArenaRoom] FastAPI match-result call failed:", err?.message);
          });
      }
    }

    // Dispose room after grace period
    this.clock.setTimeout(() => this.disconnect(), FINISH_CLEANUP_MS);
  }
}
