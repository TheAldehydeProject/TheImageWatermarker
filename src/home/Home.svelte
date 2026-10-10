<script lang="ts">
  import MoleculeIcon from '../ui/MoleculeIcon.svelte';

  const tools = [
    {
      id: 'compress',
      title: 'Compress',
      text: 'Make images smaller. Keep each file’s format (lossless, visually lossless or a target size), or turn them into compact WebP files as small as you like, such as 50 KB.',
    },
    {
      id: 'convert',
      title: 'Convert',
      text: 'Change the file type: WebP, JPEG XL, AVIF, PNG, JPG or TIFF, lossless or at the quality you choose.',
    },
    {
      id: 'watermark',
      title: 'Watermark',
      text: 'Add a small formaldehyde molecule to a corner. Everything else stays as uploaded: same format, size and camera data, and the file never gets bigger.',
    },
  ];
</script>

<header class="top">
  <div class="brand">
    <span class="logo"><MoleculeIcon size={48} /></span>
    <div>
      <h1>The Image Watermarker</h1>
      <p>Three separate tools. Everything runs in your browser, so nothing is uploaded.</p>
    </div>
  </div>
</header>

<main class="tools">
  {#each tools as t (t.id)}
    <a class="tool" href={`./${t.id}/`} data-testid={`tool-${t.id}`}>
      <h2>{t.title}</h2>
      <p>{t.text}</p>
      <span class="go">Open {t.title} →</span>
    </a>
  {/each}
</main>

<footer class="foot">
  <p>Reads JPG, PNG, WebP, RAW, HEIC/HEIF, AVIF, JPEG XL, TIFF, GIF and BMP.</p>
</footer>

<style>
  .tools {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
  }
  .tool {
    display: grid;
    gap: 8px;
    align-content: start;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: inherit;
    text-decoration: none;
  }
  .tool:hover {
    border-color: var(--accent);
  }
  .tool p {
    margin: 0;
    color: var(--muted);
  }
  .go {
    font-weight: 600;
    color: var(--accent-text);
  }
</style>
