<script lang="ts">
  import { OUTPUT_FORMATS, type OutputFormat } from '../../engine/formats';
  import EffortField from '../../ui/EffortField.svelte';
  import FormatPicker from '../../ui/FormatPicker.svelte';
  import ResizeField from '../../ui/ResizeField.svelte';
  import SettingsFile from '../../ui/SettingsFile.svelte';
  import Slider from '../../ui/Slider.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import type { ToolState } from '../../ui/toolState.svelte';
  import type { ConvertSettings, ConvertSpec } from './settings';

  interface Props {
    page: ToolState<ConvertSettings, ConvertSpec>;
  }
  let { page }: Props = $props();
  const s = $derived(page.settings);
  const info = $derived(OUTPUT_FORMATS[s.format]);
  // FormatPicker can also offer "keep"; here it always holds a real format.
  // Bound straight to the settings so changes from elsewhere (e.g. an
  // uploaded settings file) show up immediately.
  const getFormat = (): OutputFormat | 'keep' => s.format;
  const setFormat = (v: OutputFormat | 'keep') => {
    if (v !== 'keep') s.format = v;
  };
</script>

<div class="panel">
  <p class="intro">Changes the file type.</p>
  <FormatPicker bind:value={getFormat, setFormat} name="convert-format" />
  {#if info.lossless && info.lossy}
    <Toggle
      label="Lossless"
      bind:checked={s.lossless}
      hint={s.lossless ? 'Pixels are stored exactly.' : 'Uses the quality setting below.'}
    />
  {:else if info.lossless}
    <p class="note">{info.label} is always lossless.</p>
  {:else}
    <p class="note">{info.label} is always lossy; choose a quality.</p>
  {/if}
  {#if info.lossy && (!info.lossless || !s.lossless)}
    <Slider
      id="convert-quality"
      label="Quality"
      bind:value={s.quality}
      min={30}
      max={100}
      hint="90 is visually lossless for almost every photo."
    />
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
      <EffortField bind:value={s.effort} />
      <SettingsFile {page} />
    </div>
  </details>
</div>
