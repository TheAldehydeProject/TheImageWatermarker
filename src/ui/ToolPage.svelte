<script lang="ts">
  import type { Snippet } from 'svelte';
  import { TOOL_LABELS, type ToolId } from '../engine/settings';
  import DropZone from './DropZone.svelte';
  import EstimateSize from './EstimateSize.svelte';
  import FileList from './FileList.svelte';
  import MoleculeIcon from './MoleculeIcon.svelte';
  import type { AnyToolState } from './types';

  interface Props {
    page: AnyToolState;
    /** The verb on the Process button, e.g. "Compress". */
    verb: string;
    intro: string;
    /** Show "Estimate size" for the selected image. */
    estimate?: boolean;
    panel: Snippet;
    preview: Snippet;
  }
  let { page, verb, intro, estimate = false, panel, preview }: Props = $props();

  const tool = $derived(page.tool.id);
  const tools: ToolId[] = ['compress', 'convert', 'watermark'];
  const usable = $derived(page.files.filter((f) => f.format).length);
  const percent = $derived(Math.floor(page.batchProgress * 100));

  let zipUrl: string | null = null;
  async function downloadZip() {
    const blob = await page.zipResults();
    if (!blob) return;
    if (zipUrl) URL.revokeObjectURL(zipUrl);
    zipUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = 'images.zip';
    document.body.append(a);
    a.click();
    a.remove();
  }
</script>

<header class="top">
  <div class="brand">
    <a class="logo" href="../" aria-label="The Image Watermarker: all tools"
      ><MoleculeIcon size={48} /></a
    >
    <div>
      <h1><a href="../">The Image Watermarker</a> · {TOOL_LABELS[tool]}</h1>
      <p>{intro} Everything runs in your browser, so nothing is uploaded.</p>
    </div>
  </div>
</header>

<nav class="tool-nav" aria-label="Tools">
  {#each tools as t (t)}
    <a href={`../${t}/`} aria-current={t === tool ? 'page' : undefined}>{TOOL_LABELS[t]}</a>
  {/each}
</nav>

<main class="layout">
  <section class="files-col" aria-label="Files">
    <DropZone onfiles={(f) => page.addFiles(f)} compact={page.files.length > 0} />
    {#if page.files.length}
      <div class="list-head">
        <span>{page.files.length} {page.files.length === 1 ? 'image' : 'images'}</span>
        <button class="link" onclick={() => page.clear()}>Clear all</button>
      </div>
      <FileList {page} />
    {/if}
  </section>

  <section class="preview-col">
    {@render preview()}
  </section>

  <div class="settings-col">
    <h2>{TOOL_LABELS[tool]}</h2>
    {@render panel()}
    <div class="actions">
      {#if estimate && page.selected}
        <EstimateSize {page} />
      {/if}
      <button
        class="button primary"
        disabled={!usable || page.busy}
        onclick={() => page.processAll()}
        data-testid="process"
      >
        {#if page.busy}
          Working… {page.progress.done}/{page.progress.total}
        {:else}
          {verb} {usable || ''} {usable === 1 ? 'image' : 'images'}
        {/if}
      </button>
      <button
        class="button"
        disabled={!page.doneCount || page.busy}
        onclick={downloadZip}
        data-testid="zip"
      >
        Download all (ZIP)
      </button>
      {#if page.busy}
        <div class="batch" data-testid="batch-progress">
          <div
            class="bar"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style:width={`${page.batchProgress * 100}%`}></span>
          </div>
          <span class="batch-text"
            >{page.progress.done} of {page.progress.total} done · {percent}%</span
          >
        </div>
      {/if}
    </div>
  </div>
</main>

<footer class="foot">
  <p>
    Lossless output keeps every pixel identical. JPEG XL gives the smallest files, but only Safari
    can display it today (Chrome, Edge and Firefox still need a setting switched on). WebP works
    everywhere.
  </p>
</footer>
