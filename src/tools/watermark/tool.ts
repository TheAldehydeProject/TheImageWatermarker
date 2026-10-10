import type { ToolDefinition } from '../../ui/toolState.svelte';
import {
  WATERMARK_SUFFIX,
  watermarkSpec,
  watermarkStore,
  type WatermarkPageSettings,
  type WatermarkSpec,
} from './settings';
import WatermarkWorker from './worker?worker';

export const watermarkTool: ToolDefinition<WatermarkPageSettings, WatermarkSpec> = {
  id: 'watermark',
  store: watermarkStore,
  spec: watermarkSpec,
  suffix: WATERMARK_SUFFIX,
  createWorker: () => new WatermarkWorker({ name: 'watermark' }),
};
