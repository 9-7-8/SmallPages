# vendor/cassette

What [`../../make-cassette-image.html`](../../make-cassette-image.html) draws with. The
display faces are in [`../fonts/`](../fonts/), shared with the CD tool.

It was ported from `makeimage.py`, a Python script that ran over a folder of pictures with
Pillow and wrote one PNG per picture per face into an `output/` folder. The script and its
artwork were in a Google Drive folder, `IxosTools/makecaseteimage/`.

## The artwork

| File | Was | What it is |
| --- | --- | --- |
| `shell.png` | `casete.png` | the VHS cassette, with a hole through the middle for the picture |
| `label.png` | `text.png` | the strip of tape stuck across the front, which the title is written on |

Both were 3135×3135 in the original and are 1500×1500 here, which is more than the page
needs and keeps the repo off a 7.5 MB PNG. The full-size ones are still in that Drive
folder if a bigger master is ever wanted: `casete.png` is file id
`1LMYjy4kpNM7919YtclP2iKpSz03pP9cu` and `text.png` is `18tYQbyXUERYg8YG-j6998ePcZS9o5eRV`.

Despite the folder's spelling, and the name the page kept, the shell is a VHS videocassette
rather than an audio one.

## The window, and where it actually is

The script also opened a third file, `window.png`, converted it to greyscale, and then never
used it. It is a mask: a 1358×825 rounded rectangle at **(889, 1222)** in the 3135×3135
frame, marking the hole in the shell.

That matters, because the script hard-coded the 1358×825 and then worked out *where* to put
the picture by centring it — `(3135 - 825) // 2`, which is 1155, not 1222. Every cover it
made was 67 pixels out: the top of the picture hidden behind the shell, and a strip of bare
`#030303` backing showing along the bottom of the window. The mask had the right answer in
it the whole time.

The page uses the measured position, so `window.png` is not vendored here — only the number
it carries, which is in the page's `WINDOW` constant with this note behind it.

## art.js

`art.js` carries both overlays again, inlined as data URIs and resized to the 1000×1000 the
canvas draws them at. It exists for the same reason `../cd-image/scans.js` does: a page
opened straight off the filesystem counts a sibling `file://` image as cross-origin, draws
it quite happily, and then marks the canvas tainted, so `toBlob` throws and every save
silently fails. A classic `<script src>` is not subject to that and a data URI taints
nothing, so the page saves the same locally as it does served. The PNGs above stay, and the
page falls back to them if the bundle goes missing.

Regenerate it with the `convert` command quoted at the top of the file.

## Licences

The two scans came with the script and no licence was recorded with them; the Drive copy of
`casete.png` carries a stock-image description ("Vhs Tape Front Old Information"), so they
are most likely free stock photographs rather than anything original. Check before leaning
on them for anything beyond personal use.
