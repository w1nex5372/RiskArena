import React, { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import BattleScene from './scenes/BattleScene';

const GAME_W = 800;
const GAME_H = 420;

class DebugPlayers extends Map {
  onAdd(cb) {
    this.forEach((player, sessionId) => cb(player, sessionId));
  }

  onRemove() {}
}

function createDebugRoom() {
  const params = new URLSearchParams(window.location.search);
  const cls = params.get('weaponClass') || 'rogue';
  const enchant = Number(params.get('weaponEnchant') || 10);
  const sessionId = 'debug-player';

  const player = {
    username: 'Debug',
    characterClass: cls,
    state: 'idle',
    x: GAME_W / 2,
    y: 348,
    hp: 120,
    maxHp: 120,
    facingRight: true,
    hasWeapon: true,
    weaponEnchant: Number.isFinite(enchant) ? enchant : 0,
    isStunned: false,
    abilityCharges: 1,
    onChange() {},
  };

  const players = new DebugPlayers([[sessionId, player]]);

  return {
    sessionId,
    state: {
      phase: 'waiting',
      players,
      onChange() {},
    },
    onMessage() {},
    onLeave() {},
    leave() {},
  };
}

export default function WeaponDebugScreen() {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return undefined;

    const config = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: GAME_W,
      height: GAME_H,
      backgroundColor: '#0d0d1a',
      scene: [BattleScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: false,
        pixelArt: false,
        powerPreference: 'low-power',
      },
      input: { keyboard: true },
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;

    game.events.once('ready', () => {
      const scene = game.scene.getScene('BattleScene');
      scene.setRoom(createDebugRoom(), 'debug-player');
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#070712',
      color: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div ref={containerRef} style={{ width: '100%', height: 'min(100vh, 620px)' }} />
      <div style={{ fontSize: 13, color: '#c9a84c', paddingBottom: 16 }}>
        weaponDebug: arrows move, [] col, ;/' row, -/= scale, ,/. rotate, N/M body frame, T auto body, Z/X state, P print config
      </div>
    </div>
  );
}
