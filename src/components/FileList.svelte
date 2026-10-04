<script lang="ts">
  import { app, type FileEntry } from '../lib/app.svelte';
  import { formatBytes, formatChange } from '../lib/filename';
  import { INPUT_FORMAT_LABELS, OUTPUT_FORMATS } from '../lib/formats';

  const toolLabel = {
    compress: 'Compressed',
    convert: 'Converted',
    watermark: 'Watermarked',
    all: 'Processed',
  };

  function changeClass(f: FileEntry): string {
    if (!f.result) return '';
    if (f.result.size < f.file.size) return 'smaller';
    if (f.result.size > f.file.size) return 'bigger';
    return '';
  }
</script>

<ul class="files" aria-label="Your images">
  {#each app.files as f (f.id)}
    <li class:selected={app.selectedId === f.id} data-testid="file-row" data-status={f.status}>
      <button class="pick" onclick={() => app.select(f.id)} aria-pressed={app.selectedId === f.id}>
        <span class="thumb">
          {#if f.thumbUrl}
            <img src={f.thumbUrl} alt="" />
          {:else if f.previewError}
            <span class="thumb-msg">!</span>
          {:else}
            <span class="spinner" aria-hidden="true"></span>
          {/if}
        </span>
        <span class="info">
          <span class="name" title={f.file.name}>{f.file.name}</span>
          <span class="meta">
            {f.format ? INPUT_FORMAT_LABELS[f.format] : '?'} · {formatBytes(f.file.size)}
            {#if f.width}· {f.width}×{f.height}{/if}
          </span>
          {#if f.status === 'processing'}
            <span class="status">Working…</span>
          {:else if f.status === 'error'}
            <span class="status error" data-testid="file-error">{f.error}</span>
          {:else if f.previewError && !f.result}
            <span class="status error">{f.previewError}</span>
          {:else if f.result}
            <span
              class="status"
              title={`${toolLabel[f.result.tool]}${f.result.keptOriginal ? ' (original kept)' : ''}`}
            >
              → {OUTPUT_FORMATS[f.result.format].label} · {formatBytes(f.result.size)}
              <span class="change {changeClass(f)}" data-testid="size-change"
                >{formatChange(f.file.size, f.result.size)}</span
              >
            </span>
          {/if}
        </span>
      </button>
      <span class="actions">
        {#if f.result}
          <a
            class="icon-btn"
            href={f.result.url}
            download={f.result.name}
            title={`Download ${f.result.name}`}
            aria-label={`Download ${f.result.name}`}
            data-testid="download"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></svg
            >
          </a>
        {/if}
        <button
          class="icon-btn"
          onclick={() => app.remove(f.id)}
          aria-label={`Remove ${f.file.name}`}
          title="Remove"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
          >
        </button>
      </span>
    </li>
  {/each}
</ul>

<style>
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    padding-right: 6px;
    min-width: 0;
  }
  li.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .pick {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    background: none;
    border: 0;
    text-align: left;
    color: inherit;
    cursor: pointer;
    min-width: 0;
    border-radius: 12px;
  }
  .thumb {
    flex: none;
    width: 52px;
    height: 52px;
    border-radius: 8px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--checker);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb-msg {
    color: var(--danger);
    font-weight: 700;
  }
  .info {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta,
  .status {
    font-size: 0.82rem;
    color: var(--muted);
  }
  .status.error {
    color: var(--danger);
  }
  .change {
    font-weight: 700;
    margin-left: 2px;
  }
  .change.smaller {
    color: var(--success);
  }
  .change.bigger {
    color: var(--warning);
  }
  .actions {
    display: flex;
    gap: 2px;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
