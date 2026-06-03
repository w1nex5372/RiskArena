import "reflect-metadata";
import { Schema, MapSchema, type } from "@colyseus/schema";

// Kiekvienas prisijungęs žaidėjas raid'e
export class RaidPlayer extends Schema {
  @type("string") sessionId: string = "";
  @type("string") userId: string = "";
  @type("string") username: string = "Player";
  @type("string") characterClass: string = "warrior";
  @type("string") spritesheetPath: string = "";
  @type("number") totalDamage: number = 0;   // kiek damage padarė šiame raid'e
  // Veiksmo būsena — serveris laiko, visi klientai renderina vienodai.
  // idle | moving | attacking | hit | dead
  @type("string") state: string = "idle";

  // Light movement model (Phase 5) — serveris laiko poziciją, klientai interpoliuoja.
  // moving" būsenos klientas neperduoda atskirai — ją išveda iš x pokyčio.
  @type("number")  x: number = 90;             // horizontali pozicija pikseliais
  @type("boolean") facingRight: boolean = true; // į kurią pusę žiūri (true = link boso)
  @type("number")  moveSpeed: number = 120;     // px/s pagal klasę (iš battle_classes.json)

  // Group A: HP + gynyba (bendra combat logika su Arena per shared/combat.ts)
  @type("number")  hp: number = 100;           // dabartinė žaidėjo HP
  @type("number")  maxHp: number = 100;        // maksimali HP (pagal klasę)
  @type("boolean") blocking: boolean = false;  // ar laiko block (gina nuo boso atakos)
  @type("number")  defendReduction: number = 0; // pasyvi armor redukcija (0..1)
  @type("number")  reviveSeconds: number = 0;  // kiek sek liko iki revive (nokautavus; death overlay)

  // Group A: GUARD-METER (block stamina) — veidrodis Arena guard sistemai.
  // Parametrai (max/drain/regen/break) gyvena battle_classes.json (classGuard).
  // Sinchronizuojama su klientais — kad UI rodytų guard bar'ą ir "GUARD BROKEN".
  @type("number")  guard: number = 100;        // dabartinė block stamina
  @type("number")  maxGuard: number = 100;     // maksimali guard (pagal klasę)
  @type("boolean") guardBroken: boolean = false; // true kol atsigauna po guard break'o

  // Server-only — nesinchronizuojama su klientais
  // Ar žaidėjas šuolyje (ore) — klientas praneša per "airborne" žinutę (jump start/landing).
  // Naudojama AoE atakai: ore esantys žaidėjai DODGE'ina neblokuojamą AoE smūgį.
  airborne: boolean = false;
  lastAttackAt: number = 0;
  // Per-ability cooldown PAGAL KEY (klasės ir item ability turi atskirus cooldown'us).
  // { abilityKey: paskutinio panaudojimo Date.now() } — server-side anti-cheat.
  abilityCooldowns: Record<string, number> = {};
  // Kada transient būsena (attacking/hit) turi grįžti į idle (Date.now() ms). 0 = nėra deadline.
  stateUntil: number = 0;
  // Paskutinio "move" žinutės laikas (server-side throttle, anti-spam)
  lastMoveAt: number = 0;

  // Guard server-only laukai (veidrodis Arena Player guard laukams) — nesinchronizuojami.
  // ATSKIRAS nuo stateUntil — guard stun gyvuoja nepriklausomai nuo transient būsenų.
  guardBrokenUntil: number = 0;        // kada guardBroken nusiima (Date.now() ms)
  guardRegenPausedUntil: number = 0;   // kada guard vėl gali regeneruotis (Date.now() ms)
  stunUntil: number = 0;               // kada baigiasi guard-break stun (negali veikti)
}

// Pagrindinis raid'o state — vienas egzempliorius visam room'ui
export class BossRaidState extends Schema {
  @type("string")  raidId: string = "";
  @type("string")  bossName: string = "Boss";
  @type("number")  currentHp: number = 1000;
  @type("number")  maxHp: number = 1000;
  @type("number")  phase: number = 1;          // 1 | 2 | 3
  @type("boolean") enraged: boolean = false;   // true kai bosas įsiuto (burn faze) — vėluojantys prisijungę irgi mato
  @type("string")  status: string = "active";  // active | defeated | expired
  @type("number")  playerCount: number = 0;    // kiek žaidėjų prisijungę dabar

  // Visi prisijungę žaidėjai — MapSchema leidžia dinamiškai pridėti/šalinti
  @type({ map: RaidPlayer }) players = new MapSchema<RaidPlayer>();
}
