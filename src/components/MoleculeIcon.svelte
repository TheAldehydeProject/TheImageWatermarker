<script lang="ts">
  import type { MoleculeLayout } from '../lib/molecule';

  interface Props {
    layout?: MoleculeLayout;
    size?: number;
    labels?: [string, string, string, string];
  }
  let { layout = 'horizontal', size = 32, labels = ['O', 'C', 'H', 'H'] }: Props = $props();

  // Same proportions as the real watermark (see lib/molecule.ts).
  const s3 = Math.sqrt(3) / 2;
  const pos = $derived(
    layout === 'horizontal'
      ? { o: [1, 0], c: [0, 0], h1: [-0.5, -s3], h2: [-0.5, s3] }
      : { o: [0, -1], c: [0, 0], h1: [-s3, 0.5], h2: [s3, 0.5] },
  );
  const view = $derived(layout === 'horizontal' ? '-0.85 -1.2 2.2 2.4' : '-1.25 -1.35 2.5 2.25');
  const trim = (a: number[], b: number[], t = 0.3) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    return [
      a[0] + (dx / len) * t,
      a[1] + (dy / len) * t,
      b[0] - (dx / len) * t,
      b[1] - (dy / len) * t,
    ];
  };
  const co = $derived(trim(pos.c, pos.o));
  const ch1 = $derived(trim(pos.c, pos.h1));
  const ch2 = $derived(trim(pos.c, pos.h2));
  const off = $derived.by(() => {
    const dx = pos.o[0] - pos.c[0];
    const dy = pos.o[1] - pos.c[1];
    return [-dy * 0.075, dx * 0.075];
  });
</script>

<svg
  width={size}
  height={size}
  viewBox={view}
  aria-hidden="true"
  fill="none"
  stroke="currentColor"
  stroke-width="0.07"
  stroke-linecap="round"
>
  <line x1={co[0] + off[0]} y1={co[1] + off[1]} x2={co[2] + off[0]} y2={co[3] + off[1]} />
  <line x1={co[0] - off[0]} y1={co[1] - off[1]} x2={co[2] - off[0]} y2={co[3] - off[1]} />
  <line x1={ch1[0]} y1={ch1[1]} x2={ch1[2]} y2={ch1[3]} />
  <line x1={ch2[0]} y1={ch2[1]} x2={ch2[2]} y2={ch2[3]} />
  <g
    fill="currentColor"
    stroke="none"
    font-size="0.42"
    font-weight="600"
    text-anchor="middle"
    dominant-baseline="central"
    font-family="Inter, system-ui, sans-serif"
  >
    <text x={pos.o[0]} y={pos.o[1]}>{labels[0]}</text>
    <text x={pos.c[0]} y={pos.c[1]}>{labels[1]}</text>
    <text x={pos.h1[0]} y={pos.h1[1]}>{labels[2]}</text>
    <text x={pos.h2[0]} y={pos.h2[1]}>{labels[3]}</text>
  </g>
</svg>
