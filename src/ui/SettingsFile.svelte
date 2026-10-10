<script lang="ts">
  import { SettingsFileError } from '../engine/settings';
  import type { AnyToolState } from './types';

  interface Props {
    page: AnyToolState;
  }
  let { page }: Props = $props();

  let fileInput: HTMLInputElement;
  let message = $state<{ text: string; error: boolean } | null>(null);

  function exportSettings() {
    const url = URL.createObjectURL(page.settingsFile());
    const a = document.createElement('a');
    a.href = url;
    a.download = page.settingsFileName;
    document.body.append(a);
    a.click();
    a.remove();
    // Give the browser time to start the download before releasing the file.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    message = { text: `Settings exported as ${page.settingsFileName}.`, error: false };
  }

  async function onSettingsFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await page.loadSettingsFile(file);
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
    Saves every setting on this page to a file, so you can load it again later or on another device.
  </span>
  {#if message}
    <p class="message" class:error={message.error} role="status" data-testid="settings-message">
      {message.text}
    </p>
  {/if}
</div>

<style>
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
