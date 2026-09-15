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

## Theme

All pages share [`theme.css`](theme.css): a monochromatic neon palette on true OLED
black, set in Lexend Deca (falling back to Helvetica).

Every colour derives from a single custom property at the top of the file:

```css
:root { --h: 288; }  /* violet-magenta */
```

Change that number and the whole repo re-skins. Some that work well:

| `--h` | |
| --- | --- |
| `288` | violet-magenta (default) |
| `190` | cyan |
| `330` | hot pink |
| `155` | acid green |
| `40` | amber |

The theme is linked *after* each page's own `<style>` block so it overrides the
colours still baked into the older pages. When a page gets cleaned up, its local
colour rules come out and the link can move up into the normal spot.

Canvas drawing doesn't read CSS, so `friends-interests.html` pulls `--h` out with
`getComputedStyle` and builds its node colours from the same hue — interests are
ranked by lightness, dim for the fewest members through to fully lit for the most.

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