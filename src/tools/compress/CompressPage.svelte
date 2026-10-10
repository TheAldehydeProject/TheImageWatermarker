<script lang="ts">
  import Preview from '../../ui/Preview.svelte';
  import ToolPage from '../../ui/ToolPage.svelte';
  import { ToolState } from '../../ui/toolState.svelte';
  import CompressPanel from './CompressPanel.svelte';
  import { compressTool } from './tool';

  const page = new ToolState(compressTool);
</script>

<ToolPage
  {page}
  verb="Compress"
  intro="Makes images smaller, keeping their format or turning them into compact WebP files."
  estimate
>
  {#snippet panel()}
    <CompressPanel {page} />
  {/snippet}
  {#snippet preview()}
    <Preview {page} />
  {/snippet}
</ToolPage>
