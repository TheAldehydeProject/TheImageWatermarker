<script lang="ts">
  interface Props {
    label: string;
    checked: boolean;
    hint?: string;
  }
  let { label, checked = $bindable(), hint = '' }: Props = $props();
</script>

<label class="toggle">
  <input type="checkbox" role="switch" bind:checked />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
  <span class="text">
    <span class="label">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>
</label>

<style>
  .toggle {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
  }
  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .track {
    flex: none;
    width: 36px;
    height: 20px;
    border-radius: 999px;
    background: var(--border-strong);
    position: relative;
    transition: background 0.15s;
    margin-top: 1px;
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s;
    box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
  }
  input:checked + .track {
    background: var(--accent);
  }
  input:checked + .track .knob {
    transform: translateX(16px);
  }
  input:focus-visible + .track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .text {
    display: grid;
    gap: 2px;
  }
  .label {
    font-weight: 500;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
