<script lang="ts">
  import { app } from '../lib/app.svelte';
  import FormatPicker from './FormatPicker.svelte';
  import Segmented from './Segmented.svelte';
  import Slider from './Slider.svelte';
  import TargetSize from './TargetSize.svelte';
  import Toggle from './Toggle.svelte';

  const s = app.settings;
</script>

<div class="panel">
  <p class="intro">Watermark, convert and compress in one go.</p>
  <Toggle
    label="Add the watermark"
    bind:checked={s.all.watermark}
    hint="Uses the settings from the Watermark tab."
  />
  <FormatPicker bind:value={s.all.format} allowKeep name="all-format" />
  <Segmented
    label="Compression"
    name="all-mode"
    bind:value={s.all.mode}
    options={[
      {
        value: 'lossless',
        label: 'Lossless',
        hint: 'Exact pixels where the format allows it (JPG is always lossy).',
      },
      { value: 'visual', label: 'Visually lossless', hint: 'High quality, much smaller files.' },
      {
        value: 'target',
        label: 'Target size',
        hint: 'Aims for a file size you choose, at the best quality that fits. AVIF gets the most quality into the fewest bytes.',
      },
    ]}
  />
  {#if s.all.mode === 'target'}
    <TargetSize id="all-target" bind:value={s.all.target} />
  {:else if s.all.mode === 'visual' || s.all.format === 'jpeg'}
    <Slider id="all-quality" label="Quality" bind:value={s.all.quality} min={30} max={100} />
  {/if}
</div>
