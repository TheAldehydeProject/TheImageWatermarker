/// <reference lib="webworker" />
import { serveWorker } from '../../engine/workerHost';
import { watermarkImage } from './pipeline';
import type { WatermarkSpec } from './settings';
import { renderWatermark } from './watermarkRender';

serveWorker<WatermarkSpec>((bytes, name, spec, progress) =>
  watermarkImage(bytes, name, spec, { draw: renderWatermark, progress }),
);
