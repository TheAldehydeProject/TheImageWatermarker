import type { RGBAImage } from '../engine/image';
import type { ToolState } from './toolState.svelte';

/** A page's state, whichever tool it belongs to (for the shared components). */
export type AnyToolState = ToolState<object, unknown>;

/** A page's live preview: draws onto a copy of the selected image as settings change. */
export interface LiveRender {
  /** Label of the live view, e.g. "Watermark preview". */
  label: string;
  /** Caption shown under the close-up. */
  closeUpCaption: string;
  /** Draws onto the image (a copy); with `closeUp`, returns just the part worth zooming into. */
  render(img: RGBAImage, closeUp: boolean): Promise<RGBAImage>;
}
