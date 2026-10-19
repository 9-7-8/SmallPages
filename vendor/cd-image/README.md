# vendor/cd-image

What [`../../make-cd-image.html`](../../make-cd-image.html) draws with. The tool it was
ported from fetched all of this from an image host and a Dropbox share at run time; here it
is in the repo, so a link going stale cannot turn every cover made afterwards into a black
circle set in a fallback sans.

## The scans

| File | Was | What it is |
| --- | --- | --- |
| `cd.png` | https://i.ibb.co/wZVNfHxH/cd.png | the disc, used as the mask that gives it its edges and centre hole |
| `case.png` | https://i.ibb.co/0jrDZsNw/overlay2.png | the glossy case layer, mixed with the blend mode the page offers |
| `plastic.png` | https://i.ibb.co/BHScw0Fb/overlay.png | the plastic, laid flat over the top |
| `tape.png` | https://i.ibb.co/LhD935Sk/tape.png | the strip of tape, tintable |

Note the rename: the original's `overlay.png` is the plastic and `overlay2.png` is the case,
which is the sort of pairing you only get to work out once.

## scans.js

`scans.js` carries the four scans again, inlined as data URIs and resized to the
1000×1000 the canvas draws them at. It exists because a page opened straight off
the filesystem counts a sibling `file://` image as cross-origin: it draws fine
and then taints the canvas, so `toBlob` throws and every save silently fails. A
classic `<script src>` is not subject to that and a data URI taints nothing, so
the page saves the same locally as it does served. The full-size PNGs above stay
as the originals, and the page falls back to them if the bundle goes missing.

Regenerate it with the `convert` command quoted at the top of the file.

## The faces

They used to live here, in `fonts/`. They are now in [`../fonts/`](../fonts/),
shared with [`../../make-cassette-image.html`](../../make-cassette-image.html), which
reaches for most of the same ones. That README records where each came from.
