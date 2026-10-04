<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    hint?: string;
    id: string;
  }
  let {
    label,
    value = $bindable(),
    min,
    max,
    step = 1,
    unit = '',
    hint = '',
    id,
  }: Props = $props();

  function onNumber(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) value = Math.min(max, Math.max(min, v));
  }
</script>

<div class="slider">
  <div class="row">
    <label for={id}>{label}</label>
    <span class="value">
      <input
        type="number"
        aria-label={`${label} value`}
        {min}
        {max}
        {step}
        {value}
        onchange={onNumber}
      />{unit}
    </span>
  </div>
  <input {id} type="range" {min} {max} {step} bind:value />
  {#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
  .slider {
    display: grid;
    gap: 4px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  label {
    font-weight: 500;
  }
  .value {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .value input {
    width: 4.2em;
    padding: 2px 4px;
    text-align: right;
    margin-right: 2px;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .hint {
    margin: 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
</style>
