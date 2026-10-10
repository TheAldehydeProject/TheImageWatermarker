/// <reference lib="webworker" />
import { serveWorker } from '../../engine/workerHost';
import { compressImage } from './pipeline';
import type { CompressSpec } from './settings';

serveWorker<CompressSpec>(compressImage);
