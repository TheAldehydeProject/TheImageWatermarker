<script lang="ts">
  import { app, PREVIEW_SIZE, type Preview } from '../lib/app.svelte';
  import { formatBytes, formatChange } from '../lib/filename';
  import { cloneImage, type RGBAImage } from '../lib/image';
  import { OUTPUT_FORMATS } from '../lib/formats';
  import { specKey } from '../lib/settings';
  import { loadWatermarkFont, renderWatermark } from '../lib/watermarkRender';

  /** live: instant approximation; compare: processed result; draft: generated preview. */
  type View = 'live' | 'compare' | 'draft';
  let view = $state<View>('live');
  let zoom = $state<'fit' | 'full'>('fit');
  let split = $state(50);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let liveCanvas = $state<HTMLCanvasElement>();
  let beforeCanvas = $state<HTMLCanvasElement>();
  let afterCanvas = $state<HTMLCanvasElement>();
  let display = $state({ w: 0, h: 0 });

  const file = $derived(app.selected);
  const tool = $derived(app.settings.tool);
  const showsWatermark = $derived(
    tool === 'watermark' || (tool === 'all' && app.settings.all.watermark),
  );
  const hasResult = $derived(!!file?.result);
  const canDraft = $derived(tool === 'watermark');
  // The settings a new preview would use; when they differ from the ones the
  // current preview was made with, it no longer matches what would be saved.
  const currentKey = $derived(canDraft ? specKey(app.watermarkSpec()) : '');
  const draftStale = $derived(!!file?.draft && file.draft.key !== currentKey);

  // Switch to the comparison automatically when a result arrives.
  $effect(() => {
    if (file?.result) view = 'compare';
    else view = 'live';
  });
  $effect(() => {
    void file?.id;
    zoom = 'fit';
  });
  // Generated previews only exist in the Watermark tab.
  $effect(() => {
    if (view === 'draft' && !canDraft) view = file?.result ? 'compare' : 'live';
  });

  function generate() {
    if (!file) return;
    view = 'draft';
    void app.generateDraft(file.id);
  }

  function paint(canvas: HTMLCanvasElement, img: RGBAImage) {
    canvas.width = img.width;
    canvas.height = img.height;
    canvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  }

  /** Copies a window of an image (for the watermark close-up). */
  function crop(img: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
    const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
    const cw = Math.max(1, Math.min(img.width - x0, Math.ceil(w)));
    const ch = Math.max(1, Math.min(img.height - y0, Math.ceil(h)));
    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let row = 0; row < ch; row++) {
      const src = ((y0 + row) * img.width + x0) * 4;
      out.set(img.data.subarray(src, src + cw * 4), row * cw * 4);
    }
    return { width: cw, height: ch, data: out };
  }

  let renderToken = 0;

  // Live preview: the original (plus the watermark when relevant).
  $effect(() => {
    const id = file?.id;
    const canvas = liveCanvas;
    const wm = $state.snapshot(app.settings.watermark);
    const withMark = showsWatermark;
    const closeUp = zoom === 'full' && withMark;
    if (view !== 'live' || id === undefined || !canvas || file?.previewError) return;
    const token = ++renderToken;
    loading = true;
    error = null;
    void (async () => {
      try {
        const p: Preview = await app.preview(id, closeUp ? 4096 : PREVIEW_SIZE);
        if (token !== renderToken) return;
        let img = p.image;
        if (withMark) {
          img = cloneImage(p.image);
          const placed = await renderWatermark(img, wm);
          if (closeUp) {
            const pad = placed.bondLength * 2 + placed.motionLength;
            img = crop(
              img,
              placed.x - pad,
              placed.y - pad,
              placed.width + pad * 2,
              placed.height + pad * 2,
            );
          }
        }
        if (token !== renderToken) return;
        paint(canvas, img);
        display = { w: img.width, h: img.height };
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
    const kind = view === 'draft' ? 'draft' : 'result';
    const output = kind === 'draft' ? file?.draft : file?.result;
    const [b, a] = [beforeCanvas, afterCanvas];
    const size = zoom === 'full' ? 0 : PREVIEW_SIZE;
    if (view === 'live' || id === undefined || !output || !b || !a) return;
    const token = ++renderToken;
    loading = true;
    error = null;
    void (async () => {
      try {
        const [before, after] = await Promise.all([
          app.preview(id, size),
          app.resultPreview(id, size, kind),
        ]);
        if (token !== renderToken) return;
        paint(b, before.image);
        paint(a, after.image);
        display = { w: before.image.width, h: before.image.height };
      } catch (err) {
        if (token === renderToken) error = err instanceof Error ? err.message : String(err);
      } finally {
        if (token === renderToken) loading = false;
      }
    })();
  });

  // Start loading the font early so the first live preview is quick.
  void loadWatermarkFont();

  const compareWidth = $derived(
    zoom === 'full'
      ? `${display.w}px`
      : display.h
        ? `min(100%, calc((68vh - 20px) * ${display.w / display.h}))`
        : '100%',
  );

  // Drag-to-pan when zoomed in.
  let scroller = $state<HTMLDivElement>();
  let drag: { x: number; y: number; left: number; top: number } | null = null;
  function onPointerDown(e: PointerEvent) {
    if (zoom !== 'full' || !scroller || (e.target as HTMLElement).closest('input')) return;
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
        <li>Pick a tool above: Compress, Convert, Watermark or All-in-one.</li>
        <li>Drop your images in (JPG, PNG, WebP, RAW, HEIC and more).</li>
        <li>Press <em>Process</em>, check the before/after, and download.</li>
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
          {showsWatermark ? 'Watermark preview' : 'Original'}
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
        {#if canDraft}
          <button
            role="tab"
            aria-selected={view === 'draft'}
            class:on={view === 'draft'}
            disabled={!file.draft && file.draftStatus !== 'working'}
            onclick={() => (view = 'draft')}
            title={file.draft ? '' : 'Press Generate preview first'}
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
          disabled={view === 'live' && !showsWatermark}
        >
          {view === 'live' ? 'Close-up' : '100%'}
        </button>
      </div>
      {#if canDraft}
        <button
          class="button small primary"
          data-testid="generate-preview"
          onclick={generate}
          disabled={!file.format || !!file.previewError || file.draftStatus === 'working'}
          title="Make the exact watermarked file for this image, without exporting it"
        >
          {file.draftStatus === 'working' ? 'Generating…' : 'Generate preview'}
        </button>
      {/if}
      {#if loading}<span class="loading" aria-live="polite">Loading…</span>{/if}
    </div>

    <div
      class="stage"
      class:zoomed={zoom === 'full' && view === 'compare'}
      bind:this={scroller}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      role="presentation"
    >
      {#if file.previewError}
        <p class="error">{file.previewError}</p>
      {:else if view === 'draft' && !file.draft}
        <p class="placeholder">
          {#if file.draftStatus === 'error'}
            <span class="error" data-testid="draft-error">{file.draftError}</span>
          {:else}
            Generating the exact result…
          {/if}
        </p>
      {:else if view === 'live'}
        <canvas
          bind:this={liveCanvas}
          class="img"
          class:closeup={zoom === 'full'}
          data-testid="live-preview"
          style:width={zoom === 'full' ? `min(100%, ${display.w * 4}px)` : null}
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
          <span class="tag right">{view === 'draft' ? 'Preview' : 'After'}</span>
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

    {#if view === 'live' && zoom === 'full'}
      <p class="caption">Close-up of the watermark, rendered from the full-resolution image.</p>
    {/if}

    {#if view === 'draft' && file.draft}
      <div class="result" data-testid="draft-info">
        <span>
          <strong>Preview</strong>
          · {OUTPUT_FORMATS[file.draft.format].label}
          · {file.draft.width}×{file.draft.height}
          · {formatBytes(file.file.size)} → {formatBytes(file.draft.size)}
          ({formatChange(file.file.size, file.draft.size)})
          {#if file.draft.lossless}<span class="badge">lossless</span>{/if}
        </span>
        <a
          class="button small"
          href={file.draft.url}
          download={file.draft.name}
          data-testid="draft-download">Download this preview</a
        >
      </div>
      {#if draftStale}
        <p class="stale" data-testid="draft-stale">
          Settings have changed since this preview was made. Press <strong>Generate preview</strong>
          to update it.
        </p>
      {/if}
      {#if file.draftStatus === 'error'}
        <p class="error" data-testid="draft-error">{file.draftError}</p>
      {/if}
      {#if !draftStale}
        <p class="caption">
          This is exactly the file the Watermark tool would save. Nothing has been exported.
        </p>
      {/if}
      {#if file.draft.notes.length}
        <ul class="notes">
          {#each file.draft.notes as n, i (i)}<li>{n}</li>{/each}
        </ul>
      {/if}
    {:else if view !== 'draft' && file.result}
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
  .loading {
    color: var(--muted);
    font-size: 0.85rem;
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
