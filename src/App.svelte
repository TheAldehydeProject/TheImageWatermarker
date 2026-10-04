<script lang="ts">
  import AllInOnePanel from './components/AllInOnePanel.svelte';
  import CompressPanel from './components/CompressPanel.svelte';
  import ConvertPanel from './components/ConvertPanel.svelte';
  import DropZone from './components/DropZone.svelte';
  import EstimateSize from './components/EstimateSize.svelte';
  import FileList from './components/FileList.svelte';
  import MoleculeIcon from './components/MoleculeIcon.svelte';
  import OutputOptions from './components/OutputOptions.svelte';
  import Preview from './components/Preview.svelte';
  import WatermarkPanel from './components/WatermarkPanel.svelte';
  import { app } from './lib/app.svelte';
  import type { Tool } from './lib/settings';

  const tools: { id: Tool; label: string; verb: string }[] = [
    { id: 'compress', label: 'Compress', verb: 'Compress' },
    { id: 'convert', label: 'Convert', verb: 'Convert' },
    { id: 'watermark', label: 'Watermark', verb: 'Watermark' },
    { id: 'all', label: 'All-in-one', verb: 'Process' },
  ];
  const active = $derived(tools.find((t) => t.id === app.settings.tool)!);
  const usable = $derived(app.files.filter((f) => f.format).length);
  const percent = $derived(Math.floor(app.batchProgress * 100));

  let zipUrl: string | null = null;
  async function downloadZip() {
    const blob = await app.zipResults();
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

  function onTabKey(e: KeyboardEvent) {
    const i = tools.findIndex((t) => t.id === app.settings.tool);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tools.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + tools.length) % tools.length;
    if (next >= 0) {
      e.preventDefault();
      app.setTool(tools[next].id);
      document.getElementById(`tab-${tools[next].id}`)?.focus();
    }
  }
</script>

<header class="top">
  <div class="brand">
    <span class="logo"><MoleculeIcon size={48} /></span>
    <div>
      <h1>The Image Watermarker</h1>
      <p>
        Compress, convert and watermark images. Everything runs in your browser, so nothing is
        uploaded.
      </p>
    </div>
  </div>
</header>

<div class="tabs" role="tablist" aria-label="Tools" tabindex="-1" onkeydown={onTabKey}>
  {#each tools as t (t.id)}
    <button
      id={`tab-${t.id}`}
      role="tab"
      aria-selected={app.settings.tool === t.id}
      aria-controls="tool-panel"
      tabindex={app.settings.tool === t.id ? 0 : -1}
      class:active={app.settings.tool === t.id}
      onclick={() => app.setTool(t.id)}
    >
      {t.label}
    </button>
  {/each}
</div>

<main class="layout">
  <section class="files-col" aria-label="Files">
    <DropZone onfiles={(f) => app.addFiles(f)} compact={app.files.length > 0} />
    {#if app.files.length}
      <div class="list-head">
        <span>{app.files.length} {app.files.length === 1 ? 'image' : 'images'}</span>
        <button class="link" onclick={() => app.clear()}>Clear all</button>
      </div>
      <FileList />
    {/if}
  </section>

  <section class="preview-col">
    <Preview />
  </section>

  <div
    class="settings-col"
    id="tool-panel"
    role="tabpanel"
    aria-labelledby={`tab-${app.settings.tool}`}
  >
    <h2>{active.label}</h2>
    {#if app.settings.tool === 'compress'}
      <CompressPanel />
    {:else if app.settings.tool === 'convert'}
      <ConvertPanel />
    {:else if app.settings.tool === 'watermark'}
      <WatermarkPanel />
    {:else}
      <AllInOnePanel />
    {/if}
    <OutputOptions />
    <div class="actions">
      {#if app.settings.tool !== 'watermark' && app.selected}
        <!-- The Watermark tab has Generate preview, which shows the size too. -->
        <EstimateSize />
      {/if}
      <button
        class="button primary"
        disabled={!usable || app.busy}
        onclick={() => app.processAll()}
        data-testid="process"
      >
        {#if app.busy}
          Working… {app.progress.done}/{app.progress.total}
        {:else}
          {active.verb} {usable || ''} {usable === 1 ? 'image' : 'images'}
        {/if}
      </button>
      <button
        class="button"
        disabled={!app.doneCount || app.busy}
        onclick={downloadZip}
        data-testid="zip"
      >
        Download all (ZIP)
      </button>
      {#if app.busy}
        <div class="batch" data-testid="batch-progress">
          <div
            class="bar"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style:width={`${app.batchProgress * 100}%`}></span>
          </div>
          <span class="batch-text"
            >{app.progress.done} of {app.progress.total} done · {percent}%</span
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
