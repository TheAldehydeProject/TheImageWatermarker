<script lang="ts" generics="T extends string">
  interface Option {
    value: T;
    label: string;
    hint?: string;
  }
  interface Props {
    label: string;
    options: Option[];
    value: T;
    name: string;
  }
  let { label, options, value = $bindable(), name }: Props = $props();
</script>

<fieldset class="segmented">
  <legend>{label}</legend>
  <div class="options">
    {#each options as opt (opt.value)}
      <label class:active={value === opt.value} title={opt.hint}>
        <input type="radio" {name} value={opt.value} bind:group={value} />
        <span>{opt.label}</span>
      </label>
    {/each}
  </div>
  {#each options as opt (opt.value)}
    {#if value === opt.value && opt.hint}<p class="hint">{opt.hint}</p>{/if}
  {/each}
</fieldset>

<style>
  .segmented {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  legend {
    font-weight: 500;
    padding: 0;
    margin-bottom: 6px;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
  }
  label {
    flex: 1 1 auto;
    text-align: center;
    border-radius: 7px;
    padding: 6px 10px;
    cursor: pointer;
    color: var(--muted);
    position: relative;
    white-space: nowrap;
  }
  label.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 12%);
    font-weight: 600;
  }
  label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
