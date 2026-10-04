import { describe, expect, it } from 'vitest';
import {
  atomPositions,
  CLASSIC_LABELS,
  distanceToBoxEdge,
  moleculeGeometry,
  placeBox,
  POSITIONS,
  sanitizeLabel,
  type InkBox,
  type MeasureLabel,
  type Segment,
} from '../src/lib/molecule';

/** Monospace-ish fake font: each character is 0.6em wide and 0.7em tall. */
const measure: MeasureLabel = (text, size) => ({
  x1: 0,
  y1: -0.7 * size,
  x2: 0.6 * size * Array.from(text).length,
  y2: 0,
});

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function segmentHitsBox(s: Segment, b: InkBox): boolean {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = s.x1 + (s.x2 - s.x1) * t;
    const y = s.y1 + (s.y2 - s.y1) * t;
    if (x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2) return true;
  }
  return false;
}

describe('atom positions', () => {
  for (const layout of ['horizontal', 'vertical'] as const) {
    it(`${layout}: every atom is one bond length from carbon at 120° angles`, () => {
      const p = atomPositions(layout);
      for (const k of ['o', 'h1', 'h2'] as const) expect(dist(p.c, p[k])).toBeCloseTo(1, 9);
      expect(dist(p.o, p.h1)).toBeCloseTo(Math.sqrt(3), 9);
      expect(dist(p.h1, p.h2)).toBeCloseTo(Math.sqrt(3), 9);
    });
  }

  it('horizontal puts oxygen to the right, vertical puts it on top', () => {
    expect(atomPositions('horizontal').o).toEqual([1, 0]);
    expect(atomPositions('vertical').o).toEqual([0, -1]);
  });
});

describe('moleculeGeometry', () => {
  for (const layout of ['horizontal', 'vertical'] as const) {
    for (const labels of [CLASSIC_LABELS, { o: 'Ag', c: 'Zn', h1: 'Cl', h2: 'W' }]) {
      it(`${layout} with ${Object.values(labels).join('')}: bonds never touch letters`, () => {
        const g = moleculeGeometry(layout, labels, 100, measure);
        expect(g.bonds).toHaveLength(4);
        for (const bond of g.bonds) {
          expect(Math.hypot(bond.x2 - bond.x1, bond.y2 - bond.y1)).toBeGreaterThan(5);
          for (const l of g.labels) expect(segmentHitsBox(bond, l.box)).toBe(false);
        }
      });
    }
  }

  it('centres each label on its atom', () => {
    const g = moleculeGeometry('horizontal', CLASSIC_LABELS, 100, measure);
    const o = g.labels[0];
    expect((o.box.x1 + o.box.x2) / 2).toBeCloseTo(100, 6);
    expect((o.box.y1 + o.box.y2) / 2).toBeCloseTo(0, 6);
  });

  it('draws the C=O bond as two parallel lines', () => {
    const g = moleculeGeometry('horizontal', CLASSIC_LABELS, 100, measure);
    const [a, b] = g.bonds;
    expect(a.y1).toBeCloseTo(a.y2, 9);
    expect(b.y1).toBeCloseTo(b.y2, 9);
    expect(Math.abs(a.y1 - b.y1)).toBeCloseTo(15, 6);
  });

  it('wider custom letters get shorter bonds but the same shape', () => {
    const narrow = moleculeGeometry('horizontal', CLASSIC_LABELS, 100, measure);
    const wide = moleculeGeometry('horizontal', { ...CLASSIC_LABELS, c: 'Cl' }, 100, measure);
    const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    expect(len(wide.bonds[0])).toBeLessThan(len(narrow.bonds[0]));
    expect(wide.labels[1].text).toBe('Cl');
  });

  it('bounds contain all letters and bonds', () => {
    const g = moleculeGeometry('vertical', CLASSIC_LABELS, 80, measure);
    for (const l of g.labels) {
      expect(l.box.x1).toBeGreaterThanOrEqual(g.bounds.x1);
      expect(l.box.x2).toBeLessThanOrEqual(g.bounds.x2);
      expect(l.box.y1).toBeGreaterThanOrEqual(g.bounds.y1);
      expect(l.box.y2).toBeLessThanOrEqual(g.bounds.y2);
    }
  });

  it('scales with the bond length', () => {
    const a = moleculeGeometry('horizontal', CLASSIC_LABELS, 50, measure);
    const b = moleculeGeometry('horizontal', CLASSIC_LABELS, 100, measure);
    expect(b.bounds.x2 - b.bounds.x1).toBeCloseTo(2 * (a.bounds.x2 - a.bounds.x1), 1);
    expect(b.fontSize).toBe(2 * a.fontSize);
  });
});

describe('helpers', () => {
  it('distanceToBoxEdge', () => {
    expect(distanceToBoxEdge(10, 5, 1, 0)).toBe(10);
    expect(distanceToBoxEdge(10, 5, 0, 1)).toBe(5);
    expect(distanceToBoxEdge(10, 10, Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(10 * Math.SQRT2, 9);
  });

  it('sanitizeLabel keeps one or two characters', () => {
    expect(sanitizeLabel('  N ', 'O')).toBe('N');
    expect(sanitizeLabel('Xyz', 'O')).toBe('Xy');
    expect(sanitizeLabel('   ', 'O')).toBe('O');
    expect(sanitizeLabel('😀ab', 'O')).toBe('😀a');
  });

  it('placeBox handles all nine positions', () => {
    expect(POSITIONS).toHaveLength(9);
    expect(placeBox(1000, 800, 100, 50, 20, 'bottom-right')).toEqual({ x: 880, y: 730 });
    expect(placeBox(1000, 800, 100, 50, 20, 'top-left')).toEqual({ x: 20, y: 20 });
    expect(placeBox(1000, 800, 100, 50, 20, 'center')).toEqual({ x: 450, y: 375 });
    expect(placeBox(1000, 800, 100, 50, 20, 'top')).toEqual({ x: 450, y: 20 });
    expect(placeBox(1000, 800, 100, 50, 20, 'left')).toEqual({ x: 20, y: 375 });
  });
});
