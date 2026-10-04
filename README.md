# The Image Watermarker

A website for **compressing**, **converting** and **watermarking** images. Everything runs in your
browser, so images are never uploaded anywhere.

## What it does

| Tool           | What it does                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compress**   | Makes files smaller and keeps their format. **Lossless** (default): every pixel stays identical. **Visually lossless**: re-saves at a high quality. Never returns a bigger file. |
| **Convert**    | Saves as WebP (default, lossless), JPEG XL, AVIF, PNG, JPG or TIFF.                                                                                                              |
| **Watermark**  | Adds a small formaldehyde molecule (H₂C=O) to a corner of each image.                                                                                                            |
| **All-in-one** | Watermark, convert and compress in one pass.                                                                                                                                     |

**Reads:** JPG, PNG, WebP, RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF, SRW and more), HEIC/HEIF,
AVIF, JPEG XL, TIFF, GIF and BMP.

**Workflow extras:**

- Batch processing, with a "Download all" ZIP.
- Drag and drop, or paste images.
- Live watermark preview, plus a full-resolution close-up of the watermark.
- **Generate preview** (Watermark tab): makes the exact watermarked file for the selected image and
  shows it in the before/after viewer with its size, without exporting it. A note appears if you
  change settings afterwards.
- Before/after comparison slider with 100% zoom.
- Size and percentage saved for every file.
- Optional resize.
- Metadata (EXIF and GPS) removal, on by default.
- Settings are remembered between visits.
- Light and dark mode, and a layout that works on phones.

### The watermark

- Two letter options: **Formaldehyde** (O, C, H, H), or **Custom letters**. Custom keeps the same molecule
  and bonds, with one or two characters per atom.
- Two layouts: horizontal (H₂C=O), or vertical with O on top.
- Nine positions. The default is bottom-right.
- Adjustable size, opacity, distance from the edge and colour. "Auto" picks white or black for each image.
- **36 blend modes**:
  - The full Photoshop set: Normal, Dissolve, Darken, Multiply, Color Burn, Linear Burn, Darker Color,
    Lighten, Screen, Color Dodge, Linear Dodge, Lighter Color, Overlay, Soft Light, Hard Light, Vivid
    Light, Linear Light, Pin Light, Hard Mix, Difference, Exclusion, Subtract, Divide, Hue, Saturation,
    Color and Luminosity.
  - Extras: Grain Extract, Grain Merge, Average, Negation, Reflect, Glow, Freeze, Heat and Phoenix.
  - The blend maths is written out by hand, so results are identical in every browser.
- **Motion blur**, with amount and direction controls, in two styles: a sharp molecule with a fading
  trail, or a fully blurred molecule.
- Letters are drawn from the bundled Inter font's outlines, so the watermark looks the same on every
  device.

## Which file type is best?

- **JPEG XL** gives the smallest truly lossless files, and it can also be used lossy. The catch:
  Chrome, Edge and Firefox don't display it yet without a settings flag. Safari does. Use it for
  archiving, or when you know the viewer supports it.
- **WebP (lossless)** is the recommended default. It's usually around a quarter smaller than PNG and
  opens everywhere.
- **AVIF** is excellent for "visually lossless" photos, but its lossless mode is weak.
- A JPG has already thrown some detail away. Converting it to a lossless format keeps those flaws
  exactly, so the file usually gets _bigger_. To shrink JPGs, use Compress:
  - **Lossless** re-packs the JPG's coding, the same thing `jpegtran -optimize` does, with identical
    pixels.
  - **Visually lossless** re-saves it at a high quality.

Measured on a 1600 × 1200 test image (synthetic, so treat these as indicative):

| Starting file    | Result                                   | Change |
| ---------------- | ---------------------------------------- | ------ |
| Camera-style JPG | Compress, lossless (identical pixels)    | −14%   |
| Camera-style JPG | Compress, visually lossless (quality 90) | −20%   |
| PNG              | → JPEG XL lossless                       | −67%   |
| PNG              | → WebP lossless                          | −63%   |
| PNG              | → PNG optimised (lossless)               | −49%   |
| PNG              | → AVIF lossless                          | −29%   |

## Running it

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # development server
npm run build      # production build in dist/
npm run preview    # serve the production build
```

The output in `dist/` is a static site; any static host works. A GitHub Pages workflow is included
(see below).

## Checks

| Check      | Command                |
| ---------- | ---------------------- |
| Formatting | `npm run format:check` |
| Lint       | `npm run lint`         |
| Types      | `npm run typecheck`    |
| Build      | `npm run build`        |
| Unit tests | `npm test`             |
| End-to-end | `npm run test:e2e`     |
| Security   | `npm audit`            |

The end-to-end tests drive the real site in Chromium:

- They generate their own test images for every supported format at run time, so no binary files are
  stored in the repository.
- They upload them, run every tool, and check the downloads pixel by pixel.
- They also fail on any browser console error.

To use an already installed Chromium instead of Playwright's download, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path.

GitHub Actions runs all of these on every push and pull request (`.github/workflows/ci.yml`).

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` publishes the site whenever `main` changes. To switch it on, open the
repository's **Settings → Pages** and set **Source** to **GitHub Actions**. Note that a Pages site is
public.

## Project layout

```
src/
  lib/            processing logic (no UI)
    pipeline.ts     decode → resize → watermark → encode, per tool
    codecs.ts       loads the WebAssembly codecs on demand
    jpegOptimize.ts lossless JPEG re-packing
    blend.ts        the 36 blend modes and compositing
    molecule.ts     formaldehyde geometry (layouts, custom letters)
    motionBlur.ts   motion blur / trail
    watermark.ts    placement, colour and settings
    metadata.ts     EXIF / ICC handling for JPG, PNG and WebP
  workers/        background processing (keeps the page responsive)
  components/     Svelte interface
tests/            unit tests (Vitest)
e2e/              browser tests (Playwright)
```

## Known limitations

- **Animated GIF/WebP:** only the first frame is used.
- **RAW files:** developed with the camera's white balance into an 8-bit sRGB image.
- **Metadata:** "Keep metadata" carries EXIF and colour profiles into JPG, PNG and WebP (and colour
  profiles into TIFF). AVIF and JPEG XL output is written without them.
- **Lossless JPG mode:** progressive and arithmetic-coded JPGs keep their (already efficient) coding;
  only their metadata is cleaned.
- **Extra images inside JPGs:** some phones store extra images inside a JPG, such as depth maps, using
  the "MPF" format. These are removed when a JPG is re-packed.
- **Large files:** very large RAW files are limited by the device's memory.

## Credits

The codecs are open-source WebAssembly builds:

- [jSquash](https://github.com/jamsinclair/jSquash) (MozJPEG, OxiPNG, libwebp, libavif, libjxl),
  Apache-2.0.
- [LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm) for RAW. LibRaw itself is LGPL-2.1 / CDDL.
- [libheif-js](https://github.com/catdad-experiments/libheif-js) for HEIC, LGPL-3.0.
- [UTIF.js](https://github.com/photopea/UTIF.js) for reading TIFF, MIT.
- [opentype.js](https://github.com/opentypejs/opentype.js), MIT.
- [fflate](https://github.com/101arrowz/fflate), MIT.
- [Inter](https://rsms.me/inter/), SIL Open Font License.
