import "reflect-metadata";
import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") userId: string = "";
  @type("string") username: string = "Player";
  @type("number") x: number = 100;
  @type("number") y: number = 360;
  @type("number") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("string") state: string = "idle"; // idle | walking | blocking | attacking | hurt | dead | disconnected
  @type("boolean") facingRight: boolean = true;
  @type("string") characterClass: string = "warrior";
  @type("string") characterBuildJson: string = "";
  @type("number") slotIndex: number = 0;
  velocityY: number = 0;              // server-only physics, not synced
  @type("boolean") isGrounded: boolean = true;
  @type("boolean") isStunned: boolean = false;
  @type("boolean") isBlocking: boolean = false;
  @type("number")  abilityCharges: number = 1;  // 0 = cooldown, 1 = ready
  @type("number")  itemAbilityCharges: number = 1;  // separate cooldown for equipped ability item
  @type("number") attackBonus:    number = 0;  // from weapon
  @type("number") abilityBonus:   number = 0;  // from ability scroll
  @type("number") defendReduction: number = 0; // 0.0–1.0 damage multiplier from armor
  @type("number") hpBonus:        number = 0;  // from armor/items
  @type("boolean") hasWeapon:     boolean = false; // true if a weapon item is equipped
  @type("number") weaponEnchant: number = 0;
  @type("string") battleSpritesheetPath: string = "";
  @type("string") battleSpritesheetHash: string = "";
  @type("string") activeAbilityKey: string = "";
  @type("string") activeAbilityName: string = "";
  @type("string") activeAbilityIcon: string = "";
  @type("number") activeAbilityCooldownMs: number = 0;

  // Server-only — not synced to clients
  lastAttackTime: number = 0;
  hurtUntil: number = 0;
  attackUntil: number = 0;
  stunUntil: number = 0;
  abilityCooldownUntil: number = 0;
  itemAbilityCooldownUntil: number = 0;
  inputState: { left: boolean; right: boolean; attack: boolean; ability: boolean; itemAbility: boolean; up: boolean; block: boolean } = {
    left: false,
    right: false,
    attack: false,
    ability: false,
    itemAbility: false,
    up: false,
    block: false,
  };
  previousInputState: { attack: boolean; ability: boolean; itemAbility: boolean } = {
    attack: false,
    ability: false,
    itemAbility: false,
  };
}

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") phase: string = "waiting";   // waiting | countdown | battle | finished
  @type("number") countdown: number = 3;
  @type("string") winnerId: string = "";
  @type("string") loserId: string = "";
  @type("number") tickNumber: number = 0;
}
