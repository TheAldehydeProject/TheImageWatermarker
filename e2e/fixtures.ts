/**
 * Generates one test image per supported input format. Created fresh for
 * every test run so no binary files need to live in the repository.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as gifencModule from 'gifenc';
import type { RGBAImage } from '../src/engine/image';
import { injectJpegMetadata, orientationOnlyExif } from '../src/engine/metadata';
import { encodeTiff } from '../src/engine/tiff';
import { asImageData, encodeJpeg, initCodecs, photoLike } from '../tests/helpers';
import { rewriteJpeg } from '../tests/jpegRewrite';

// gifenc ships CommonJS for Node and ESM for bundlers; accept either shape.
const { GIFEncoder, applyPalette, quantize } =
  (gifencModule as unknown as { default?: typeof gifencModule }).default ?? gifencModule;

export const FIXTURE_DIR = join(import.meta.dirname, '.fixtures');

function bmp(img: RGBAImage): Uint8Array {
  const rowSize = Math.ceil((img.width * 3) / 4) * 4;
  const size = 54 + rowSize * img.height;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, img.width, true);
  dv.setInt32(22, img.height, true); // positive = bottom-up rows
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, rowSize * img.height, true);
  for (let y = 0; y < img.height; y++) {
    const row = 54 + (img.height - 1 - y) * rowSize;
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      out[row + x * 3] = img.data[i + 2];
      out[row + x * 3 + 1] = img.data[i + 1];
      out[row + x * 3 + 2] = img.data[i];
    }
  }
  return out;
}

function gif(img: RGBAImage): Uint8Array {
  const palette = quantize(img.data, 256);
  const index = applyPalette(img.data, palette);
  const enc = GIFEncoder();
  enc.writeFrame(index, img.width, img.height, { palette });
  enc.finish();
  return enc.bytes();
}

/**
 * A minimal "LinearRaw" DNG: 16-bit linear RGB with the tags camera RAW
 * decoders need. Enough to exercise the RAW path end to end.
 */
function dng(width: number, height: number): Uint8Array {
  const img = photoLike(width, height, 21);
  const toLinear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const pixels = new Uint16Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++)
      pixels[i * 3 + c] = Math.round(toLinear(img.data[i * 4 + c]) * 65535);
  }
  const SHORT = 3;
  const LONG = 4;
  const ASCII = 2;
  const BYTE = 1;
  const RATIONAL = 5;
  const SRATIONAL = 10;
  const text = (s: string) => [...new TextEncoder().encode(s), 0];
  // XYZ (D65) → linear sRGB, i.e. the "camera" is a linear sRGB sensor.
  const colorMatrix = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057];
  const entries: { tag: number; type: number; values: number[] }[] = [
    { tag: 254, type: LONG, values: [0] },
    { tag: 256, type: LONG, values: [width] },
    { tag: 257, type: LONG, values: [height] },
    { tag: 258, type: SHORT, values: [16, 16, 16] },
    { tag: 259, type: SHORT, values: [1] },
    { tag: 262, type: SHORT, values: [34892] }, // LinearRaw
    { tag: 271, type: ASCII, values: text('Fixture') },
    { tag: 272, type: ASCII, values: text('Linear DNG') },
    { tag: 273, type: LONG, values: [0] }, // patched
    { tag: 274, type: SHORT, values: [1] },
    { tag: 277, type: SHORT, values: [3] },
    { tag: 278, type: LONG, values: [height] },
    { tag: 279, type: LONG, values: [pixels.byteLength] },
    { tag: 284, type: SHORT, values: [1] },
    { tag: 50706, type: BYTE, values: [1, 4, 0, 0] },
    { tag: 50707, type: BYTE, values: [1, 1, 0, 0] },
    { tag: 50708, type: ASCII, values: text('Fixture Linear DNG') },
    { tag: 50717, type: LONG, values: [65535, 65535, 65535] },
    {
      tag: 50721,
      type: SRATIONAL,
      values: colorMatrix.flatMap((v) => [Math.round(v * 10000), 10000]),
    },
    { tag: 50728, type: RATIONAL, values: [1, 1, 1, 1, 1, 1] },
    { tag: 50778, type: SHORT, values: [21] }, // D65
  ];
  const size = (t: number) =>
    t === SHORT ? 2 : t === LONG ? 4 : t === RATIONAL || t === SRATIONAL ? 8 : 1;
  const count = (e: (typeof entries)[number]) =>
    e.type === RATIONAL || e.type === SRATIONAL ? e.values.length / 2 : e.values.length;
  const bytes = (e: (typeof entries)[number]) => count(e) * size(e.type);
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = 8 + ifdSize;
  const offsets = new Map<number, number>();
  for (const e of entries) {
    if (bytes(e) > 4) {
      offsets.set(e.tag, extra);
      extra += bytes(e) + (bytes(e) & 1);
    }
  }
  const dataOffset = extra;
  entries.find((e) => e.tag === 273)!.values = [dataOffset];
  const out = new Uint8Array(dataOffset + pixels.byteLength);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, entries.length, true);
  const write = (e: (typeof entries)[number], at: number) => {
    e.values.forEach((v, i) => {
      if (e.type === SHORT) dv.setUint16(at + i * 2, v, true);
      else if (e.type === LONG || e.type === RATIONAL) dv.setUint32(at + i * 4, v, true);
      else if (e.type === SRATIONAL) dv.setInt32(at + i * 4, v, true);
      else out[at + i] = v;
    });
  };
  entries.forEach((e, i) => {
    const p = 10 + i * 12;
    dv.setUint16(p, e.tag, true);
    dv.setUint16(p + 2, e.type, true);
    dv.setUint32(p + 4, count(e), true);
    const at = offsets.get(e.tag);
    if (at === undefined) write(e, p + 8);
    else {
      dv.setUint32(p + 8, at, true);
      write(e, at);
    }
  });
  dv.setUint32(10 + entries.length * 12, 0, true);
  const pixelBytes = new Uint8Array(pixels.buffer);
  out.set(pixelBytes, dataOffset);
  return out;
}

