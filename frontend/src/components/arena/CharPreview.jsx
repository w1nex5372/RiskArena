import { useRef, useEffect } from 'react';

const FRAME_SIZE = 64;
const ALPHA_THRESHOLD = 12;

const WEAPON_OVERLAY_FRAME = {
  '/items/warrior_katana.png': { row: 67, col: 4, handX: 0.68, handY: 0.86, flip: true,  rotate: 0 },
  '/items/mage_staff.png':     { row: 64, col: 1, handX: 0.55, handY: 0.78, flip: false, rotate: -0.6 },
  '/items/rogue_scimitar.png': { row: 67, col: 4, handX: 0.68, handY: 0.86, flip: true,  rotate: 0 },
};

function detectBounds(img, row, col) {
  try {
    const srcX = col * FRAME_SIZE;
    const srcY = row * FRAME_SIZE;
    const tmp = document.createElement('canvas');
    tmp.width = FRAME_SIZE; tmp.height = FRAME_SIZE;
    const t = tmp.getContext('2d');
    t.imageSmoothingEnabled = false;
    t.drawImage(img, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, FRAME_SIZE, FRAME_SIZE);
    const data = t.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data;
    let minX = FRAME_SIZE, minY = FRAME_SIZE, maxX = 0, maxY = 0, count = 0;
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        if (data[(y * FRAME_SIZE + x) * 4 + 3] > ALPHA_THRESHOLD) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    if (count >= 4 && maxX > minX && maxY > minY)
      return { srcX, srcY, bx: minX, by: minY, bw: maxX - minX + 1, bh: maxY - minY + 1 };
  } catch (_) {}
  return null;
}

function drawScene(ctx, charImg, weaponImg, weaponSrc, size) {
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(charImg, 0, 11 * FRAME_SIZE, FRAME_SIZE, FRAME_SIZE, 0, 0, size, size);

  if (!weaponImg || !weaponSrc) return;

  const cfg = WEAPON_OVERLAY_FRAME[weaponSrc] || { row: 67, col: 4, handX: 0.68, handY: 0.86, flip: true, rotate: 0 };
  const b = detectBounds(weaponImg, cfg.row, cfg.col);
  if (!b) return;

  const scale = (size * 0.42) / Math.max(b.bw, b.bh);
  const dw = Math.round(b.bw * scale);
  const dh = Math.round(b.bh * scale);

  const hx = size * cfg.handX;
  const hy = size * cfg.handY;

  ctx.save();
  ctx.translate(hx, hy);
  if (cfg.rotate) ctx.rotate(cfg.rotate);
  if (cfg.flip) {
    ctx.scale(-1, 1);
    ctx.drawImage(weaponImg, b.srcX + b.bx, b.srcY + b.by, b.bw, b.bh, -dw * 0.1, -dh * 0.85, dw, dh);
  } else {
    ctx.drawImage(weaponImg, b.srcX + b.bx, b.srcY + b.by, b.bw, b.bh, -dw * 0.9, -dh * 0.85, dw, dh);
  }
  ctx.restore();
}

export default function CharPreview({ cls = 'warrior', size = 88, weaponSrc = null, style = {} }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const canvas = canvasRef.current;
    if (!canvas) return () => { alive = false; };
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    function fallback() {
      if (!alive) return;
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.roundRect?.(0, 0, size, size, 10);
      ctx.fill();
      ctx.fillStyle = '#c9a84c';
      ctx.font = `bold ${size * 0.4}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cls[0].toUpperCase(), size / 2, size / 2);
    }

    const charImg = new Image();
    charImg.src = `/characters/${cls}_sheet.png`;
    charImg.onerror = fallback;

    if (weaponSrc) {
      const weaponImg = new Image();
      weaponImg.src = weaponSrc;
      let charDone = false;
      let weaponDone = false;
      const tryDraw = () => {
        if (charDone && weaponDone && alive) drawScene(ctx, charImg, weaponImg, weaponSrc, size);
      };
      charImg.onload = () => { charDone = true; tryDraw(); };
      weaponImg.onload = () => { weaponDone = true; tryDraw(); };
      weaponImg.onerror = () => {
        if (charDone && alive) drawScene(ctx, charImg, null, null, size);
      };
    } else {
      charImg.onload = () => { if (alive) drawScene(ctx, charImg, null, null, size); };
    }

    return () => { alive = false; };
  }, [cls, size, weaponSrc]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', borderRadius: 10, flexShrink: 0, ...style }}
    />
  );
}
