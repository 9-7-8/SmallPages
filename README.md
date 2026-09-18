# SmallPages
[![CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

Single-purpose browser tools. Each one is a standalone HTML file — open it, use it,
close it. Nothing is uploaded anywhere; every image, GIF and byte stays in your tab.

**Live:** https://9-7-8.github.io/SmallPages/

## The tools

| Page | What it does |
| --- | --- |
| [`index.html`](index.html) | The hub. Links to everything below. |
| [`gif-to-mcmeta.html`](gif-to-mcmeta.html) | Turns an animated GIF into a Minecraft vertical texture strip plus a matching `.mcmeta`, with frametimes read from the GIF's own timing. |
| [`minecraft-item.html`](minecraft-item.html) | Pads any picture out to a square with transparency, then resamples it to 16×16 and the 2×, 4×, 8×, 12×, 24× sizes above it, plus whatever multiple you type. Nearest neighbour, box, bilinear, bicubic and Lanczos are all implemented in the page rather than left to the browser's own smoothing, and filtering happens on premultiplied alpha so transparent padding can't darken the edges. Every size, and the padded square itself, copies to the clipboard or saves as a PNG. |
| [`png-to-swirl-gif.html`](png-to-swirl-gif.html) | Spins a still image into a looping GIF. |
| [`image-to-svg.html`](image-to-svg.html) | Traces a bitmap into vector work — flat colour regions or centreline strokes — with palette control and a before/after wipe. |
| [`remove-background.html`](remove-background.html) | Cuts the subject out of an image and hands back a transparent PNG to copy or save, cropped to what's left by default. A backdrop that the border ring says is one flat colour is flooded away from the edges inwards, so colour walled in by an outline — the white inside a line drawing — survives; the flood is what comes up first on every image. Behind it, an ISNet segmentation model runs locally through [@imgly/background-removal](https://github.com/imgly/background-removal-js), bundled into [`vendor/`](vendor/), so the other cut is a click away; on a backdrop that isn't flat it takes the view as soon as it lands. The weights are fetched on first use (~80 MB, then cached by the browser); the image itself never leaves the page. |
| [`palette-to-gem.html`](palette-to-gem.html) | Grows a faceted gemstone out of a palette you pick or pull from an image — sharp plane changes, cool facets against warm ones, and whatever fire the cut carries. |
| [`unified-palette.html`](unified-palette.html) | Takes colours that refuse to sit together, gives them a shared undertone, then cross-mixes them into a palette where every colour agrees with every other one. |
| [`playlist-to-audio.html`](playlist-to-audio.html) | Turns a YouTube or YouTube Music playlist into a `yt-dlp` command you run yourself. The page builds the command only — no audio passes through it. |
| [`anything-to-image.html`](anything-to-image.html) | Paste, drop or pick anything — a screenshot, spreadsheet cells, a slide shape, an SVG, plain text, a link — and it comes back as a PNG, JPEG or WebP to copy or save. Drop a whole `.xlsx` and every visible tab becomes its own page, cropped to the cells that hold something; the workbook is unzipped and read in the page itself, with no spreadsheet library behind it. |
| [`unzip.html`](unzip.html) | Opens a `.zip` and lists what's inside; click a name to save that file, or take the lot one per second. Reads the archive's central directory directly and inflates with the browser's own `DecompressionStream`, so there's no library to load. |

## Theme

All pages share [`theme.css`](theme.css): a monochromatic glow on true OLED black,
set in Lexend Deca (falling back to Helvetica). The one other face is `--mono`, a
system monospace stack for text that is literally a command or a column of figures.

Two custom properties at the top of the file drive every colour in the repo:

```css
:root {
  --sat: 0;    /* 0 = white glow · 1 = full colour */
  --h: 288;    /* which colour, once --sat is above 0 */
}
```

`--sat` is the master. At `0` — the default — hue drops out entirely and the
accent is white. Raise it and `--h` starts to show; `0.35` gives a faint wash,
`1` gives full neon. Hues that work well:

| `--h` | |
| --- | --- |
| `288` | violet-magenta |
| `190` | cyan |
| `330` | hot pink |
| `155` | acid green |
| `40` | amber |

Saturation is scaled by `--sat` throughout, and accents brighten toward white as
colour drains out, so they stay accents instead of collapsing into mid-grey.

Every page links `theme.css` in `<head>` and keeps only layout and sizing in its
own `<style>` block — no page declares a colour or a typeface. Shared components
(`.card`, `.dropzone`, `.seg`, `.swatch`, `button`, form controls) are styled once
in the theme, so a new page inherits the look with almost no CSS of its own.

Canvas drawing can't read CSS, so a page that draws its own pixels —
`anything-to-image.html`, when it renders text or a link card — pulls the
resolved colours out with `getComputedStyle` and paints with those, so what it
produces matches the page whatever `--sat` and `--h` are set to.

## Running locally

No build step, no dependencies to install. Either open a file directly, or serve the
folder so relative links behave:

```
python3 -m http.server
```

Then visit `http://localhost:8000`.

Three tools need the network the first time they run — `gifuct-js` for GIF decoding
and `gif.js` for encoding, both pulled from a CDN, and the ONNX weights behind
`remove-background.html`. Everything else works offline.

`remove-background.html` is the one page that isn't self-contained: it imports
[`vendor/imgly-background-removal.mjs`](vendor/), a bundled copy of an AGPL-3.0
library. It is bundled rather than pulled from a CDN because the package has a peer
dependency that a bare CDN import would have to resolve by itself. The page still
falls back to a CDN if it is carried off without the repo around it.

## Adding a page

1. Drop a new `.html` file in the repo root.
2. Link the theme in `<head>`: `<link rel="stylesheet" href="theme.css">`
3. Use the shared vocabulary — `.card`, `.dropzone`, `.field`, `.status`, `.stage`,
   `button` — and the page inherits the look with almost no CSS of its own.
4. Add a row to the `<nav>` list in `index.html`.

Keep the "one file, one job, runs in the browser" rule. It's the whole point of the
repo, and it's why any page here can be handed to someone as a single file.

## License

[![CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — use it for anything,
commercial or not, modify it freely. Just credit Ixora and link back to this repo.