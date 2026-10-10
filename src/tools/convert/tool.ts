import type { ToolDefinition } from '../../ui/toolState.svelte';
import {
  CONVERT_SUFFIX,
  convertSpec,
  convertStore,
  type ConvertSettings,
  type ConvertSpec,
} from './settings';
import ConvertWorker from './worker?worker';

export const convertTool: ToolDefinition<ConvertSettings, ConvertSpec> = {
  id: 'convert',
  store: convertStore,
  spec: convertSpec,
  suffix: CONVERT_SUFFIX,
  createWorker: () => new ConvertWorker({ name: 'convert' }),
};
