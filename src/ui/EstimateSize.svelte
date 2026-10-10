<script lang="ts">
  import { formatBytes, formatChange } from '../engine/filename';
  import { OUTPUT_FORMATS } from '../engine/formats';
  import { stepLabel } from '../engine/progress';
  import type { AnyToolState } from './types';

  interface Props {
    page: AnyToolState;
  }
  let { page }: Props = $props();

  const file = $derived(page.selected);
  const estimate = $derived(file?.trial ?? null);
  const working = $derived(file?.trialStatus === 'working');
  const stale = $derived(!!estimate && estimate.key !== page.currentKey);
</script>

<div class="estimate">
  <button
    class="button"
    type="button"
    onclick={() => file && page.tryFile(file.id)}
    disabled={!file?.format || !!file.previewError || working || page.busy}
    title="Makes the file for the selected image without saving it, to show its exact size"
    data-testid="estimate"
  >
    {working ? 'Estimating…' : 'Estimate size'}
  </button>
  {#if file && working}
    <p class="line" data-testid="estimate-step">
      {file.file.name}: {stepLabel(file.trialStep ?? 'queued', file.trialAttempt)}
    </p>
  {:else if file && estimate}
    <p class="line" data-testid="estimate-result">
      {file.file.name}: {formatBytes(file.file.size)} →
      <strong>{formatBytes(estimate.size)}</strong>
      ({formatChange(file.file.size, estimate.size)}) as {OUTPUT_FORMATS[estimate.format].label}, {estimate.width}×{estimate.height}
    </p>
    {#if stale}
      <p class="stale" data-testid="estimate-stale">
        Settings have changed since. Press <strong>Estimate size</strong> again to update it.
      </p>
    {:else if estimate.notes.length}
      <ul class="notes">
        {#each estimate.notes as n, i (i)}<li>{n}</li>{/each}
      </ul>
    {/if}
  {:else if file?.trialStatus === 'error'}
    <p class="line error" data-testid="estimate-error">{file.trialError}</p>
  {:else}
    <p class="line muted">Shows the exact size the selected image will have, before you save.</p>
  {/if}
</div>

<style>
  .estimate {
    display: grid;
    gap: 6px;
  }
  .line {
    margin: 0;
    font-size: 0.88rem;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: var(--danger);
  }
  .stale {
    margin: 0;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--accent-soft);
    font-size: 0.85rem;
  }
  .notes {
    margin: 0;
    padding-left: 1.2em;
    color: var(--muted);
    font-size: 0.85rem;
  }
</style>
