import { describe, expect, it } from 'vitest';
import type { Mask } from '../src/lib/blend';
import type { MeasureLabel } from '../src/lib/molecule';
import {
  applyWatermark,
  DEFAULT_WATERMARK,
  hexToRgb,
  luminanceUnder,
  normalizeWatermark,
  placeWatermark,
  resolveColor,
  type WatermarkPlacement,
  type WatermarkSettings,
} from '../src/lib/watermark';
import { solid } from './helpers';

const measure: MeasureLabel = (text, size) => ({
  x1: 0,
  y1: -0.7 * size,
  x2: 0.6 * size * text.length,
  y2: 0,
});
/** Stand-in for the canvas rasteriser: a solid block the size of the drawing. */
const block = (p: WatermarkPlacement): Mask => ({
  width: p.width,
  height: p.height,
  data: new Float32Array(p.width * p.height).fill(1),
});

const settings = (over: Partial<WatermarkSettings> = {}): WatermarkSettings => ({
  ...DEFAULT_WATERMARK,
  ...over,
});

describe('normalizeWatermark', () => {
  it('fills in defaults for missing or broken values', () => {
    expect(normalizeWatermark(undefined)).toEqual(DEFAULT_WATERMARK);
    const n = normalizeWatermark({
      size: 999,
      opacity: -4,
      blendMode: 'sparkle',
      position: 'nowhere',
      customColor: 'red',
      customLabels: { o: '  ', c: 'Xyz', h1: 7 },
      motion: { enabled: true, angle: 400, style: 'wobble' },
    });
    expect(n.size).toBe(20);
    expect(n.opacity).toBe(5);
    expect(n.blendMode).toBe('normal');
    expect(n.position).toBe('bottom-right');
    expect(n.customColor).toBe('#ffffff');
    expect(n.customLabels).toEqual({ o: 'O', c: 'Xy', h1: 'H', h2: 'H' });
    expect(n.motion).toEqual({ enabled: true, amount: 35, angle: 359, style: 'trail' });
  });

  it('keeps valid choices', () => {
    const n = normalizeWatermark({
      ...DEFAULT_WATERMARK,
      variant: 'custom',
      layout: 'vertical',
      blendMode: 'overlay',
    });
    expect(n.variant).toBe('custom');
    expect(n.layout).toBe('vertical');
    expect(n.blendMode).toBe('overlay');
  });
});

describe('placeWatermark', () => {
  it('sits in the bottom-right corner by default, sized from the shorter side', () => {
    const p = placeWatermark(4000, 3000, settings(), measure);
    expect(p.bondLength).toBeCloseTo(3000 * 0.04, 6);
    const margin = 3000 * 0.03;
    // Right and bottom edges of the drawing (excluding the 2px padding) sit at the margin.
    expect(p.x + p.width - 2).toBeGreaterThan(4000 - margin - 2);
    expect(p.x + p.width - 2).toBeLessThanOrEqual(4000 - margin + 1);
    expect(p.y + p.height - 2).toBeLessThanOrEqual(3000 - margin + 1);
    // Small: well under a tenth of the image area.
    expect((p.width * p.height) / (4000 * 3000)).toBeLessThan(0.01);
  });

  it('motion length follows the amount setting', () => {
    const off = placeWatermark(1000, 1000, settings(), measure);
    expect(off.motionLength).toBe(0);
    const on = placeWatermark(
      1000,
      1000,
      settings({ motion: { enabled: true, amount: 50, angle: 0, style: 'blur' } }),
      measure,
    );
    expect(on.motionLength).toBeCloseTo(0.5 * 3 * on.bondLength, 6);
  });
});

describe('colour', () => {
  it('auto picks white on dark photos and black on light ones', () => {
    expect(resolveColor(settings(), 0.1)).toEqual([255, 255, 255]);
    expect(resolveColor(settings(), 0.9)).toEqual([0, 0, 0]);
    expect(resolveColor(settings({ colorMode: 'custom', customColor: '#336699' }), 0.1)).toEqual([
      0x33, 0x66, 0x99,
    ]);
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
  });

  it('measures luminance only under the mask', () => {
    const img = solid(10, 10, [0, 0, 0, 255]);
    for (let i = 0; i < 50 * 4; i += 4) img.data.set([255, 255, 255, 255], i); // top half white
    const m: Mask = { width: 10, height: 2, data: new Float32Array(20).fill(1) };
    expect(luminanceUnder(img, m, 0, 0)).toBeCloseTo(1, 6);
    expect(luminanceUnder(img, m, 0, 8)).toBeCloseTo(0, 6);
  });
});

describe('applyWatermark', () => {
  it('only touches pixels inside the watermark area', () => {
    const img = solid(400, 300, [20, 20, 20, 255]);
    const p = applyWatermark(img, settings(), measure, block);
    let changedOutside = 0;
    let changedInside = 0;
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 400; x++) {
        const changed = img.data[(y * 400 + x) * 4] !== 20;
        const inside = x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height;
        if (changed && !inside) changedOutside++;
        if (changed && inside) changedInside++;
      }
    }
    expect(changedOutside).toBe(0);
    expect(changedInside).toBe(p.width * p.height);
    // Dark photo → white watermark at 55% opacity.
    const i = ((p.y + 3) * 400 + p.x + 3) * 4;
    expect(img.data[i]).toBe(Math.round(20 + (255 - 20) * 0.55));
  });

  it('motion blur extends the affected area', () => {
    const img = solid(400, 300, [200, 200, 200, 255]);
    const p = applyWatermark(
      img,
      settings({
        position: 'center',
        motion: { enabled: true, amount: 50, angle: 0, style: 'trail' },
      }),
      measure,
      block,
    );
    const row = Math.round(p.y + p.height / 2);
    const leftOfBox = (row * 400 + p.x - 5) * 4;
    expect(img.data[leftOfBox]).toBeLessThan(200); // the trail reaches beyond the sharp drawing
  });
});
