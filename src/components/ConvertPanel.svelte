<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { OUTPUT_FORMATS, type OutputFormat } from '../lib/formats';
  import FormatPicker from './FormatPicker.svelte';
  import Slider from './Slider.svelte';
  import Toggle from './Toggle.svelte';

  const s = app.settings;
  const info = $derived(OUTPUT_FORMATS[s.convert.format]);
  // FormatPicker can also offer "keep"; here it always holds a real format.
  // Bound straight to the settings so changes from elsewhere (e.g. an
  // uploaded settings file) show up immediately.
  const getFormat = (): OutputFormat | 'keep' => s.convert.format;
  const setFormat = (v: OutputFormat | 'keep') => {
    if (v !== 'keep') s.convert.format = v;
  };
</script>

<div class="panel">
  <p class="intro">Changes the file type.</p>
  <FormatPicker bind:value={getFormat, setFormat} name="convert-format" />
  {#if info.lossless && info.lossy}
    <Toggle
      label="Lossless"
      bind:checked={s.convert.lossless}
      hint={s.convert.lossless ? 'Pixels are stored exactly.' : 'Uses the quality setting below.'}
    />
  {:else if info.lossless}
    <p class="note">{info.label} is always lossless.</p>
  {:else}
    <p class="note">{info.label} is always lossy; choose a quality.</p>
  {/if}
  {#if info.lossy && (!info.lossless || !s.convert.lossless)}
    <Slider
      id="convert-quality"
      label="Quality"
      bind:value={s.convert.quality}
      min={30}
      max={100}
      hint="90 is visually lossless for almost every photo."
    />
  {/if}
</div>