export interface Fixture {
  file: string;
  /** Upright dimensions the app should report. */
  width: number;
  height: number;
}

export const FIXTURES: Fixture[] = [
  { file: 'rotated-photo.jpg', width: 300, height: 400 },
  { file: 'camera.jpg', width: 640, height: 480 },
  { file: 'graphic.png', width: 320, height: 240 },
  { file: 'lossless.webp', width: 320, height: 240 },
  { file: 'lossy.webp', width: 320, height: 240 },
  { file: 'animation.gif', width: 160, height: 120 },
  { file: 'bitmap.bmp', width: 161, height: 121 },
  { file: 'scan.tiff', width: 300, height: 200 },
  { file: 'photo.avif', width: 320, height: 240 },
  { file: 'photo.jxl', width: 320, height: 240 },
  { file: 'camera.dng', width: 240, height: 160 },
];

export const UNSUPPORTED = 'notes.txt';

export async function generateFixtures(): Promise<void> {
  await initCodecs();
  await mkdir(FIXTURE_DIR, { recursive: true });
  const put = (name: string, data: Uint8Array) => writeFile(join(FIXTURE_DIR, name), data);

  // Stored sideways with an EXIF "rotate 90°" flag, like phone photos.
  const sideways = await encodeJpeg(photoLike(400, 300, 1), { quality: 88 });
  await put('rotated-photo.jpg', injectJpegMetadata(sideways, { exif: orientationOnlyExif(6) }));
  const tuned = await encodeJpeg(photoLike(640, 480, 2), {
    quality: 90,
    baseline: true,
    progressive: false,
  });
  await put('camera.jpg', rewriteJpeg(tuned, { standardTables: true }));

  const { default: encodePng } = await import('@jsquash/png/encode.js');
  await put(
    'graphic.png',
    new Uint8Array(await encodePng(asImageData(photoLike(320, 240, 3, true)))),
  );
  const { default: encodeWebp } = await import('@jsquash/webp/encode.js');
  await put(
    'lossless.webp',
    new Uint8Array(await encodeWebp(asImageData(photoLike(320, 240, 4)), { lossless: 1 })),
  );
  await put(
    'lossy.webp',
    new Uint8Array(await encodeWebp(asImageData(photoLike(320, 240, 5)), { quality: 80 })),
  );
  await put('animation.gif', gif(photoLike(160, 120, 6)));
  await put('bitmap.bmp', bmp(photoLike(161, 121, 7)));
  await put('scan.tiff', encodeTiff(photoLike(300, 200, 8)));
  const { default: encodeAvif } = await import('@jsquash/avif/encode.js');
  await put(
    'photo.avif',
    new Uint8Array(await encodeAvif(asImageData(photoLike(320, 240, 9)), { quality: 60 })),
  );
  const { default: encodeJxl } = await import('@jsquash/jxl/encode.js');
  await put(
    'photo.jxl',
    new Uint8Array(await encodeJxl(asImageData(photoLike(320, 240, 10)), { quality: 80 })),
  );
  await put('camera.dng', dng(240, 160));
  await put(UNSUPPORTED, new TextEncoder().encode('This is not an image.\n'));
}
