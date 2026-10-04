<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { OUTPUT_FORMAT_ORDER, OUTPUT_FORMATS } from '../lib/formats';
  import Segmented from './Segmented.svelte';
  import Toggle from './Toggle.svelte';

  const o = app.settings.output;
</script>

<details class="more">
  <summary>More options</summary>
  <div class="body">
    <Toggle
      label="Resize"
      bind:checked={o.resize.enabled}
      hint="Shrinks images that are larger than the limits below. Never enlarges."
    />
    {#if o.resize.enabled}
      <div class="dims">
        <label>
          Max width
          <input type="number" min="0" step="1" bind:value={o.resize.maxWidth} />
        </label>
        <span aria-hidden="true">×</span>
        <label>
          Max height
          <input type="number" min="0" step="1" bind:value={o.resize.maxHeight} />
        </label>
        <span class="px">px (0 = no limit)</span>
      </div>
    {/if}
    <Toggle
      label="Remove camera data and location"
      bind:checked={o.stripMetadata}
      hint="Strips EXIF details such as GPS position, camera serial numbers and dates. Colour profiles are always kept."
    />
    <label class="field">
      <span>Format for RAW, HEIC, GIF and BMP</span>
      <select bind:value={o.fallbackFormat}>
        {#each OUTPUT_FORMAT_ORDER as f (f)}
          <option value={f}>{OUTPUT_FORMATS[f].label}</option>
        {/each}
      </select>
      <span class="hint"
        >These can't be saved in their own format, so Compress and Watermark use this.</span
      >
    </label>
    <Segmented
      label="Effort"
      name="effort"
      bind:value={o.effort}
      options={[
        { value: 'balanced', label: 'Balanced', hint: 'Good compression at a comfortable speed.' },
        {
          value: 'maximum',
          label: 'Maximum',
          hint: 'Squeezes out a few more percent. Much slower on big images.',
        },
      ]}
    />
  </div>
</details>

<style>
  .dims {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px;
  }
  .dims label {
    display: grid;
    gap: 3px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .dims input {
    width: 7em;
  }
  .px {
    font-size: 0.85rem;
    color: var(--muted);
    padding-bottom: 6px;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field > span:first-child {
    font-weight: 500;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
