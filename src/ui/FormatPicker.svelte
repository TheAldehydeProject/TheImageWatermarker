<script lang="ts">
  import { OUTPUT_FORMAT_ORDER, OUTPUT_FORMATS, type OutputFormat } from '../engine/formats';

  interface Props {
    value: OutputFormat | 'keep';
    allowKeep?: boolean;
    name: string;
  }
  let { value = $bindable(), allowKeep = false, name }: Props = $props();
</script>

<fieldset class="formats">
  <legend>Save as</legend>
  {#if allowKeep}
    <label class:active={value === 'keep'}>
      <input type="radio" {name} value="keep" bind:group={value} />
      <span class="title">Same as original</span>
      <span class="note">Keeps each file's type where possible.</span>
    </label>
  {/if}
  {#each OUTPUT_FORMAT_ORDER as f (f)}
    <label class:active={value === f}>
      <input type="radio" {name} value={f} bind:group={value} />
      <span class="title">
        {OUTPUT_FORMATS[f].label}
        {#if f === 'webp'}<span class="badge">Recommended</span>{/if}
        {#if f === 'jxl'}<span class="badge muted">Smallest</span>{/if}
      </span>
      <span class="note">{OUTPUT_FORMATS[f].note}</span>
    </label>
  {/each}
</fieldset>

<style>
  .formats {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  legend {
    font-weight: 500;
    padding: 0;
    margin-bottom: 6px;
  }
  label {
    display: grid;
    gap: 2px;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    background: var(--surface);
    position: relative;
  }
  label.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .title {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .note {
    font-size: 0.83rem;
    color: var(--muted);
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--accent);
    color: var(--accent-contrast);
    padding: 1px 6px;
    border-radius: 999px;
  }
  .badge.muted {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
  }
</style>
