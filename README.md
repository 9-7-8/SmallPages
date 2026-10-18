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
| [`remove-background.html`](remove-background.html) | Cuts the subject out of an image and hands back a transparent PNG to copy or save, cropped to what's left by default. A backdrop that the border ring says is one flat colour, or a fake-transparency checkerboard, is flooded away from the edges inwards, so colour walled in by an outline — the white inside a line drawing — survives; the flood is what comes up first on every image. Behind it a segmentation model runs locally: ISNet through [@imgly/background-removal](https://github.com/imgly/background-removal-js), bundled into [`vendor/`](vendor/) (~80 MB of weights on first use), or, on request, [BiRefNet-lite](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX) through [transformers.js](https://github.com/huggingface/transformers.js), which is sharper on hair and fur and is fetched from jsDelivr and Hugging Face (~224 MB) rather than kept in the repo. Either model's matte then gets an edge-refinement pass — a guided filter plus blur-fusion foreground estimation — that snaps it to the photo's own edges and takes the backdrop's colour out of the soft pixels. Weights are cached by the browser; the image itself never leaves the page. |
| [`palette-to-gem.html`](palette-to-gem.html) | Grows a faceted gemstone out of a palette you pick or pull from an image — sharp plane changes, cool facets against warm ones, and whatever fire the cut carries. |
| [`unified-palette.html`](unified-palette.html) | Takes colours that refuse to sit together, gives them a shared undertone, then cross-mixes them into a palette where every colour agrees with every other one. |
| [`playlist-to-audio.html`](playlist-to-audio.html) | Turns a YouTube or YouTube Music playlist into a `yt-dlp` command you run yourself. The page builds the command only — no audio passes through it. |
| [`anything-to-image.html`](anything-to-image.html) | Paste, drop or pick anything — a screenshot, spreadsheet cells, a slide shape, an SVG, plain text, a link — and it comes back as a PNG, JPEG or WebP to copy or save. Drop a whole `.xlsx` and every visible tab becomes its own page, cropped to the cells that hold something; the workbook is unzipped and read in the page itself, with no spreadsheet library behind it. |
| [`audio-to-text.html`](audio-to-text.html) | Transcribes a recording and hands back the text as it is heard, a timestamp on every line, with the audio alongside — click a line and the player jumps to it. The page fills as the model works: Whisper reads thirty seconds at a time, each window's lines settle onto the page as that window closes, and the one still being decoded types itself out underneath them, so a long recording is readable well before it has finished. Record from the microphone or drop in a file; anything the browser can decode works, video files included, and it's mixed down to the single 16 kHz channel the model reads. That model is OpenAI's Whisper, the English-only builds in three sizes, run locally through [transformers.js](https://github.com/huggingface/transformers.js) in a worker, on the GPU where WebGPU exists and the CPU otherwise. A toggle switches the whole transcript between the timestamps and the plain words, and Copy and the `.txt` follow it. The finished transcript saves itself the moment it's done, in whichever format you picked before starting — or none, if you'd rather read it here — and all of them are a button away afterwards: `.txt` either way round, `.md` as a document, `.srt` and `.vtt` as subtitles, `.csv` as a row per line for a spreadsheet, and `.json` with the timings to the millisecond. The weights come from Hugging Face on first use (42–250 MB, then cached); the audio itself never leaves the page. |
| [`mic-monitor.html`](mic-monitor.html) | Plays the microphone straight back out of the speakers, with a meter for the level going in and the level going out, and a volume you can ride between them. Built for the delay to be small and honest about it: the audio graph is built at the microphone's own sample rate so nothing is resampled, both devices are asked for their smallest buffers, the limiter is a shaped curve rather than a compressor so it costs nothing in time, and the page shows the round trip in milliseconds, split into the part each end is responsible for. Pick the input and, where the browser allows it, the output; echo cancellation is there, off by default, because a mic and a speaker in one room is how feedback starts. Nothing is recorded and nothing leaves the page. |
| [`document-viewer.html`](document-viewer.html) | Opens a document and reads it in the page: logs, plain text, Markdown, config and data files (JSON, XML, TOML, YAML, INI, CSV, TSV, `.config`, `.settings`), PDF and Word files. Find walks the matches one at a time — string or regular expression, on ctrl-F — reading the lines themselves rather than the few the scroller has drawn, which is the only way to reach past them. A text file is streamed in and split into lines as the bytes arrive, then drawn through a virtual scroller, so only one screenful is ever in the DOM and a multi-megabyte log scrolls like a short one; a UTF-16 BOM, the kind Windows logs carry, is picked up and decoded. Lines filter by rule — include the ones that match, exclude the ones that match, plain string or regular expression, case-sensitive or not — stacked as deep as you like, and a number of lines either side of every line a rule kept, the way `grep -B` and `-A` do, with overlapping blocks merged, the borrowed lines dimmed and a hairline where the listing skipped something; a pattern pasted in from `grep` or Python keeps its leading `(?i)`, which JavaScript's own engine has no syntax for, by having it lifted into a real flag and applied in slices so typing never blocks the tab. Matches are marked in place, and what's on screen copies to the clipboard or downloads in the file's own format with `_filtered` on the name. Markdown renders in the page or shows its source; a `.docx` is unzipped and its XML walked here, with no library involved; a PDF draws through pdf.js and can hand its text to the filters. Anything that isn't text at all falls back to a hex dump. |
| [`color-picker.html`](color-picker.html) | A colour picker built in the page rather than handed to the browser's own dialog: a saturation/value field, a hue strip, scales for R, G and B and for H, S and L, and the value in hex, RGB, HSL, HSV, OKLCH, Lab, CSS and CMYK. CMYK is answered twice — the straight arithmetic everything else does, and a halftone model of a coated offset press (Demichel coverage over the Neugebauer primaries, Yule-Nielsen n = 1.7, dot gain, black overprinted) searched for the ink mix that lands closest, which is also the gamut test: when the nearest printable colour is a visible distance away the page says so and shows what you would get instead. Drop an image in and a loupe reads any pixel; a palette comes out of it by k-means in OKLab, laid out to any of the harmony rules — complementary, split, analogous, triadic, tetradic, square, monochromatic — with the wheel drawn alongside, and slots the image cannot fill honestly are rotated onto the target hue and marked as such. Also a WCAG and APCA contrast checker that will walk a colour to the nearest passing lightness, a gradient builder that interpolates in sRGB or OKLab and writes the CSS, and a search for the nearest embroidery thread and Pantone chip — 8,579 real swatches from [`vendor/swatch-books.js`](vendor/swatch-books.js), ranked by CIEDE2000. |
| [`bingo-cards.html`](bingo-cards.html) | Turns a list into bingo cards, one per player, each its own shuffle — and each drawing its own squares from the list when the list is longer than the card. The card is as many columns by as many rows as you say, and whatever the list doesn't reach becomes a free square, filled in from the middle outwards so the leftovers read as a free centre rather than as gaps; on a grid with no true centre the nearest square goes first. Give it a title, a line underneath, letters over the columns, a picture behind the card, and three colours that move independently: the rules, the type, and the panel the grid sits on, which has its own opacity so the picture can come through it or not. Print puts one card on a page with the colours and the picture kept rather than stripped, and every card also saves as a PNG drawn on a canvas, one a second. The shuffle runs from a word you can keep, so the same list and the same word print the same set again. |
| [`word-puzzles.html`](word-puzzles.html) | Takes a list of words &mdash; each with a clue, if you have them &mdash; and builds a puzzle out of it: a crossword, a word search, a criss-cross, a scramble, fill-the-blanks, a matching sheet, a code cracker or bingo cards. The list is typed one word per line with the clue split off by a tab, comma, colon, pipe or dash, or kept in a second column paired line for line, or dropped in as a CSV, TSV or `.xlsx` &mdash; the workbook is unzipped and its XML read in the page, with no spreadsheet library behind it. The crossword and the criss-cross come off one interlocking engine: words go across and down so that every word after the first crosses a word already on the grid, with the squares either end kept clear and no letter allowed to sit alongside a word it isn't part of, so the only words the grid holds are the ones that have clues. Sixty layouts are run against each other &mdash; different orders, and different ideas about what a crossing is worth against the room it costs &mdash; and the tightest one with the most words in it wins; anything that wouldn't go is named rather than quietly dropped. The word search places its words in two, four or eight directions, and fills the gaps with letters taken from the words themselves so that a lone Q can't point at the answer. Every grid is SVG: the sheet prints black on white with the answer key on a page of its own, the grid saves as an SVG file, and the whole puzzle copies out as plain text. Everything that shuffles runs from a seed, so the sheet on screen is the sheet that prints until you re-roll it. |
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
| `288` | Violet-magenta |
| `190` | Cyan |
| `330` | Hot pink |
| `155` | Acid green |
| `40` | Amber |

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

Four tools need the network the first time they run — `gifuct-js` for GIF decoding
and `gif.js` for encoding, both pulled from a CDN, the ONNX weights behind
`remove-background.html`, and `pdf.js`, which `document-viewer.html` fetches only
when you actually open a PDF. Everything else works offline, `document-viewer.html`
included for every other kind of file it opens.

`remove-background.html` is the one page that isn't self-contained: it imports
[`vendor/imgly-background-removal.mjs`](vendor/), a bundled copy of an AGPL-3.0
library. It is bundled rather than pulled from a CDN because the package has a peer
dependency that a bare CDN import would have to resolve by itself. The page still
falls back to a CDN if it is carried off without the repo around it. Its optional detailed
model is the exception to the bundling: transformers.js and the BiRefNet-lite weights are
loaded from jsDelivr and Hugging Face at run time, because the weights are too big to commit.

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