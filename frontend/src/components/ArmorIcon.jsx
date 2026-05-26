import { useState } from 'react';

export default function ArmorIcon({ imagePath, size = 54, borderRadius = 10, style = {} }) {
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
        style={{ width: '88%', height: '88%', objectFit: 'contain', imageRendering: 'pixelated' }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
