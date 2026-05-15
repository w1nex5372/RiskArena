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
  @type("string") state: string = "idle"; // idle | walking | attacking | hurt | dead | disconnected
  @type("boolean") facingRight: boolean = true;
  @type("string") characterClass: string = "warrior";
  @type("number") slotIndex: number = 0;
  velocityY: number = 0;              // server-only physics, not synced
  @type("boolean") isGrounded: boolean = true;
  @type("boolean") isStunned: boolean = false;
  @type("number")  abilityCharges: number = 1;  // 0 = cooldown, 1 = ready

  // Server-only — not synced to clients
  lastAttackTime: number = 0;
  hurtUntil: number = 0;
  attackUntil: number = 0;
  stunUntil: number = 0;
  abilityCooldownUntil: number = 0;
  inputState: { left: boolean; right: boolean; attack: boolean; ability: boolean; up: boolean } = {
    left: false,
    right: false,
    attack: false,
    ability: false,
    up: false,
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
