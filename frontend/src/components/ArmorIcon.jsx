import { useState } from 'react';

function getEnchantColor(level) {
  const n = Number(level || 0);
  if (n >= 10) return '#ff2200';
  if (n >= 8) return '#ff8a00';
  if (n >= 6) return '#aa00ff';
  if (n >= 5) return '#002299';
  if (n >= 1) return '#3399ff';
  return '';
}

function getEnchantStyle(level) {
  const n = Number(level || 0);
  const color = getEnchantColor(n);
  if (!color) return {};
  const strength = n >= 10 ? 13 : n >= 8 ? 11 : n >= 6 ? 9 : n >= 5 ? 8 : 6;
  return {
    filter: `drop-shadow(0 0 ${strength}px ${color}) drop-shadow(0 0 ${Math.max(3, Math.round(strength * 0.45))}px ${color})`,
  };
}

export default function ArmorIcon({ imagePath, size = 54, borderRadius = 10, enchantLevel = 0, style = {} }) {
  const [failed, setFailed] = useState(false);
  if (failed || !imagePath) return null;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius,
        background: 'rgba(10,14,28,0.93)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        ...style,
      }}
    >
      <img
        src={imagePath}
        alt=""
        style={{
          width: '88%',
          height: '88%',
          objectFit: 'contain',
          imageRendering: 'pixelated',
          ...getEnchantStyle(enchantLevel),
        }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
