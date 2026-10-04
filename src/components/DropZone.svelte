<script lang="ts">
  import { ACCEPT_ATTRIBUTE } from '../lib/formats';

  interface Props {
    onfiles: (files: File[]) => void;
    compact?: boolean;
  }
  let { onfiles, compact = false }: Props = $props();
  let dragging = $state(false);
  let input: HTMLInputElement;

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onfiles(files);
  }

  function onPick(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const files = [...(el.files ?? [])];
    if (files.length) onfiles(files);
    el.value = '';
  }

  // Pasting an image (Ctrl/Cmd+V) anywhere on the page adds it too.
  $effect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        onfiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });
</script>

<div
  class="drop"
  class:dragging
  class:compact
  role="button"
  tabindex="0"
  aria-label="Add images: drop files here or press to choose"
  onclick={() => input.click()}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  }}
  ondragenter={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragover={(e) => e.preventDefault()}
  ondragleave={(e) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragging = false;
  }}
  ondrop={onDrop}
>
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </svg>
  <div>
    <strong>{compact ? 'Add more images' : 'Drop images here'}</strong>
    {#if !compact}
      <span>or click to choose · you can also paste</span>
      <span class="formats"
        >JPG · PNG · WebP · RAW (CR2, CR3, NEF, ARW, DNG, RAF…) · HEIC · AVIF · JPEG XL · TIFF · GIF
        · BMP</span
      >
    {/if}
  </div>
  <input
    bind:this={input}
    type="file"
    multiple
    accept={ACCEPT_ATTRIBUTE}
    onchange={onPick}
    hidden
    data-testid="file-input"
  />
</div>

<style>
  .drop {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 22px 18px;
    border: 2px dashed var(--border-strong);
    border-radius: 14px;
    background: var(--surface);
    cursor: pointer;
    color: var(--muted);
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .drop.compact {
    padding: 10px 14px;
    border-width: 1.5px;
  }
  .drop:hover,
  .drop:focus-visible,
  .drop.dragging {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
    outline: none;
  }
  .drop div {
    display: grid;
    gap: 3px;
  }
  strong {
    color: var(--text);
    font-size: 1.02rem;
  }
  .formats {
    font-size: 0.8rem;
  }
</style>
