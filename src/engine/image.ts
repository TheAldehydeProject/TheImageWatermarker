/** An 8-bit RGBA pixel buffer. Structurally compatible with the DOM `ImageData`. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function createImage(width: number, height: number): RGBAImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/** True if any pixel is not fully opaque. */
export function hasTransparency(img: RGBAImage): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) return true;
  }
  return false;
}

/** Expands tightly packed RGB (or grey) samples into RGBA. */
export function toRGBA(
  samples: ArrayLike<number>,
  width: number,
  height: number,
  channels: 1 | 3 | 4,
): RGBAImage {
  const img = createImage(width, height);
  const out = img.data;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    if (channels === 1) {
      const v = samples[i];
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    } else if (channels === 3) {
      out[i * 4] = samples[i * 3];
      out[i * 4 + 1] = samples[i * 3 + 1];
      out[i * 4 + 2] = samples[i * 3 + 2];
      out[i * 4 + 3] = 255;
    } else {
      out[i * 4] = samples[i * 4];
      out[i * 4 + 1] = samples[i * 4 + 1];
      out[i * 4 + 2] = samples[i * 4 + 2];
      out[i * 4 + 3] = samples[i * 4 + 3];
    }
  }
  return img;
}

/**
 * Applies an EXIF orientation (1–8) so the returned image is upright.
 * Orientation 1 (or anything unknown) returns the input unchanged.
 */
export function applyOrientation(img: RGBAImage, orientation: number): RGBAImage {
  if (orientation < 2 || orientation > 8) return img;
  const { width: w, height: h } = img;
  const swap = orientation >= 5;
  const out = createImage(swap ? h : w, swap ? w : h);
  const src = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
  const dst = new Uint32Array(out.data.buffer, out.data.byteOffset, w * h);
  const ow = out.width;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      switch (orientation) {
        case 2: // mirror horizontal
          nx = w - 1 - x;
          ny = y;
          break;
        case 3: // rotate 180
          nx = w - 1 - x;
          ny = h - 1 - y;
          break;
        case 4: // mirror vertical
          nx = x;
          ny = h - 1 - y;
          break;
        case 5: // transpose
          nx = y;
          ny = x;
          break;
        case 6: // rotate 90 clockwise
          nx = h - 1 - y;
          ny = x;
          break;
        case 7: // transverse
          nx = h - 1 - y;
          ny = w - 1 - x;
          break;
        default: // 8: rotate 90 counter-clockwise
          nx = y;
          ny = w - 1 - x;
          break;
      }
      dst[ny * ow + nx] = src[y * w + x];
    }
  }
  return out;
}

/** Copies a window of an image, clamped to its edges. */
export function cropImage(img: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const cw = Math.max(1, Math.min(img.width - x0, Math.ceil(w)));
  const ch = Math.max(1, Math.min(img.height - y0, Math.ceil(h)));
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const src = ((y0 + row) * img.width + x0) * 4;
    out.set(img.data.subarray(src, src + cw * 4), row * cw * 4);
  }
  return { width: cw, height: ch, data: out };
}
