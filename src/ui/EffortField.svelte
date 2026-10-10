<script lang="ts">
  import type { Effort } from '../engine/formats';
  import Segmented from './Segmented.svelte';

  interface Props {
    value: Effort;
  }
  let { value = $bindable() }: Props = $props();
</script>

<Segmented
  label="Effort"
  name="effort"
  bind:value
  options={[
    { value: 'balanced', label: 'Balanced', hint: 'Good compression at a comfortable speed.' },
    {
      value: 'maximum',
      label: 'Maximum',
      hint: 'Squeezes out a few more percent. Much slower on big images.',
    },
  ]}
/>
