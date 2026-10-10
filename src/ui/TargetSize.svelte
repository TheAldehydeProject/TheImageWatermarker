<script lang="ts">
  import type { TargetSize } from '../engine/settings';

  interface Props {
    value: TargetSize;
    id: string;
    hint?: string;
  }
  let { value = $bindable(), id, hint = 'Uses the highest quality that fits.' }: Props = $props();
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
  <p class="hint">{hint}</p>
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
