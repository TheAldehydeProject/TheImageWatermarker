<script lang="ts">
  import { OUTPUT_FORMATS } from '../../engine/formats';
  import EffortField from '../../ui/EffortField.svelte';
  import FallbackFormatField from '../../ui/FallbackFormatField.svelte';
  import ResizeField from '../../ui/ResizeField.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import SettingsFile from '../../ui/SettingsFile.svelte';
  import Slider from '../../ui/Slider.svelte';
  import TargetSize from '../../ui/TargetSize.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import type { ToolState } from '../../ui/toolState.svelte';
  import type { CompressSettings, CompressSpec } from './settings';

  interface Props {
    page: ToolState<CompressSettings, CompressSpec>;
  }
  let { page }: Props = $props();
  const s = $derived(page.settings);
</script>

<div class="panel">
  <p class="intro">Makes files smaller. Never hands back a file bigger than the original.</p>
  <Segmented
    label="Save as"
    name="compress-output"
    bind:value={s.output}
    options={[
      {
        value: 'keep',
        label: 'Keep format',
        hint: 'Each file stays in its own format (JPG stays JPG, PNG stays PNG…).',
      },
      {
        value: 'webp',
        label: 'WebP',
        hint: 'Every file becomes a WebP of the size you choose, using the most efficient WebP settings.',
      },
    ]}
  />

  {#if s.output === 'webp'}
    <TargetSize
      id="webp-target"
      bind:value={s.webpTarget}
      hint="Each image is saved as WebP at the highest quality that fits. A file that is already smaller stays no bigger than it was."
    />
  {:else}
    <Segmented
      label="Compression"
      name="compress-mode"
      bind:value={s.mode}
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
        {
          value: 'target',
          label: 'Target size',
          hint: 'Aims for a file size you choose, at the best quality that fits.',
        },
      ]}
    />
    {#if s.mode === 'visual'}
      <Slider
        id="compress-quality"
        label="Quality"
        bind:value={s.quality}
        min={50}
        max={100}
        hint="90 is visually lossless for almost every photo. PNG has no quality setting; it is reduced to 256 colours instead."
      />
    {:else if s.mode === 'target'}
      <TargetSize
        id="compress-target"
        bind:value={s.target}
        hint="Uses the highest quality that fits. Files already under the target are kept as they are."
      />
    {/if}
  {/if}

  {#if s.output === 'webp' || s.mode === 'target'}
    <Segmented
      label="If it doesn't fit at a clean quality"
      name="compress-too-big"
      bind:value={s.tooBig}
      options={[
        {
          value: 'shrink',
          label: 'Smaller size, clean look',
          hint: 'Quality stays at a clean level and the image is scaled down as much as needed.',
        },
        {
          value: 'lower-quality',
          label: 'Lower quality first',
          hint: 'Quality may drop as low as 20 before the image is scaled down: more pixels, but visible blur and blockiness.',
        },
      ]}
    />
  {/if}

  {#if s.output === 'keep'}
    <details class="explain">
      <summary>What happens to each format</summary>
      <ul>
        <li>
          <strong>JPG</strong>: lossless re-packing (optimised coding, pixels untouched), or
          re-saving at your quality.
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
          <strong>Target size</strong>: JPG, WebP, AVIF and JPEG XL get the highest quality that
          fits; PNG stays lossless if it fits, otherwise drops to 256 colours; TIFF can only be
          resized.
        </li>
        <li>
          <strong>RAW, HEIC, GIF, BMP</strong>: can't be written back, so they're saved as {OUTPUT_FORMATS[
            s.fallbackFormat
          ].label} (change under More options).
        </li>
      </ul>
      <p>You never get a bigger file back: if compression can't help, the original is kept.</p>
    </details>
  {/if}

  <details class="more">
    <summary>More options</summary>
    <div class="body">
      <ResizeField bind:value={s.resize} />
      <Toggle
        label="Remove camera data and location"
        bind:checked={s.stripMetadata}
        hint="Strips EXIF details such as GPS position, camera serial numbers and dates. Colour profiles are always kept."
      />
      {#if s.output === 'keep'}
        <FallbackFormatField
          bind:value={s.fallbackFormat}
          hint="These can't be saved in their own format, so they're saved in this one."
        />
        <EffortField bind:value={s.effort} />
      {/if}
      <SettingsFile {page} />
    </div>
  </details>
</div>
