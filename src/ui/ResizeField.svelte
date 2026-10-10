<script lang="ts">
  import type { ResizeSetting } from '../engine/settings';
  import Toggle from './Toggle.svelte';

  interface Props {
    value: ResizeSetting;
  }
  let { value = $bindable() }: Props = $props();
</script>

<Toggle
  label="Resize"
  bind:checked={value.enabled}
  hint="Shrinks images that are larger than the limits below. Never enlarges."
/>
{#if value.enabled}
  <div class="dims">
    <label>
      Max width
      <input type="number" min="0" step="1" bind:value={value.maxWidth} />
    </label>
    <span aria-hidden="true">×</span>
    <label>
      Max height
      <input type="number" min="0" step="1" bind:value={value.maxHeight} />
    </label>
    <span class="px">px (0 = no limit)</span>
  </div>
{/if}

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
</style>
