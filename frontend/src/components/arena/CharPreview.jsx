import { useRef, useEffect } from 'react';

// Renders a single front-facing frame from an LPC spritesheet.
// LPC row 11 col 0 = south-facing idle.
export default function CharPreview({ cls = 'warrior', size = 88, style = {} }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = `/characters/${cls}_sheet.png`;
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 11 * 64, 64, 64, 0, 0, size, size);
    };
    img.onerror = () => {
      // Draw fallback class initial
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.roundRect(0, 0, size, size, 10);
      ctx.fill();
      ctx.fillStyle = '#c9a84c';
      ctx.font = `bold ${size * 0.4}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cls[0].toUpperCase(), size / 2, size / 2);
    };
  }, [cls, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', borderRadius: 10, flexShrink: 0, ...style }}
    />
  );
}
