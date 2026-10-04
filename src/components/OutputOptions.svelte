<script lang="ts">
  import { app } from '../lib/app.svelte';
  import { OUTPUT_FORMAT_ORDER, OUTPUT_FORMATS } from '../lib/formats';
  import { SETTINGS_FILE_NAME, SettingsFileError } from '../lib/settings';
  import Segmented from './Segmented.svelte';
  import Toggle from './Toggle.svelte';

  const o = app.settings.output;

  let fileInput: HTMLInputElement;
  let message = $state<{ text: string; error: boolean } | null>(null);

  function exportSettings() {
    const url = URL.createObjectURL(app.settingsFile());
    const a = document.createElement('a');
    a.href = url;
    a.download = SETTINGS_FILE_NAME;
    document.body.append(a);
    a.click();
    a.remove();
    // Give the browser time to start the download before releasing the file.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    message = { text: `Settings exported as ${SETTINGS_FILE_NAME}.`, error: false };
  }

  async function onSettingsFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await app.loadSettingsFile(file);
      message = { text: `Settings loaded from ${file.name}.`, error: false };
    } catch (err) {
      message = {
        text:
          err instanceof SettingsFileError
            ? err.message
            : `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        error: true,
      };
    }
  }
</script>

<details class="more">
  <summary>More options</summary>
  <div class="body">
    <Toggle
      label="Resize"
      bind:checked={o.resize.enabled}
      hint="Shrinks images that are larger than the limits below. Never enlarges."
    />
    {#if o.resize.enabled}
      <div class="dims">
        <label>
          Max width
          <input type="number" min="0" step="1" bind:value={o.resize.maxWidth} />
        </label>
        <span aria-hidden="true">×</span>
        <label>
          Max height
          <input type="number" min="0" step="1" bind:value={o.resize.maxHeight} />
        </label>
        <span class="px">px (0 = no limit)</span>
      </div>
    {/if}
    <Toggle
      label="Remove camera data and location"
      bind:checked={o.stripMetadata}
      hint="Strips EXIF details such as GPS position, camera serial numbers and dates. Colour profiles are always kept."
    />
    <label class="field">
      <span>Format for RAW, HEIC, GIF and BMP</span>
      <select bind:value={o.fallbackFormat}>
        {#each OUTPUT_FORMAT_ORDER as f (f)}
          <option value={f}>{OUTPUT_FORMATS[f].label}</option>
        {/each}
      </select>
      <span class="hint"
        >These can't be saved in their own format, so Compress and Watermark use this.</span
      >
    </label>
    <Segmented
      label="Effort"
      name="effort"
      bind:value={o.effort}
      options={[
        { value: 'balanced', label: 'Balanced', hint: 'Good compression at a comfortable speed.' },
        {
          value: 'maximum',
          label: 'Maximum',
          hint: 'Squeezes out a few more percent. Much slower on big images.',
        },
      ]}
    />
    <div class="field">
      <span>Settings file</span>
      <div class="buttons">
        <button
          class="button small"
          type="button"
          onclick={exportSettings}
          data-testid="export-settings"
        >
          Export settings
        </button>
        <button
          class="button small"
          type="button"
          onclick={() => fileInput.click()}
          data-testid="upload-settings"
        >
          Upload settings
        </button>
        <input
          bind:this={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onchange={onSettingsFile}
          data-testid="settings-input"
        />
      </div>
      <span class="hint">
        Saves every setting on every tab to a file, so you can load it again later or on another
        device.
      </span>
      {#if message}
        <p class="message" class:error={message.error} role="status" data-testid="settings-message">
          {message.text}
        </p>
      {/if}
    </div>
  </div>
</details>

<style>
  .dims {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px;
  }
  .dims label {
    display: grid;
    gap: 3px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .dims input {
    width: 7em;
  }
  .px {
    font-size: 0.85rem;
    color: var(--muted);
    padding-bottom: 6px;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field > span:first-child {
    font-weight: 500;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .message {
    margin: 0;
    font-size: 0.88rem;
    color: var(--success);
  }
  .message.error {
    color: var(--danger);
  }
</style>
