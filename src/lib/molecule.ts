/**
 * Geometry for the formaldehyde (H₂C=O) watermark. Pure maths only: the
 * caller supplies a function that measures label ink boxes, so this module
 * works the same in the browser, in a worker and in unit tests.
 */

export type MoleculeLayout = 'horizontal' | 'vertical';

export interface AtomLabels {
  /** Oxygen slot (double-bonded to the centre). */
  o: string;
  /** Carbon slot (centre). */
  c: string;
  /** First hydrogen slot. */
  h1: string;
  /** Second hydrogen slot. */
  h2: string;
}

export const CLASSIC_LABELS: AtomLabels = { o: 'O', c: 'C', h1: 'H', h2: 'H' };

/** Each custom slot can hold one or two characters, like an element symbol. */
export const MAX_LABEL_LENGTH = 2;

/** Ink bounding box of a label drawn with its pen at (0, 0) on the baseline. */
export interface InkBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type MeasureLabel = (text: string, fontSize: number) => InkBox;

export interface PlacedLabel {
  text: string;
  /** Where to put the pen (baseline origin) so the ink is centred on the atom. */
  penX: number;
  penY: number;
  box: InkBox;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MoleculeGeometry {
  labels: PlacedLabel[];
  bonds: Segment[];
  strokeWidth: number;
  fontSize: number;
  /** Tight bounds of everything drawn, including stroke thickness. */
  bounds: InkBox;
}

/** Proportions relative to the bond length; tuned to match the approved mock. */
export const PROPORTIONS = {
  fontSize: 0.42,
  strokeWidth: 0.055,
  doubleBondGap: 0.075,
  labelPadding: 0.1,
};

const SQRT3_2 = Math.sqrt(3) / 2;

/** Atom centres in bond-length units, with carbon at the origin. */
export function atomPositions(layout: MoleculeLayout): Record<keyof AtomLabels, [number, number]> {
  if (layout === 'horizontal') {
    return { c: [0, 0], o: [1, 0], h1: [-0.5, -SQRT3_2], h2: [-0.5, SQRT3_2] };
  }
  return { c: [0, 0], o: [0, -1], h1: [-SQRT3_2, 0.5], h2: [SQRT3_2, 0.5] };
}

/** Normalises a custom label: trims, and keeps at most two characters. */
export function sanitizeLabel(text: string, fallback: string): string {
  const chars = Array.from(text.trim());
  if (chars.length === 0) return fallback;
  return chars.slice(0, MAX_LABEL_LENGTH).join('');
}

/**
 * Distance from the centre of a box to its edge along a unit direction.
 * Used to stop bonds short of the letters they connect.
 */
export function distanceToBoxEdge(halfW: number, halfH: number, ux: number, uy: number): number {
  const tx = Math.abs(ux) < 1e-9 ? Infinity : halfW / Math.abs(ux);
  const ty = Math.abs(uy) < 1e-9 ? Infinity : halfH / Math.abs(uy);
  return Math.min(tx, ty);
}

export function moleculeGeometry(
  layout: MoleculeLayout,
  labels: AtomLabels,
  bondLength: number,
  measure: MeasureLabel,
): MoleculeGeometry {
  const fontSize = bondLength * PROPORTIONS.fontSize;
  const strokeWidth = Math.max(0.75, bondLength * PROPORTIONS.strokeWidth);
  const gap = bondLength * PROPORTIONS.doubleBondGap;
  const pad = bondLength * PROPORTIONS.labelPadding;
  const pos = atomPositions(layout);

  const placed: Record<keyof AtomLabels, PlacedLabel> = {} as Record<keyof AtomLabels, PlacedLabel>;
  for (const key of ['o', 'c', 'h1', 'h2'] as const) {
    const [ux, uy] = pos[key];
    const cx = ux * bondLength;
    const cy = uy * bondLength;
    const ink = measure(labels[key], fontSize);
    const inkCx = (ink.x1 + ink.x2) / 2;
    const inkCy = (ink.y1 + ink.y2) / 2;
    const penX = cx - inkCx;
    const penY = cy - inkCy;
    placed[key] = {
      text: labels[key],
      penX,
      penY,
      box: { x1: ink.x1 + penX, y1: ink.y1 + penY, x2: ink.x2 + penX, y2: ink.y2 + penY },
    };
  }

  const halfSize = (l: PlacedLabel): [number, number] => [
    Math.max(0, (l.box.x2 - l.box.x1) / 2),
    Math.max(0, (l.box.y2 - l.box.y1) / 2),
  ];

  // A bond between two atoms, trimmed so it stops `pad` short of each label.
  const bond = (a: keyof AtomLabels, b: keyof AtomLabels, offset = 0): Segment => {
    const ax = pos[a][0] * bondLength;
    const ay = pos[a][1] * bondLength;
    const bx = pos[b][0] * bondLength;
    const by = pos[b][1] * bondLength;
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const [aw, ah] = halfSize(placed[a]);
    const [bw, bh] = halfSize(placed[b]);
    const trimA = Math.min(len * 0.45, distanceToBoxEdge(aw, ah, ux, uy) + pad);
    const trimB = Math.min(len * 0.45, distanceToBoxEdge(bw, bh, ux, uy) + pad);
    const nx = -uy * offset;
    const ny = ux * offset;
    return {
      x1: ax + ux * trimA + nx,
      y1: ay + uy * trimA + ny,
      x2: bx - ux * trimB + nx,
      y2: by - uy * trimB + ny,
    };
  };

  const bonds = [bond('c', 'o', -gap), bond('c', 'o', gap), bond('c', 'h1'), bond('c', 'h2')];

  const bounds: InkBox = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const l of Object.values(placed)) {
    bounds.x1 = Math.min(bounds.x1, l.box.x1);
    bounds.y1 = Math.min(bounds.y1, l.box.y1);
    bounds.x2 = Math.max(bounds.x2, l.box.x2);
    bounds.y2 = Math.max(bounds.y2, l.box.y2);
  }
  const half = strokeWidth / 2;
  for (const s of bonds) {
    bounds.x1 = Math.min(bounds.x1, s.x1 - half, s.x2 - half);
    bounds.y1 = Math.min(bounds.y1, s.y1 - half, s.y2 - half);
    bounds.x2 = Math.max(bounds.x2, s.x1 + half, s.x2 + half);
    bounds.y2 = Math.max(bounds.y2, s.y1 + half, s.y2 + half);
  }

  return {
    labels: [placed.o, placed.c, placed.h1, placed.h2],
    bonds,
    strokeWidth,
    fontSize,
    bounds,
  };
}

export type WatermarkPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export const POSITIONS: WatermarkPosition[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

/**
 * Top-left pixel position for a box of the given size inside an image,
 * keeping `margin` pixels from the chosen edges.
 */
export function placeBox(
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
  margin: number,
  position: WatermarkPosition,
): { x: number; y: number } {
  const col = position.endsWith('left') ? 0 : position.endsWith('right') ? 2 : 1;
  const row = position.startsWith('top') ? 0 : position.startsWith('bottom') ? 2 : 1;
  const x = col === 0 ? margin : col === 2 ? imageW - margin - boxW : (imageW - boxW) / 2;
  const y = row === 0 ? margin : row === 2 ? imageH - margin - boxH : (imageH - boxH) / 2;
  return { x, y };
}
