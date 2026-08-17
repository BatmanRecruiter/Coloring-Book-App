# 🎨 Coloring Book Studio

Turn any photo into a printable coloring book page, right in your browser.
No server, no uploads, no dependencies — every pixel is processed locally
with the Canvas API, so your photos never leave your machine.

## Two modes

**✏️ Outlines** — clean black line art on white, for free-form coloring.
Grayscale → Gaussian smoothing → Sobel edge detection → adaptive
percentile threshold → despeckle, with optional line thickening.

**🔢 Paint by Numbers** — the photo is reduced to a small palette
(k-means color quantization), regions are smoothed and tiny fragments
merged away, then each region gets a number placed at its deepest interior
point (found with a distance transform) so the label always fits. A color
key is shown on screen and can be baked into the downloaded PNG.

## Using it

Open `index.html` in any modern browser — that's it. Or serve the folder
if you prefer:

```sh
npx serve .        # or: python3 -m http.server
```

1. Load a photo (click, drag & drop, or paste with Ctrl+V), or hit
   **Try a sample image**.
2. Pick a mode and play with the settings:
   - **Outlines**: detail (how many edges survive), smoothing (noise
     suppression before edge detection), line thickness.
   - **Paint by Numbers**: number of colors (2–24), region simplification
     (merges small fragments — higher = bolder, easier pages), line
     weight, and toggles for the numbers and a colored "solution" preview.
3. **Download PNG**, **Download with color key** (paint-by-numbers), or
   **Print** directly — the print stylesheet strips the UI so only the
   page and color key come out of the printer.

Photos with clear subjects and good contrast work best. Turn *Simplify
regions* up for younger kids (bigger areas, fewer fiddly bits) and down
for more intricate, adult-coloring-book style pages.

## Project layout

```
index.html      app shell
css/style.css   UI + print styles
js/engine.js    image processing (pure functions, no DOM — also loads under Node)
js/app.js       UI wiring: input handling, rendering, downloads
```

`js/engine.js` exports `outline(image, opts)` and
`paintByNumbers(image, opts)` operating on `{data, width, height}` RGBA
buffers, so the algorithms are testable headlessly under Node.
