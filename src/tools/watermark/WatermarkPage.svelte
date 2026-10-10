<script lang="ts">
  import { cropImage, type RGBAImage } from '../../engine/image';
  import Preview from '../../ui/Preview.svelte';
  import ToolPage from '../../ui/ToolPage.svelte';
  import { ToolState } from '../../ui/toolState.svelte';
  import type { LiveRender } from '../../ui/types';
  import { watermarkTool } from './tool';
  import WatermarkPanel from './WatermarkPanel.svelte';
  import { loadWatermarkFont, renderWatermark } from './watermarkRender';

  const page = new ToolState(watermarkTool);

  // Start loading the font early so the first live preview is quick.
  void loadWatermarkFont();

  // A new renderer whenever the watermark settings change, so the preview redraws.
  const live = $derived.by((): LiveRender => {
    const wm = $state.snapshot(page.settings.watermark);
    return {
      label: 'Watermark preview',
      closeUpCaption: 'Close-up of the watermark, rendered from the full-resolution image.',
      async render(img: RGBAImage, closeUp: boolean) {
        const placed = await renderWatermark(img, wm);
        if (!closeUp) return img;
        const pad = placed.bondLength * 2 + placed.motionLength;
        return cropImage(
          img,
          placed.x - pad,
          placed.y - pad,
          placed.width + pad * 2,
          placed.height + pad * 2,
        );
      },
    };
  });
</script>

<ToolPage
  {page}
  verb="Watermark"
  intro="Adds a small formaldehyde molecule to your images and leaves everything else as it was."
>
  {#snippet panel()}
    <WatermarkPanel {page} />
  {/snippet}
  {#snippet preview()}
    <Preview {page} {live} trials />
  {/snippet}
</ToolPage>
