/**
 * Browser/worker side of the watermark: loads the bundled font and
 * rasterises the molecule with OffscreenCanvas. Letters are drawn from the
 * font's vector outlines so the watermark looks identical on every device.
 */
import opentype from 'opentype.js';
import fontUrl from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import type { Mask } from './blend';
import type { RGBAImage } from '../../engine/image';
import type { InkBox, MeasureLabel } from './molecule';
import { applyWatermark, type WatermarkPlacement, type WatermarkSettings } from './watermark';

let fontPromise: Promise<opentype.Font | null> | null = null;

export function loadWatermarkFont(): Promise<opentype.Font | null> {
  fontPromise ??= fetch(fontUrl)
    .then((r) => {
      if (!r.ok) throw new Error(`Font request failed: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => opentype.parse(buf))
    .catch((err: unknown) => {
      console.error('Could not load the watermark font; using the system font instead.', err);
      return null;
    });
  return fontPromise;
}

const fallbackFont = (size: number) =>
  `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;

function fontHasGlyphs(font: opentype.Font, text: string): boolean {
  for (const ch of text) {
    if (font.charToGlyph(ch).index === 0) return false;
  }
  return true;
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
function scratchContext(): OffscreenCanvasRenderingContext2D {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  return measureCtx;
}

const emptyBox = (size: number): InkBox => ({ x1: 0, y1: -size * 0.7, x2: size * 0.3, y2: 0 });

export interface LabelRenderer {
  measure: MeasureLabel;
  draw(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    size: number,
  ): void;
}

export function createLabelRenderer(font: opentype.Font | null): LabelRenderer {
  const useFont = (text: string) => font !== null && fontHasGlyphs(font, text);
  return {
    measure(text, size) {
      if (useFont(text)) {
        const bb = font!.getPath(text, 0, 0, size).getBoundingBox();
        if ([bb.x1, bb.y1, bb.x2, bb.y2].every(Number.isFinite) && bb.x2 > bb.x1) {
          return { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 };
        }
        return emptyBox(size);
      }
      const ctx = scratchContext();
      ctx.font = fallbackFont(size);
      const m = ctx.measureText(text);
      const box = {
        x1: -m.actualBoundingBoxLeft,
        y1: -m.actualBoundingBoxAscent,
        x2: m.actualBoundingBoxRight,
        y2: m.actualBoundingBoxDescent,
      };
      return box.x2 > box.x1 ? box : emptyBox(size);
    },
    draw(ctx, text, x, y, size) {
      if (useFont(text)) {
        ctx.fill(new Path2D(font!.getPath(text, x, y, size).toPathData(3)));
      } else {
        ctx.font = fallbackFont(size);
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, x, y);
      }
    },
  };
}

export function rasterizeMolecule(p: WatermarkPlacement, labels: LabelRenderer): Mask {
  const canvas = new OffscreenCanvas(Math.max(1, p.width), Math.max(1, p.height));
  const ctx = canvas.getContext('2d')!;
  ctx.translate(-p.originX, -p.originY);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = p.geometry.strokeWidth;
  for (const s of p.geometry.bonds) {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  for (const l of p.geometry.labels) {
    labels.draw(ctx, l.text, l.penX, l.penY, p.geometry.fontSize);
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const data = new Float32Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) data[i] = pixels[i * 4 + 3] / 255;
  return { width: canvas.width, height: canvas.height, data };
}

/** Draws the watermark onto the image in place. */
export async function renderWatermark(
  img: RGBAImage,
  settings: WatermarkSettings,
): Promise<WatermarkPlacement> {
  const labels = createLabelRenderer(await loadWatermarkFont());
  return applyWatermark(img, settings, labels.measure, (p) => rasterizeMolecule(p, labels));
}
