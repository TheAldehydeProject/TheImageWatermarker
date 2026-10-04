<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { OUTPUT_FORMATS } from '../lib/formats';
  import Segmented from './Segmented.svelte';
  import Slider from './Slider.svelte';

  const s = app.settings;
</script>

<div class="panel">
  <p class="intro">Makes files smaller and keeps their format.</p>
  <Segmented
    label="Compression"
    name="compress-mode"
    bind:value={s.compress.mode}
    options={[
      {
        value: 'lossless',
        label: 'Lossless',
        hint: 'Every pixel stays exactly the same. Savings depend on how well the file was packed before.',
      },
      {
        value: 'visual',
        label: 'Visually lossless',
        hint: 'Re-saves at a high quality. Much smaller, with differences you cannot see at normal viewing sizes.',
      },
    ]}
  />
  {#if s.compress.mode === 'visual'}
    <Slider
      id="compress-quality"
      label="Quality"
      bind:value={s.compress.quality}
      min={50}
      max={100}
      hint="90 is visually lossless for almost every photo. PNG has no quality setting; it is reduced to 256 colours instead."
    />
  {/if}
  <details class="explain">
    <summary>What happens to each format</summary>
    <ul>
      <li>
        <strong>JPG</strong>: lossless re-packing (optimised coding, pixels untouched), or re-saving
        at your quality.
      </li>
      <li>
        <strong>PNG</strong>: lossless optimisation, or a 256-colour palette in visually lossless
        mode.
      </li>
      <li>
        <strong>WebP</strong>: lossless files are re-compressed; lossy ones can only shrink in
        visually lossless mode.
      </li>
      <li>
        <strong>AVIF / JPEG XL</strong>: already compressed; use visually lossless to shrink them.
      </li>
      <li><strong>TIFF</strong>: re-saved with lossless Deflate compression.</li>
      <li>
        <strong>RAW, HEIC, GIF, BMP</strong>: can't be written back, so they're saved as {OUTPUT_FORMATS[
          s.output.fallbackFormat
        ].label} (change under More options).
      </li>
    </ul>
    <p>You never get a bigger file back: if compression can't help, the original is kept.</p>
  </details>
</div>
