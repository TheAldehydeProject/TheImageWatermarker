# The Image Watermarker

A website for **compressing**, **converting** and **watermarking** images. Everything runs in your
browser, so images are never uploaded anywhere.

## Three separate tools

The site has a start page and one page per tool. Each page has its own settings (remembered
separately, with its own settings file), its own processing code and its own tests. They share only
the image engine: the codecs, metadata handling and the target-size search.

| Page                         | What it does                                                                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compress** (`compress/`)   | Makes files smaller and never returns a bigger file. **Keep format**: lossless (every pixel identical), visually lossless, or a target size. **WebP**: every file becomes a WebP of the size you choose (50 KB by default), using the most efficient WebP settings. |
| **Convert** (`convert/`)     | Saves as WebP (default, lossless), JPEG XL, AVIF, PNG, JPG or TIFF.                                                                                                                                                                                                 |
| **Watermark** (`watermark/`) | Adds a small formaldehyde molecule (H₂C=O) and otherwise leaves each file as it was uploaded (see below).                                                                                                                                                           |

**Reads:** JPG, PNG, WebP, RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF, SRW and more), HEIC/HEIF,
AVIF, JPEG XL, TIFF, GIF and BMP.

**Workflow extras:**

- Batch processing, with a "Download all" ZIP.
- A progress bar for the whole batch, and each file shows the step it is on (waiting, reading,
  adding the watermark, compressing, fitting a target size, done).
- **Target size** (Compress): type a size such as 50 KB. Each image is saved at the highest quality
  that fits. If even the lowest clean quality is too big, you choose what gives:
  - **Smaller size, clean look** (default): quality stays at a clean level and the image is scaled
    down as much as needed. The clean level looks about the same in every format: JPG and WebP 50,
    JPEG XL 54, AVIF 62 (measured on real photos, see below).
  - **Lower quality first**: quality may drop as low as 20 (AVIF 47) before the image is scaled
    down, keeping more pixels but with visible blur and blockiness.
  - PNG stays lossless if that fits, and otherwise drops to 256 colours. TIFF can only be resized.
  - Files already under the target in their own format are kept, apart from lossless clean-up.
- **Estimate size** (Compress and Convert): makes the exact file for the selected image, without
  saving it, and shows its size. Processing then reuses it if the settings haven't changed.
- Drag and drop, or paste images.
- Before/after comparison slider with 100% zoom.
- Size and percentage saved for every file.
- Optional resize, and removal of camera data and location (EXIF, GPS), on by default (Compress and
  Convert).
- Settings are remembered between visits, separately for each page.
- **Export settings / Upload settings** (under More options): save the page's settings to a small
  `.json` file and load them again later or on another device. Files from the old single-page
  version of the site still load: each page takes its own part.
- Light and dark mode, and a layout that works on phones.

### The watermark

The Watermark page changes nothing but the corner with the molecule:

- Each file keeps its **format, size in pixels and camera data** (and a JPG keeps its colour
  resolution).
- **Lossless files** (PNG, lossless WebP, TIFF) stay lossless: every other pixel is identical.
- **Lossy files** (JPG, WebP, AVIF, JPEG XL) are re-saved at the highest quality that keeps the file
  **no bigger than the original**, usually within a few percent of its size. A 50 KB WebP comes out
  at about 49–50 KB.
- RAW, HEIC, GIF and BMP can't be saved in their own format, so they are saved in the format chosen
  under More options (WebP by default), still no bigger than the original when lossy.
- **Generate preview** makes the exact watermarked file for the selected image and shows it in the
  before/after viewer with its size, without exporting it.
- A live preview while you change the settings, plus a full-resolution close-up of the watermark.

The molecule itself:

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

### Getting photos from megabytes to kilobytes

