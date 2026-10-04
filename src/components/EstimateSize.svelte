<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { formatBytes, formatChange } from '../lib/filename';
  import { OUTPUT_FORMATS } from '../lib/formats';
  import { stepLabel } from '../lib/progress';

  const file = $derived(app.selected);
  const estimate = $derived(file?.estimate ?? null);
  const working = $derived(file?.estimateStatus === 'working');
  const stale = $derived(!!estimate && estimate.key !== app.currentKey);
</script>

<div class="estimate">
  <button
    class="button"
    type="button"
    onclick={() => file && app.estimate(file.id)}
    disabled={!file?.format || !!file.previewError || working || app.busy}
    title="Makes the file for the selected image without saving it, to show its exact size"
    data-testid="estimate"
  >
    {working ? 'Estimating…' : 'Estimate size'}
  </button>
  {#if file && working}
    <p class="line" data-testid="estimate-step">
      {file.file.name}: {stepLabel(file.estimateStep ?? 'queued', file.estimateAttempt)}
    </p>
  {:else if file && estimate}
    <p class="line" data-testid="estimate-result">
      {file.file.name}: {formatBytes(file.file.size)} →
      <strong>{formatBytes(estimate.file.bytes.byteLength)}</strong>
      ({formatChange(file.file.size, estimate.file.bytes.byteLength)}) as {OUTPUT_FORMATS[
        estimate.file.format
      ].label}, {estimate.file.width}×{estimate.file.height}
    </p>
    {#if stale}
      <p class="stale" data-testid="estimate-stale">
        Settings have changed since. Press <strong>Estimate size</strong> again to update it.
      </p>
    {:else if estimate.file.notes.length}
      <ul class="notes">
        {#each estimate.file.notes as n, i (i)}<li>{n}</li>{/each}
      </ul>
    {/if}
  {:else if file?.estimateStatus === 'error'}
    <p class="line error" data-testid="estimate-error">{file.estimateError}</p>
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
