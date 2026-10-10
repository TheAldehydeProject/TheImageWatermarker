import type { ToolDefinition } from '../../ui/toolState.svelte';
import {
  COMPRESS_SUFFIX,
  compressSpec,
  compressStore,
  type CompressSettings,
  type CompressSpec,
} from './settings';
import CompressWorker from './worker?worker';

export const compressTool: ToolDefinition<CompressSettings, CompressSpec> = {
  id: 'compress',
  store: compressStore,
  spec: compressSpec,
  suffix: COMPRESS_SUFFIX,
  createWorker: () => new CompressWorker({ name: 'compress' }),
};
