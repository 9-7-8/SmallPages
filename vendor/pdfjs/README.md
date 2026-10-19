# vendor/pdfjs

Mozilla's [PDF.js](https://github.com/mozilla/pdf.js) 3.11.174, the renderer behind
[`../../anything-to-image.html`](../../anything-to-image.html)'s PDF pages. Apache 2.0; the
licence is in `LICENSE`.

| File | From |
| --- | --- |
| `pdf.min.js` | `pdfjs-dist@3.11.174`, `build/pdf.min.js` |
| `pdf.worker.min.js` | `pdfjs-dist@3.11.174`, `build/pdf.worker.min.js` |

Fetch them again with:

```
npm pack pdfjs-dist@3.11.174
tar xzf pdfjs-dist-3.11.174.tgz package/build/pdf.min.js package/build/pdf.worker.min.js package/LICENSE
```

## Why 3.x, and why both files are plain scripts

Version 4 onwards ships ES modules only, and a `<script type="module">` is fetched under CORS
rules that a page opened straight off the filesystem cannot satisfy — so on `file://` the
import fails before anything runs. The 3.x line still ships a UMD build, which a classic
`<script src>` loads from anywhere.

The worker is the same story one level down. Normally you point `GlobalWorkerOptions.workerSrc`
at `pdf.worker.min.js` and PDF.js fetches it, which `file://` again forbids. Loading it here as
an ordinary script instead puts it on `window.pdfjsWorker`, where PDF.js finds it already in
hand and never goes looking. The cost is that it runs on the main thread rather than in a real
worker, so a very long document will hold the tab while it renders; the gain is that the page
behaves identically opened from a folder and served over HTTP, which is the whole point of
these pages.