**Compress → WebP** with a target such as 50 KB gets any photo down to that size, in a format every
browser shows. It uses libwebp's most efficient settings (method 6 with automatic filter tuning),
which were chosen by measuring. Every result was scored with
[SSIMULACRA2](https://github.com/cloudinary/ssimulacra2), a measure of how different an image looks
to a person, on five real photos:

| WebP setting                                 | Size for the same look | Time to encode, per megapixel |
| -------------------------------------------- | ---------------------- | ----------------------------- |
| **Method 6 + automatic filtering (used)**    | **−3% to −10%**        | about 1.1 s                   |
| Method 6                                     | −3% to −6%             | about 0.24 s                  |
| Method 4 (the usual default, reference)      | —                      | about 0.17 s                  |
| Other filter and perceptual-tuning strengths | no better              | —                             |

The biggest savings come at low qualities, which is where small targets end up. The search for a
target starts from the typical size of each format at each quality, skips slow full-size tries when
a photo clearly has to be scaled down, and usually needs 2–5 tries. For example, a 4.1 MB,
2268 × 1512 photo becomes a 47.8 KB WebP: 874 × 582 with the clean look (about 3 seconds), or
1308 × 872 at quality 20 with "lower quality first".

For the smallest files at a given look, AVIF beats every other format (measured the same way, sizes
compared with JPG):

| Format          | High quality (score 70) | Very high quality (score 80) | Time to encode, per megapixel |
| --------------- | ----------------------- | ---------------------------- | ----------------------------- |
| **AVIF**        | **−30%**                | **−32%**                     | about 1.6 s                   |
| JPEG XL         | −20%                    | −27%                         | about 1.6 s                   |
| WebP            | −7%                     | −9%                          | about 0.1 s                   |
| JPG (reference) | —                       | —                            | about 0.2 s                   |

- To use AVIF, Convert to AVIF and choose a quality. Slower AVIF settings save another 5–6% but take
  nine times as long, so the site doesn't use them.
- Other AVIF options (SSIM tuning, sharp colour conversion, full-resolution colour) made no
  difference worth having.

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

Each part can also be tested on its own:

| Part                                    | Unit tests               | Browser tests                                      |
| --------------------------------------- | ------------------------ | -------------------------------------------------- |
| Shared engine and interface, start page | `npm run test:shared`    | `npm run test:e2e:home`, `npm run test:e2e:mobile` |
| Compress                                | `npm run test:compress`  | `npm run test:e2e:compress`                        |
| Convert                                 | `npm run test:convert`   | `npm run test:e2e:convert`                         |
| Watermark                               | `npm run test:watermark` | `npm run test:e2e:watermark`                       |

The end-to-end tests drive the real site in Chromium:

- They generate their own test images for every supported format at run time, so no binary files are
  stored in the repository.
- They upload them, run each tool, and check the downloads pixel by pixel.
- They also fail on any browser console error.

To use an already installed Chromium instead of Playwright's download, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path.

GitHub Actions runs the whole-site checks, then each part's tests as a separate job, on every push
and pull request (`.github/workflows/ci.yml`).

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` publishes the site whenever `main` changes. To switch it on, open the
repository's **Settings → Pages** and set **Source** to **GitHub Actions**. Note that a Pages site is
public.

## Project layout

```
index.html, compress/, convert/, watermark/   the start page and one page per tool
src/
  engine/         shared image engine (no interface)
    codecs.ts       loads the WebAssembly codecs on demand
    process.ts      building blocks: reading, resizing, saving with metadata, fitting a target size
    fitSize.ts      search for the best quality (and size) under a target file size
    metadata.ts     EXIF / ICC handling for JPG, PNG and WebP
    settings.ts     checking settings, saved settings and settings files
    workerHost.ts   runs inside each tool's web worker
  ui/             shared interface pieces (page layout, file list, preview, sliders…)
  tools/
    compress/       settings, pipeline, worker and page for Compress (+ lossless JPEG re-packing)
    convert/        settings, pipeline, worker and page for Convert
    watermark/      settings, pipeline, worker and page for Watermark (+ blend modes, molecule,
                    motion blur, rendering)
  home/           the start page
tests/            unit tests (Vitest): engine/, ui/, compress/, convert/, watermark/
e2e/              browser tests (Playwright): one file per page, plus phones
```

## Known limitations

- **Animated GIF/WebP:** only the first frame is used.
- **RAW files:** developed with the camera's white balance into an 8-bit sRGB image.
- **Metadata:** camera data and colour profiles are carried into JPG, PNG and WebP (and colour
  profiles into TIFF). AVIF and JPEG XL output is written without them.
- **Watermarked lossless files** can grow slightly, because a lossless file can't be capped without
  losing quality. The page says so when it happens.
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
