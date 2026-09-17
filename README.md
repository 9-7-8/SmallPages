# SmallPages
[![CC BY 4.0](https://img.shields.io/badge/License-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

Single-purpose browser tools. Each one is a standalone HTML file — open it, use it,
close it. Nothing is uploaded anywhere; every image, GIF and byte stays in your tab.

**Live:** https://9-7-8.github.io/SmallPages/

## The tools

| Page | What it does |
| --- | --- |
| [`index.html`](index.html) | The hub. Links to everything below. |
| [`friends-interests.html`](friends-interests.html) | Force-directed map of people and their interests. Select several people to see what they share, or several interests to see who has all of them. Data lives in a `PEOPLE_DATA` object at the top of the file — edit it directly. |
| [`gif-to-mcmeta.html`](gif-to-mcmeta.html) | Turns an animated GIF into a Minecraft vertical texture strip plus a matching `.mcmeta`, with frametimes read from the GIF's own timing. |
| [`png-to-swirl-gif.html`](png-to-swirl-gif.html) | Spins a still image into a looping GIF. |
| [`image-to-svg.html`](image-to-svg.html) | Traces a bitmap into vector work — flat colour regions or centreline strokes — with palette control and a before/after wipe. |
| [`palette-to-gem.html`](palette-to-gem.html) | Grows a faceted gemstone out of a palette you pick or pull from an image — sharp plane changes, cool facets against warm ones, and whatever fire the cut carries. |
| [`unified-palette.html`](unified-palette.html) | Takes colours that refuse to sit together, gives them a shared undertone, then cross-mixes them into a palette where every colour agrees with every other one. |
| [`playlist-to-audio.html`](playlist-to-audio.html) | Turns a YouTube or YouTube Music playlist into a `yt-dlp` command you run yourself. The page builds the command only — no audio passes through it. |
| [`unzip.html`](unzip.html) | Opens a `.zip` and lists what's inside; click a name to save that file. Reads the archive's central directory directly and inflates with the browser's own `DecompressionStream`, so there's no library to load. |

## Theme

All pages share [`theme.css`](theme.css): a monochromatic glow on true OLED black,
set in Lexend Deca (falling back to Helvetica).

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

Canvas drawing can't read CSS, so `friends-interests.html` pulls both properties
out with `getComputedStyle` and derives its node colours the same way — interests
are ranked by lightness, dim for the fewest members through to fully lit for the
most, which reads the same whether or not there's a hue behind it.

## Running locally

No build step, no dependencies to install. Either open a file directly, or serve the
folder so relative links behave:

```
python3 -m http.server
```

Then visit `http://localhost:8000`.

Two tools pull a library from a CDN at runtime — `gifuct-js` for GIF decoding and
`gif.js` for encoding — so those need a connection the first time you use them.
Everything else works offline.

## Adding a page

1. Drop a new `.html` file in the repo root.
2. Link the theme in `<head>`: `<link rel="stylesheet" href="theme.css">`
3. Use the shared vocabulary — `.card`, `.dropzone`, `.field`, `.status`, `.stage`,
   `button` — and the page inherits the look with almost no CSS of its own.
4. Add a row to the `<nav>` list in `index.html`.

Keep the "one file, one job, runs in the browser" rule. It's the whole point of the
repo, and it's why any page here can be handed to someone as a single file.

## License

[CC BY 4.0](LICENSE) — use it for anything, commercial or not, modify it freely.
Just credit Ixora and link back to this repo.