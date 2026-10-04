import { describe, expect, it } from 'vitest';
import type { Mask } from '../src/lib/blend';
import { motionBlurMask, TRAIL_STRENGTH } from '../src/lib/motionBlur';

function dot(size: number, cx: number, cy: number, r: number): Mask {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) data[y * size + x] = 1;
  }
  return { width: size, height: size, data };
}

const total = (m: Mask) => m.data.reduce((a, b) => a + b, 0);
const at = (m: Mask, x: number, y: number) => m.data[y * m.width + x];

describe('motionBlurMask', () => {
  it('does nothing at zero length', () => {
    const src = dot(20, 10, 10, 4);
    const r = motionBlurMask(src, { length: 0, angle: 0, style: 'blur' });
    expect(r.mask).toBe(src);
    expect(r.offsetX).toBe(0);
  });

  it('blur spreads the shape along the direction but keeps its total amount', () => {
    const src = dot(30, 15, 15, 4);
    const r = motionBlurMask(src, { length: 12, angle: 0, style: 'blur' });
    expect(total(r.mask)).toBeCloseTo(total(src), 0);
    const cy = 15 + r.offsetY;
    // Horizontally smeared: wider than the dot, but not taller.
    expect(at(r.mask, 15 + r.offsetX + 9, cy)).toBeGreaterThan(0);
    expect(at(r.mask, 15 + r.offsetX, cy + 6)).toBe(0);
    // And the centre is no longer fully covered.
    expect(at(r.mask, 15 + r.offsetX, cy)).toBeLessThan(1);
  });

  it('trail keeps the watermark sharp and streaks behind the direction of travel', () => {
    const src = dot(30, 15, 15, 3);
    const r = motionBlurMask(src, { length: 10, angle: 0, style: 'trail' });
    const cx = 15 + r.offsetX;
    const cy = 15 + r.offsetY;
    expect(at(r.mask, cx, cy)).toBeCloseTo(1, 6); // still solid
    const behind = at(r.mask, cx - 6, cy);
    const ahead = at(r.mask, cx + 6, cy);
    expect(behind).toBeGreaterThan(0.1);
    expect(behind).toBeLessThanOrEqual(TRAIL_STRENGTH + 1e-6);
    expect(ahead).toBe(0);
    // Fades with distance.
    expect(at(r.mask, cx - 9, cy)).toBeLessThan(at(r.mask, cx - 5, cy));
  });

  it('follows the angle: 90° moves down, so the trail is above', () => {
    const src = dot(30, 15, 15, 3);
    const r = motionBlurMask(src, { length: 10, angle: 90, style: 'trail' });
    const cx = 15 + r.offsetX;
    const cy = 15 + r.offsetY;
    expect(at(r.mask, cx, cy - 6)).toBeGreaterThan(0.1);
    expect(at(r.mask, cx, cy + 6)).toBe(0);
  });

  it('pads the result so nothing is clipped', () => {
    const src = dot(10, 5, 5, 2);
    const r = motionBlurMask(src, { length: 7, angle: 45, style: 'blur' });
    expect(r.mask.width).toBe(10 + 2 * r.offsetX);
    expect(r.offsetX).toBeGreaterThanOrEqual(7);
  });
});
