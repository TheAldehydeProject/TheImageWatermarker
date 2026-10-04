<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { BLEND_MODE_GROUPS } from '../lib/blend';
  import { MAX_LABEL_LENGTH, POSITIONS, sanitizeLabel, type AtomLabels } from '../lib/molecule';
  import { DEFAULT_WATERMARK, LIMITS } from '../lib/watermark';
  import MoleculeIcon from './MoleculeIcon.svelte';
  import Segmented from './Segmented.svelte';
  import Slider from './Slider.svelte';
  import Toggle from './Toggle.svelte';

  const s = app.settings;
  const w = s.watermark;

  const slots: { key: keyof AtomLabels; label: string; fallback: string }[] = [
    { key: 'o', label: 'O (double bond)', fallback: 'O' },
    { key: 'c', label: 'C (centre)', fallback: 'C' },
    { key: 'h1', label: 'H (first)', fallback: 'H' },
    { key: 'h2', label: 'H (second)', fallback: 'H' },
  ];

  const positionLabels: Record<string, string> = {
    'top-left': 'Top left',
    top: 'Top',
    'top-right': 'Top right',
    left: 'Left',
    center: 'Centre',
    right: 'Right',
    'bottom-left': 'Bottom left',
    bottom: 'Bottom',
    'bottom-right': 'Bottom right',
  };

  const labels = $derived<[string, string, string, string]>(
    w.variant === 'custom'
      ? [w.customLabels.o, w.customLabels.c, w.customLabels.h1, w.customLabels.h2]
      : ['O', 'C', 'H', 'H'],
  );

  function reset() {
    Object.assign(w, structuredClone(DEFAULT_WATERMARK));
  }
</script>

