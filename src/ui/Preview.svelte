<script lang="ts">
  import { formatBytes, formatChange } from '../engine/filename';
  import { OUTPUT_FORMATS } from '../engine/formats';
  import { cloneImage, type RGBAImage } from '../engine/image';
  import { PREVIEW_SIZE, type Preview } from './toolState.svelte';
  import type { AnyToolState, LiveRender } from './types';

  interface Props {
    page: AnyToolState;
    /** Draws the page's effect (e.g. the watermark) live on the preview. */
    live?: LiveRender;
    /** Offer "Generate preview": the exact file, shown here without saving it. */
    trials?: boolean;
  }
  let { page, live, trials = false }: Props = $props();

  /** live: instant approximation; compare: processed result; trial: generated preview. */
  type View = 'live' | 'compare' | 'trial';
  let view = $state<View>('live');
  let zoom = $state<'fit' | 'full'>('fit');
  let split = $state(50);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let liveCanvas = $state<HTMLCanvasElement>();
  let beforeCanvas = $state<HTMLCanvasElement>();
  let afterCanvas = $state<HTMLCanvasElement>();
  /**
   * What the canvases hold right now. The on-screen size follows this rather
   * than the Fit / Close-up buttons, so while a new image is still loading the
   * old one keeps its size and shape instead of jumping or stretching.
   */
  let display = $state({ w: 0, h: 0, zoomed: false });

  const file = $derived(page.selected);
  const hasResult = $derived(!!file?.result);
  // When the settings now differ from the ones the trial was made with, it no
  // longer matches what would be saved.
  const trialStale = $derived(!!file?.trial && file.trial.key !== page.currentKey);

  // Switch to the comparison automatically when a result arrives.
  $effect(() => {
    if (file?.result) view = 'compare';
    else view = 'live';
  });
  $effect(() => {
    void file?.id;
    zoom = 'fit';
  });

  /**
   * Makes the preview, keeping the current picture on screen until it is
   * ready so the viewer doesn't empty out and jump in the meantime.
   */
  async function generate() {
    if (!file) return;
    const id = file.id;
    await page.tryFile(id);
    if (page.selected?.id === id && page.selected.trial) view = 'trial';
  }

  function paint(canvas: HTMLCanvasElement, img: RGBAImage) {
    canvas.width = img.width;
    canvas.height = img.height;
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }

  let renderToken = 0;

  // Live preview: the original, with the page's effect drawn on when it has one.
  $effect(() => {
    const id = file?.id;
    const canvas = liveCanvas;
    const effect = live;
    const closeUp = zoom === 'full' && !!effect;
    if (view !== 'live' || id === undefined || !canvas || file?.previewError) return;
    const token = ++renderToken;
    loading = true;
    error = null;
    void (async () => {
      try {
        const p: Preview = await page.preview(id, closeUp ? 4096 : PREVIEW_SIZE);
        if (token !== renderToken) return;
        const img = effect ? await effect.render(cloneImage(p.image), closeUp) : p.image;
        if (token !== renderToken) return;
        paint(canvas, img);
        display = { w: img.width, h: img.height, zoomed: closeUp };
      } catch (err) {
        if (token === renderToken) error = err instanceof Error ? err.message : String(err);
      } finally {
        if (token === renderToken) loading = false;
      }
    })();
  });

  // Before / after comparison (with the processed result or the generated preview).
  $effect(() => {
    const id = file?.id;
    const kind = view === 'trial' ? 'trial' : 'result';
    const output = kind === 'trial' ? file?.trial : file?.result;
    const [b, a] = [beforeCanvas, afterCanvas];
    const full = zoom === 'full';
    const size = full ? 0 : PREVIEW_SIZE;
    if (view === 'live' || id === undefined || !output || !b || !a) return;
    const token = ++renderToken;
    loading = true;
    error = null;
    void (async () => {
      try {
        const [before, after] = await Promise.all([
          page.preview(id, size),
          page.resultPreview(id, size, kind),
        ]);
        if (token !== renderToken) return;
        paint(b, before.image);
        paint(a, after.image);
        display = { w: before.image.width, h: before.image.height, zoomed: full };
      } catch (err) {
        if (token === renderToken) error = err instanceof Error ? err.message : String(err);
      } finally {
        if (token === renderToken) loading = false;
      }
    })();
  });

  // Fit never enlarges, so small images look the same size here as in the live view.
  const compareWidth = $derived(
    display.zoomed
      ? `${display.w}px`
      : display.h
        ? `min(100%, ${display.w}px, calc((68vh - 20px) * ${display.w / display.h}))`
        : '100%',
  );
  const generating = $derived(trials && file?.trialStatus === 'working');

  // Drag-to-pan when zoomed in.
  let scroller = $state<HTMLDivElement>();
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  function onPointerDown(e: PointerEvent) {
    if (!display.zoomed || !scroller || (e.target as HTMLElement).closest('input')) return;
    drag = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!drag || !scroller) return;
    scroller.scrollLeft = drag.left - (e.clientX - drag.x);
    scroller.scrollTop = drag.top - (e.clientY - drag.y);
  }
  function onPointerUp() {
    drag = null;
  }
