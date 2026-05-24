import { useRef, useEffect } from 'react';
import { BACKEND_URL } from '../../utils/constants';

const FRAME_SIZE = 64;
const ALPHA_THRESHOLD = 12;

function resolveSheetSrc(path, cls) {
  if (!path) return '';
  if (path.startsWith('/generated/')) return `${BACKEND_URL}${path}`;
  return path;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEAPON CONFIG — vienintelė vieta keisti poziciją.
// Visi skaičiai yra FRAKCIJOS (0–1), todėl rezultatas IDENTIŠKAS visose ekrano
// dydžiuose (72, 90, 150...). Ištaisai vienoje vietoje → teisinga visur.
//
//  pivotX / pivotY  — kur ant CANVAS (0=kairė/viršus, 1=dešinė/apačia)
//                     atsidurs ginklo rankena.
//                     Charakterio dešinė ranka ≈ (0.62, 0.59).
//                     Keisk šiuos jei ginklas per toli / per arti rankos.
//
//  gripX / gripY    — kur GINKLO BOUNDING BOX viduje yra rankena.
//                     1.0/1.0 = apatinis dešinysis kampas (slash sheets).
//                     0.5/1.0 = apatinis centras (staffai).
//
//  row / col        — kuris 64×64 kadras iš weapon sprite sheet.
//
//  rotate           — laipsniai: 0=normalus, 180=aukštyn kojom, -45=pasvirę kairėn.
// ═══════════════════════════════════════════════════════════════════════════════

const WEAPONS = {
  '/items/warrior_katana.png': {
    row: 65, col: 2,
    pivotX: 0.80, pivotY: 0.56,
    gripX: 0.9, gripY: 0.85,
    rotate: 180,
  },
  '/items/mage_staff.png': {
    row: 64, col: 1,
    pivotX: 0.55, pivotY: 0.72,
    gripX: 0.5, gripY: 1.0,
    rotate: 0,
  },
  '/items/rogue_scimitar.png': {
    row: 65, col: 2,
    pivotX: 0.65, pivotY: 0.54,
    gripX: 0.9, gripY: 0.85,
    rotate: 0,
  },
};

// ─────────────────────────────────────────────────────────────────────────────

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

function detectFrameBounds(img, srcX, srcY, frameSize) {
  try {
    const tmp = document.createElement('canvas');
    tmp.width = frameSize;
    tmp.height = frameSize;
    const t = tmp.getContext('2d');
    t.imageSmoothingEnabled = false;
    t.drawImage(img, srcX, srcY, frameSize, frameSize, 0, 0, frameSize, frameSize);
    const data = t.getImageData(0, 0, frameSize, frameSize).data;
    let minX = frameSize, minY = frameSize, maxX = 0, maxY = 0, count = 0;
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        if (data[(y * frameSize + x) * 4 + 3] > ALPHA_THRESHOLD) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    if (count >= 8 && maxX > minX && maxY > minY) {
      return { minX, minY, maxX, maxY };
    }
  } catch (_) {}
  return null;
}

function drawCharacterFrame(ctx, charImg, size, charFrameSize, fitToContent) {
  const srcX = 0;
  const srcY = 11 * charFrameSize;
  if (!fitToContent) {
    ctx.drawImage(charImg, srcX, srcY, charFrameSize, charFrameSize, 0, 0, size, size);
    return;
  }

  const bounds = detectFrameBounds(charImg, srcX, srcY, charFrameSize);
  if (!bounds) {
    ctx.drawImage(charImg, srcX, srcY, charFrameSize, charFrameSize, 0, 0, size, size);
    return;
  }

  const padding = Math.round(charFrameSize * 0.08);
  const contentW = bounds.maxX - bounds.minX + 1;
  const contentH = bounds.maxY - bounds.minY + 1;
  const cropSize = Math.min(charFrameSize, Math.max(contentW, contentH) + padding * 2);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const cropX = Math.max(0, Math.min(charFrameSize - cropSize, Math.round(centerX - cropSize / 2)));
  const cropY = Math.max(0, Math.min(charFrameSize - cropSize, Math.round(centerY - cropSize / 2)));
  ctx.drawImage(charImg, srcX + cropX, srcY + cropY, cropSize, cropSize, 0, 0, size, size);
}

function drawScene(ctx, charImg, weaponImg, weaponSrc, size, charFrameSize = FRAME_SIZE, fitToContent = false) {
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  drawCharacterFrame(ctx, charImg, size, charFrameSize, fitToContent);

  if (!weaponImg || !weaponSrc) return;

  const cfg = WEAPONS[weaponSrc] ?? { row: 65, col: 2, pivotX: 0.62, pivotY: 0.59, gripX: 0.9, gripY: 0.85, rotate: 0 };
  const b = detectBounds(weaponImg, cfg.row, cfg.col);
  if (!b) return;

  const scale = (size * 0.42) / Math.max(b.bw, b.bh);
  const dw = Math.round(b.bw * scale);
  const dh = Math.round(b.bh * scale);

  const px = size * cfg.pivotX;
  const py = size * cfg.pivotY;

  ctx.save();
  ctx.translate(px, py);
  if (cfg.rotate) ctx.rotate((cfg.rotate * Math.PI) / 180);
  ctx.drawImage(weaponImg, b.srcX + b.bx, b.srcY + b.by, b.bw, b.bh, -dw * cfg.gripX, -dh * cfg.gripY, dw, dh);
  ctx.restore();
}

export default function CharPreview({ cls = 'warrior', size = 88, weaponSrc = null, sheetPath = null, fitToContent = false, style = {} }) {
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
    const charFrameSize = sheetPath ? 128 : FRAME_SIZE;
    const charSrc = resolveSheetSrc(sheetPath, cls);
    if (!charSrc) {
      fallback();
      return () => { alive = false; };
    }
    charImg.src = charSrc;
    charImg.onerror = fallback;

    if (weaponSrc) {
      const weaponImg = new Image();
      weaponImg.src = weaponSrc;
      let charDone = false, weaponDone = false;
      const tryDraw = () => {
        if (charDone && weaponDone && alive) drawScene(ctx, charImg, weaponImg, weaponSrc, size, charFrameSize, fitToContent);
      };
      charImg.onload = () => { charDone = true; tryDraw(); };
      weaponImg.onload = () => { weaponDone = true; tryDraw(); };
      weaponImg.onerror = () => { if (charDone && alive) drawScene(ctx, charImg, null, null, size, charFrameSize, fitToContent); };
    } else {
      charImg.onload = () => { if (alive) drawScene(ctx, charImg, null, null, size, charFrameSize, fitToContent); };
    }

    return () => { alive = false; };
  }, [cls, size, weaponSrc, sheetPath, fitToContent]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', borderRadius: 10, flexShrink: 0, ...style }}
    />
  );
}