<div class="panel">
  <p class="intro">
    A small formaldehyde molecule, unobtrusive in the corner. The preview updates as you change
    things.
  </p>

  <Segmented
    label="Letters"
    name="wm-variant"
    bind:value={w.variant}
    options={[
      { value: 'classic', label: 'Formaldehyde', hint: 'The real molecule: O, C, H and H.' },
      { value: 'custom', label: 'Custom letters', hint: 'Same shape and bonds, your own letters.' },
    ]}
  />
  {#if w.variant === 'custom'}
    <div class="letters">
      {#each slots as slot (slot.key)}
        <label>
          <span>{slot.label}</span>
          <input
            type="text"
            maxlength={MAX_LABEL_LENGTH * 2}
            value={w.customLabels[slot.key]}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              if (v.trim()) w.customLabels[slot.key] = sanitizeLabel(v, slot.fallback);
            }}
            onblur={(e) => ((e.currentTarget as HTMLInputElement).value = w.customLabels[slot.key])}
            data-testid={`letter-${slot.key}`}
          />
        </label>
      {/each}
      <p class="hint">One or two characters each. The shape and bonds stay the same.</p>
    </div>
  {/if}

  <fieldset class="layouts">
    <legend>Layout</legend>
    {#each [{ v: 'horizontal', t: 'Horizontal' }, { v: 'vertical', t: 'Vertical' }] as l (l.v)}
      <label class:active={w.layout === l.v}>
        <input type="radio" name="wm-layout" value={l.v} bind:group={w.layout} />
        <MoleculeIcon layout={l.v as 'horizontal' | 'vertical'} size={54} {labels} />
        <span>{l.t}</span>
      </label>
    {/each}
  </fieldset>

  <fieldset class="positions">
    <legend>Position</legend>
    <div class="grid">
      {#each POSITIONS as p (p)}
        <label class:active={w.position === p} title={positionLabels[p]}>
          <input
            type="radio"
            name="wm-position"
            value={p}
            bind:group={w.position}
            aria-label={positionLabels[p]}
          />
          <span class="dot"></span>
        </label>
      {/each}
    </div>
  </fieldset>

  <Slider
    id="wm-size"
    label="Size"
    bind:value={w.size}
    min={LIMITS.size.min}
    max={LIMITS.size.max}
    step={0.5}
    unit="%"
    hint="Bond length, as a share of the image's shorter side."
  />
  <Slider
    id="wm-opacity"
    label="Opacity"
    bind:value={w.opacity}
    min={LIMITS.opacity.min}
    max={LIMITS.opacity.max}
    unit="%"
  />
  <Slider
    id="wm-margin"
    label="Distance from edge"
    bind:value={w.margin}
    min={LIMITS.margin.min}
    max={LIMITS.margin.max}
    step={0.5}
    unit="%"
  />

  <div class="color-row">
    <Segmented
      label="Colour"
      name="wm-color"
      bind:value={w.colorMode}
      options={[
        {
          value: 'auto',
          label: 'Auto',
          hint: 'White on dark areas, black on light ones, chosen per image.',
        },
        { value: 'white', label: 'White' },
        { value: 'black', label: 'Black' },
        { value: 'custom', label: 'Custom' },
      ]}
    />
    {#if w.colorMode === 'custom'}
      <input
        class="swatch"
        type="color"
        bind:value={w.customColor}
        aria-label="Custom watermark colour"
      />
    {/if}
  </div>

  <label class="field">
    <span>Blend mode</span>
    <select bind:value={w.blendMode} data-testid="blend-mode">
      {#each BLEND_MODE_GROUPS as g (g.label)}
        <optgroup label={g.label}>
          {#each g.modes as m (m.id)}
            <option value={m.id}>{m.label}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    <span class="hint"
      >How the watermark mixes with the photo. Overlay and Soft Light blend in the most.</span
    >
  </label>

  <div class="motion">
    <Toggle
      label="Motion blur"
      bind:checked={w.motion.enabled}
      hint="Makes the molecule look like it is moving."
    />
    {#if w.motion.enabled}
      <Segmented
        label="Style"
        name="wm-motion-style"
        bind:value={w.motion.style}
        options={[
          {
            value: 'trail',
            label: 'Sharp with trail',
            hint: 'The molecule stays crisp and leaves a fading streak behind it.',
          },
          {
            value: 'blur',
            label: 'Blurred',
            hint: 'The whole molecule is smeared along its path.',
          },
        ]}
      />
      <Slider
        id="wm-motion-amount"
        label="Amount"
        bind:value={w.motion.amount}
        min={LIMITS.amount.min}
        max={LIMITS.amount.max}
        unit="%"
      />
      <Slider
        id="wm-motion-angle"
        label="Direction"
        bind:value={w.motion.angle}
        min={LIMITS.angle.min}
        max={LIMITS.angle.max}
        unit="°"
        hint="0° moves right, 90° down, 180° left, 270° up."
      />
    {/if}
  </div>

  <Slider
    id="wm-quality"
    label="Quality for lossy files"
    bind:value={s.watermarkQuality}
    min={60}
    max={100}
    hint="Watermarked JPG, AVIF and similar files have to be re-saved; lossless files (PNG, TIFF, lossless WebP) stay lossless."
  />

  <button class="link" type="button" onclick={reset}>Reset watermark settings</button>
</div>

<style>
  .letters {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .letters label {
    display: grid;
    gap: 3px;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .letters input {
    text-align: center;
    font-weight: 600;
    font-size: 1.05rem;
    width: 100%;
  }
  .letters .hint {
    grid-column: 1 / -1;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    font-weight: 500;
    padding: 0;
    margin-bottom: 6px;
  }
  .layouts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .layouts legend {
    width: 100%;
  }
  .layouts label {
    flex: 1;
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    color: var(--muted);
    position: relative;
  }
  .layouts label.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }
  .layouts label:has(input:focus-visible),
  .grid label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  input[type='radio'] {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 34px);
    grid-template-rows: repeat(3, 26px);
    gap: 4px;
    padding: 6px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: max-content;
  }
  .grid label {
    position: relative;
    display: grid;
    place-items: center;
    border-radius: 6px;
    cursor: pointer;
  }
  .grid label:hover {
    background: var(--surface);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--border-strong);
  }
  .grid label.active .dot {
    background: var(--accent);
    border-color: var(--accent);
  }
  .color-row {
    display: flex;
    align-items: end;
    gap: 10px;
  }
  .color-row > :global(:first-child) {
    flex: 1;
  }
  .swatch {
    width: 44px;
    height: 38px;
    padding: 2px;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field > span:first-child {
    font-weight: 500;
  }
  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .motion {
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .link {
    justify-self: start;
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent-text);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
