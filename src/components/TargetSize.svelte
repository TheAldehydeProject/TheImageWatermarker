<script lang="ts">
  import type { TargetSize } from '../lib/settings';

  interface Props {
    value: TargetSize;
    id: string;
  }
  let { value = $bindable(), id }: Props = $props();
</script>

<div class="target">
  <label for={id}>Target size</label>
  <div class="row">
    <input
      {id}
      type="number"
      min="0.01"
      step="any"
      inputmode="decimal"
      bind:value={value.value}
      data-testid="target-size"
    />
    <select bind:value={value.unit} aria-label="Unit" data-testid="target-unit">
      <option value="KB">KB</option>
      <option value="MB">MB</option>
    </select>
  </div>
  <p class="hint">
    Uses the highest quality that fits. If even the lowest quality allowed is too big, the image is
    made smaller too. Files already under the target are kept as they are.
  </p>
</div>

<style>
  .target {
    display: grid;
    gap: 4px;
  }
  label {
    font-weight: 500;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  input {
    width: 8em;
  }
  .hint {
    margin: 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
</style>
