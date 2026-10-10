/// <reference lib="webworker" />
import { serveWorker } from '../../engine/workerHost';
import { convertImage } from './pipeline';
import type { ConvertSpec } from './settings';

serveWorker<ConvertSpec>(convertImage);
