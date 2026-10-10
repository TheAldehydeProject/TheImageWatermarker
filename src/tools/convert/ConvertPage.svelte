<script lang="ts">
  import Preview from '../../ui/Preview.svelte';
  import ToolPage from '../../ui/ToolPage.svelte';
  import { ToolState } from '../../ui/toolState.svelte';
  import ConvertPanel from './ConvertPanel.svelte';
  import { convertTool } from './tool';

  const page = new ToolState(convertTool);
</script>

<ToolPage {page} verb="Convert" intro="Changes images to another file type." estimate>
  {#snippet panel()}
    <ConvertPanel {page} />
  {/snippet}
  {#snippet preview()}
    <Preview {page} />
  {/snippet}
</ToolPage>