</script>

<section class="preview" aria-label="Preview">
  {#if !file}
    <div class="empty">
      <p><strong>Add some images to get started.</strong></p>
      <ol>
        <li>Drop your images in (JPG, PNG, WebP, RAW, HEIC and more).</li>
        <li>Choose the settings on the right.</li>
        <li>Press the button under them, check the before/after, and download.</li>
      </ol>
      <p class="muted">Everything happens on your device. Nothing is uploaded.</p>
    </div>
  {:else}
    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="Preview mode">
        <button
          role="tab"
          aria-selected={view === 'live'}
          class:on={view === 'live'}
          onclick={() => (view = 'live')}
        >
          {live ? live.label : 'Original'}
        </button>
        <button
          role="tab"
          aria-selected={view === 'compare'}
          class:on={view === 'compare'}
          disabled={!hasResult}
          onclick={() => (view = 'compare')}
          title={hasResult ? '' : 'Process the file first'}
        >
          Before / after
        </button>
        {#if trials}
          <button
            role="tab"
            aria-selected={view === 'trial'}
            class:on={view === 'trial'}
            disabled={!file.trial && file.trialStatus !== 'working'}
            onclick={() => (view = 'trial')}
            title={file.trial ? '' : 'Press Generate preview first'}
          >
            Generated preview
          </button>
        {/if}
      </div>
      <div class="seg" aria-label="Zoom">
        <button
          class:on={zoom === 'fit'}
          aria-pressed={zoom === 'fit'}
          onclick={() => (zoom = 'fit')}>Fit</button
        >
        <button
          class:on={zoom === 'full'}
          aria-pressed={zoom === 'full'}
          onclick={() => (zoom = 'full')}
          disabled={view === 'live' && !live}
        >
          {view === 'live' ? 'Close-up' : '100%'}
        </button>
      </div>
      {#if trials}
        <button
          class="button small primary generate"
          data-testid="generate-preview"
          onclick={generate}
          disabled={!file.format || !!file.previewError || file.trialStatus === 'working'}
          title="Make the exact watermarked file for this image, without exporting it"
        >
          <!-- Both labels take up space, so the button keeps one width and the toolbar doesn't reflow. -->
          <span class="label" class:hidden={file.trialStatus === 'working'}>Generate preview</span>
          <span class="label" class:hidden={file.trialStatus !== 'working'}>Generating…</span>
        </button>
      {/if}
    </div>

    <div class="stage-wrap">
      <div
        class="stage"
        data-testid="preview-stage"
        class:zoomed={display.zoomed && view === 'compare'}
        bind:this={scroller}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        role="presentation"
      >
        {#if file.previewError}
          <p class="error">{file.previewError}</p>
        {:else if view === 'trial' && !file.trial}
          <p class="placeholder">
            {#if file.trialStatus === 'error'}
              <span class="error" data-testid="draft-error">{file.trialError}</span>
            {:else}
              Generating the exact result…
            {/if}
          </p>
        {:else if view === 'live'}
          <canvas
            bind:this={liveCanvas}
            class="img"
            class:closeup={display.zoomed}
            data-testid="live-preview"
            style:width={display.zoomed ? `min(100%, ${display.w * 4}px)` : null}
          ></canvas>
        {:else}
          <div
            class="compare"
            style:--split={`${split}%`}
            style:width={compareWidth}
            style:aspect-ratio={display.h ? `${display.w} / ${display.h}` : null}
          >
            <canvas bind:this={beforeCanvas} class="img" data-testid="before"></canvas>
            <canvas bind:this={afterCanvas} class="img after" data-testid="after"></canvas>
            <span class="tag left">Before</span>
            <span class="tag right">{view === 'trial' ? 'Preview' : 'After'}</span>
            <div class="divider" aria-hidden="true"></div>
            <input
              class="split"
              type="range"
              min="0"
              max="100"
              step="0.5"
              bind:value={split}
              aria-label="Move the before/after divider"
            />
          </div>
        {/if}
        {#if error}<p class="error">{error}</p>{/if}
      </div>
      <!-- Drawn over the picture, so showing it never moves anything. -->
      <span
        class="loading"
        class:on={loading || generating}
        role="status"
        data-testid="preview-loading"
        >{generating ? 'Generating preview…' : loading ? 'Loading…' : ''}</span
      >
    </div>

    {#if view === 'live' && zoom === 'full' && live}
      <p class="caption">{live.closeUpCaption}</p>
    {/if}
    {#if trials && view !== 'trial' && file.trialStatus === 'error'}
      <p class="error" data-testid="draft-error">{file.trialError}</p>
    {/if}

    {#if view === 'trial' && file.trial}
      <div class="result" data-testid="draft-info">
        <span>
          <strong>Preview</strong>
          · {OUTPUT_FORMATS[file.trial.format].label}
          · {file.trial.width}×{file.trial.height}
          · {formatBytes(file.file.size)} → {formatBytes(file.trial.size)}
          ({formatChange(file.file.size, file.trial.size)})
          {#if file.trial.lossless}<span class="badge">lossless</span>{/if}
        </span>
        <a
          class="button small"
          href={file.trial.url}
          download={file.trial.name}
          data-testid="draft-download">Download this preview</a
        >
      </div>
      {#if trialStale}
        <p class="stale" data-testid="draft-stale">
          Settings have changed since this preview was made. Press <strong>Generate preview</strong>
          to update it.
        </p>
      {/if}
      {#if file.trialStatus === 'error'}
        <p class="error" data-testid="draft-error">{file.trialError}</p>
      {/if}
      {#if !trialStale}
        <p class="caption">
          This is exactly the file that would be saved. Nothing has been exported.
        </p>
      {/if}
      {#if file.trial.notes.length}
        <ul class="notes">
          {#each file.trial.notes as n, i (i)}<li>{n}</li>{/each}
        </ul>
      {/if}
    {:else if view !== 'trial' && file.result}
      <div class="result" data-testid="result-info">
        <span>
          <strong>{OUTPUT_FORMATS[file.result.format].label}</strong>
          · {file.result.width}×{file.result.height}
          · {formatBytes(file.file.size)} → {formatBytes(file.result.size)}
          ({formatChange(file.file.size, file.result.size)})
          {#if file.result.lossless}<span class="badge">lossless</span>{/if}
        </span>
        <a class="button primary small" href={file.result.url} download={file.result.name}
          >Download</a
        >
      </div>
      {#if file.result.notes.length}
        <ul class="notes">
          {#each file.result.notes as n, i (i)}<li>{n}</li>{/each}
        </ul>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .preview {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .empty {
    border: 1px dashed var(--border-strong);
    border-radius: 14px;
    padding: 28px;
    background: var(--surface);
  }
  .empty ol {
    padding-left: 1.2em;
    line-height: 1.7;
  }
  .muted {
    color: var(--muted);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .seg {
    display: inline-flex;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 2px;
  }
  .seg button {
    border: 0;
    background: none;
    color: var(--muted);
    padding: 5px 10px;
    border-radius: 7px;
    cursor: pointer;
    font: inherit;
    font-size: 0.88rem;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
  }
  .seg button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .generate {
    display: inline-grid;
    justify-items: center;
  }
  .generate .label {
    grid-area: 1 / 1;
  }
  .label.hidden {
    visibility: hidden;
  }
  .stage-wrap {
    position: relative;
    min-width: 0;
  }
  .loading {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    pointer-events: none;
    font-size: 0.8rem;
    font-weight: 600;
    color: white;
    background: rgb(0 0 0 / 55%);
    padding: 2px 10px;
    border-radius: 999px;
    opacity: 0;
  }
  .loading.on {
    /* Only appears if loading takes a moment, so quick updates don't flicker. */
    animation: show 0.15s 0.3s forwards;
  }
  @keyframes show {
    to {
      opacity: 1;
    }
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    background: var(--checker);
    border: 1px solid var(--border);
    border-radius: 12px;
    min-height: 240px;
    max-height: 68vh;
    overflow: hidden;
    padding: 8px;
  }
  .stage.zoomed {
    overflow: auto;
    place-items: start;
    cursor: grab;
    touch-action: none;
  }
  .img {
    display: block;
    max-width: 100%;
    max-height: calc(68vh - 20px);
    height: auto;
  }
  .zoomed .img {
    max-width: none;
    max-height: none;
  }
  .img.closeup {
    height: auto;
    image-rendering: auto;
  }
  .compare {
    position: relative;
    display: grid;
    max-width: 100%;
  }
  .zoomed .compare {
    max-width: none;
  }
  .compare canvas {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
    max-height: none;
  }
  .after {
    clip-path: inset(0 0 0 var(--split));
  }
  .divider {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--split);
    width: 2px;
    margin-left: -1px;
    background: white;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 35%);
    pointer-events: none;
  }
  .split {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: ew-resize;
    margin: 0;
  }
  .tag {
    position: absolute;
    top: 8px;
    font-size: 0.75rem;
    font-weight: 700;
    background: rgb(0 0 0 / 55%);
    color: white;
    padding: 2px 8px;
    border-radius: 999px;
    pointer-events: none;
  }
  .tag.left {
    left: 8px;
  }
  .tag.right {
    right: 8px;
  }
  .caption {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .result {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .badge {
    font-size: 0.72rem;
    font-weight: 700;
    background: var(--success-soft);
    color: var(--success);
    padding: 1px 7px;
    border-radius: 999px;
    margin-left: 4px;
  }
  .notes {
    margin: 0;
    padding-left: 1.2em;
    color: var(--muted);
    font-size: 0.88rem;
  }
  .error {
    color: var(--danger);
  }
  .placeholder {
    color: var(--muted);
  }
  .stale {
    margin: 0;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--accent-soft);
    font-size: 0.9rem;
  }
</style>
