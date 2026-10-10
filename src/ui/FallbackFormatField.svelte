<script lang="ts">
  import { OUTPUT_FORMAT_ORDER, OUTPUT_FORMATS, type OutputFormat } from '../engine/formats';

  interface Props {
    value: OutputFormat;
    hint: string;
  }
  let { value = $bindable(), hint }: Props = $props();
</script>

<label class="field">
  <span>Format for RAW, HEIC, GIF and BMP</span>
  <select bind:value data-testid="fallback-format">
    {#each OUTPUT_FORMAT_ORDER as f (f)}
      <option value={f}>{OUTPUT_FORMATS[f].label}</option>
    {/each}
  </select>
  <span class="hint">{hint}</span>
</label>

<style>
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
