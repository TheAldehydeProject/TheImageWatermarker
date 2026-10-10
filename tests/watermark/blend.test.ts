import { describe, expect, it } from 'vitest';
import {
  BLEND_MODES,
  blendColor,
  compositeMask,
  dissolveNoise,
  isBlendMode,
  type BlendMode,
  type Mask,
} from '../../src/tools/watermark/blend';
import { solid } from '../helpers';

const close = (a: number[], b: number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const mask = (w: number, h: number, v = 1): Mask => ({
  width: w,
  height: h,
  data: new Float32Array(w * h).fill(v),
});

describe('blend modes', () => {
  it('offers the full Photoshop set plus extras, with unique ids', () => {
    expect(BLEND_MODES.length).toBe(36);
    expect(new Set(BLEND_MODES.map((m) => m.id)).size).toBe(36);
    expect(isBlendMode('overlay')).toBe(true);
    expect(isBlendMode('nope')).toBe(false);
  });

  it('matches known values', () => {
    const b: [number, number, number] = [0.2, 0.5, 0.8];
    const s: [number, number, number] = [0.6, 0.6, 0.6];
    const expectations: Partial<Record<BlendMode, number[]>> = {
      normal: [0.6, 0.6, 0.6],
      multiply: [0.12, 0.3, 0.48],
      screen: [0.68, 0.8, 0.92],
      darken: [0.2, 0.5, 0.6],
      lighten: [0.6, 0.6, 0.8],
      difference: [0.4, 0.1, 0.2],
      exclusion: [0.56, 0.5, 0.44],
      'linear-dodge': [0.8, 1, 1],
      'linear-burn': [0, 0.1, 0.4],
      subtract: [0, 0, 0.2],
      // overlay = hard light with layers swapped
      overlay: [2 * 0.2 * 0.6, 1 - 2 * 0.5 * 0.4, 1 - 2 * 0.2 * 0.4],
      average: [0.4, 0.55, 0.7],
      'hard-mix': [0, 1, 1],
    };
    for (const [mode, expected] of Object.entries(expectations)) {
      expect(close(blendColor(mode as BlendMode, b, s), expected), mode).toBe(true);
    }
  });

  it('keeps every mode within 0..1 for a grid of inputs', () => {
    const steps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    for (const { id } of BLEND_MODES) {
      for (const bv of steps) {
        for (const sv of steps) {
          const out = blendColor(id, [bv, 1 - bv, 0.5], [sv, 0.3, 1 - sv]);
          for (const v of out) {
            expect(Number.isFinite(v), id).toBe(true);
            expect(v, id).toBeGreaterThanOrEqual(-1e-9);
            expect(v, id).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }
    }
  });

  it('component modes behave as defined', () => {
    // Luminosity of black onto a colour gives black; colour of grey keeps the backdrop's luminance.
    expect(close(blendColor('luminosity', [0.5, 0.2, 0.1], [0, 0, 0]), [0, 0, 0])).toBe(true);
    const c = blendColor('color', [0.5, 0.5, 0.5], [1, 0, 0]);
    const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    expect(lum).toBeCloseTo(0.5, 6);
    expect(c[0]).toBeGreaterThan(c[1]);
    // Saturation from a grey source removes all colour.
    const g = blendColor('saturation', [0.8, 0.2, 0.4], [0.5, 0.5, 0.5]);
    expect(g[0]).toBeCloseTo(g[1], 9);
    expect(g[1]).toBeCloseTo(g[2], 9);
  });

  it('dissolve noise is deterministic and spread out', () => {
    expect(dissolveNoise(10, 20)).toBe(dissolveNoise(10, 20));
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += dissolveNoise(i, i * 3);
    expect(sum / 1000).toBeGreaterThan(0.4);
    expect(sum / 1000).toBeLessThan(0.6);
  });
});

describe('compositeMask', () => {
  it('normal mode at full opacity paints the colour', () => {
    const img = solid(4, 4, [10, 20, 30, 255]);
    compositeMask(img, mask(2, 2), {
      x: 1,
      y: 1,
      color: [200, 100, 50],
      opacity: 1,
      mode: 'normal',
    });
    expect(Array.from(img.data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    const i = (1 * 4 + 1) * 4;
    expect(Array.from(img.data.subarray(i, i + 4))).toEqual([200, 100, 50, 255]);
  });

  it('opacity mixes the colour with the photo', () => {
    const img = solid(1, 1, [0, 0, 0, 255]);
    compositeMask(img, mask(1, 1), {
      x: 0,
      y: 0,
      color: [255, 255, 255],
      opacity: 0.5,
      mode: 'normal',
    });
    expect(img.data[0]).toBe(128);
  });

  it('a zero mask or zero opacity changes nothing', () => {
    const img = solid(3, 3, [9, 8, 7, 255]);
    const before = new Uint8ClampedArray(img.data);
    compositeMask(img, mask(3, 3, 0), {
      x: 0,
      y: 0,
      color: [255, 0, 0],
      opacity: 1,
      mode: 'overlay',
    });
    compositeMask(img, mask(3, 3, 1), {
      x: 0,
      y: 0,
      color: [255, 0, 0],
      opacity: 0,
      mode: 'overlay',
    });
    expect(img.data).toEqual(before);
  });

  it('clips masks that hang off the image edges', () => {
    const img = solid(3, 3, [0, 0, 0, 255]);
    compositeMask(img, mask(4, 4), {
      x: -2,
      y: 1,
      color: [255, 255, 255],
      opacity: 1,
      mode: 'normal',
    });
    expect(img.data[(2 * 3 + 1) * 4]).toBe(255); // inside
    expect(img.data[(2 * 3 + 2) * 4]).toBe(0); // beyond the mask's right edge
    expect(img.data[0]).toBe(0); // above the mask
  });

  it('on a transparent pixel, the watermark colour shows with its own alpha', () => {
    const img = solid(1, 1, [0, 0, 0, 0]);
    compositeMask(img, mask(1, 1), {
      x: 0,
      y: 0,
      color: [255, 0, 0],
      opacity: 0.5,
      mode: 'multiply',
    });
    expect(Array.from(img.data)).toEqual([255, 0, 0, 128]);
  });

  it('multiply with white leaves the photo unchanged', () => {
    const img = solid(2, 2, [12, 34, 56, 255]);
    compositeMask(img, mask(2, 2), {
      x: 0,
      y: 0,
      color: [255, 255, 255],
      opacity: 1,
      mode: 'multiply',
    });
    expect(Array.from(img.data.subarray(0, 4))).toEqual([12, 34, 56, 255]);
  });

  it('dissolve only ever writes fully-on or untouched pixels', () => {
    const img = solid(20, 20, [0, 0, 0, 255]);
    compositeMask(img, mask(20, 20), {
      x: 0,
      y: 0,
      color: [255, 255, 255],
      opacity: 0.5,
      mode: 'dissolve',
    });
    const values = new Set<number>();
    for (let i = 0; i < img.data.length; i += 4) values.add(img.data[i]);
    expect([...values].sort((a, b) => a - b)).toEqual([0, 255]);
  });
});
