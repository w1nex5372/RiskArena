import { useRef, useEffect, useState } from 'react';

// Row to use per weapon sheet for the icon frame (south-attack mid-swing).
// Row 64 = south-attack block for all three sheets (within bounds: warrior/rogue 70 rows, mage 66 rows).
// Best frame per sheet: east-attack col 4 = sword at peak extension (widest bounding box).
// mage row 64 col 1 confirmed working; warrior/rogue use east-attack row 67 col 4.
const ICON_FRAME = {
  '/items/warrior_katana.png':  { row: 67, col: 4 },
  '/items/mage_staff.png':      { row: 64, col: 1 },
  '/items/rogue_scimitar.png':  { row: 67, col: 4 },
};
const FRAME_SIZE = 64;
const ALPHA_THRESHOLD = 12;
const PADDING = 3;

function detectAndDraw(ctx, img, imagePath, canvasSize) {
  const { row, col } = ICON_FRAME[imagePath] || { row: 64, col: 3 };
  const srcX = col * FRAME_SIZE;
  const srcY = row * FRAME_SIZE;

  // Scan non-transparent pixels via offscreen canvas
  const tmp = document.createElement('canvas');
  tmp.width = FRAME_SIZE;
  tmp.height = FRAME_SIZE;
  const t = tmp.getContext('2d');
  t.imageSmoothingEnabled = false;
  t.drawImage(img, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, FRAME_SIZE, FRAME_SIZE);

  const data = t.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE).data;
  let minX = FRAME_SIZE, minY = FRAME_SIZE, maxX = 0, maxY = 0;
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (data[(y * FRAME_SIZE + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  ctx.fillStyle = 'rgba(10,14,28,0.93)';
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.imageSmoothingEnabled = false;

  if (maxX <= minX || maxY <= minY) {
    // Frame is empty — fall back to full-frame draw
    ctx.drawImage(img, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, canvasSize, canvasSize);
    return;
  }

  const bx = Math.max(0, minX - PADDING);
  const by = Math.max(0, minY - PADDING);
  const bw = Math.min(FRAME_SIZE, maxX + PADDING + 1) - bx;
  const bh = Math.min(FRAME_SIZE, maxY + PADDING + 1) - by;

  // Scale to fill canvas while preserving aspect ratio, then center
  const scale = Math.min((canvasSize * 0.88) / bw, (canvasSize * 0.88) / bh);
  const dw = bw * scale;
  const dh = bh * scale;
  const dx = (canvasSize - dw) / 2;
  const dy = (canvasSize - dh) / 2;

  ctx.drawImage(img, srcX + bx, srcY + by, bw, bh, dx, dy, dw, dh);
}

export default function WeaponIcon({ imagePath, size = 60, borderRadius = 10, style = {} }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!imagePath) return;
    setFailed(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.src = imagePath;
    img.onload = () => detectAndDraw(ctx, img, imagePath, size);
    img.onerror = () => setFailed(true);
  }, [imagePath, size]);

  if (failed) return null;

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', borderRadius, flexShrink: 0, ...style }}
    />
  );
}
