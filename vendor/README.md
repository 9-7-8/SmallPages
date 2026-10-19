# vendor

`imgly-background-removal.mjs` is [@imgly/background-removal](https://github.com/imgly/background-removal-js)
v1.7.0 bundled into one ES module, used by [`../remove-background.html`](../remove-background.html).

It is vendored rather than imported from a CDN because the package has a peer
dependency on `onnxruntime-web`, and a bare `import` from a CDN has to resolve
that peer dependency itself. Bundling settles it ahead of time, so the page
depends on nothing but files in this repo and the model weights.

Rebuild it with:

```
npm install @imgly/background-removal@1.7.0 onnxruntime-web@1.21.0 esbuild
echo 'export { removeBackground, preload } from "@imgly/background-removal";' > entry.mjs
npx esbuild entry.mjs --bundle --minify --format=esm --platform=browser \
  --outfile=vendor/imgly-background-removal.mjs
```

The library is AGPL-3.0; its licence text ships inside the bundle.

---

`swatch-books.js` is the thread and Pantone reference data behind
[`../color-picker.html`](../color-picker.html): 4,911 thread colours across 14
manufacturers' charts, and 3,668 Pantone chips in the Solid Coated and Solid
Uncoated books. It defines one global, `window.SWATCH_BOOKS`, holding entries
packed as `code~name~rrggbb;...` strings so that 8,579 swatches cost 160 kB
rather than a megabyte of JSON. The page works without it — the thread tab says
so and everything else carries on.

None of it is ours. Thread charts are Ink/Stitch's palette files, except DMC,
which is FlossVerter's; Pantone values are pantonr's (MIT). PANTONE is a
trademark of Pantone LLC, and nothing here is affiliated with or endorsed by
Pantone or any thread manufacturer. Every value is an sRGB approximation of a
physical thread or ink, which is why the page says so next to the matches.

Rebuild it with:

```
curl -O https://raw.githubusercontent.com/JuliaSzulc/flossverter/main/data/dmc.csv
curl -O https://raw.githubusercontent.com/thompsongl/pantonr/master/dist/pantone.json
for f in "Isacord Polyester" "Madeira Polyneon" "Madeira Rayon" \
         "Robison-Anton Polyester" "Robison-Anton Rayon" "Mettler Poly Sheen" \
         "Gunold Polyester" "Sulky Rayon" "Hemingworth" "Floriani Polyester" \
         "Fil-Tec Glide" "Marathon Polyester" "Anchor"; do
  curl -O --path-as-is \
    "https://raw.githubusercontent.com/inkstitch/inkstitch/main/palettes/InkStitch $f.gpl"
done
```

then pack the `.gpl` files (`R G B<tab>Name  Number` per line), the DMC CSV and
the Pantone entries whose keys end `-c` or `-u` into the two arrays above.

---

`pdfjs/` is Mozilla's PDF.js 3.11.174, which renders the PDF pages in
[`../anything-to-image.html`](../anything-to-image.html). Version 3 rather than the
current one because it still ships a UMD build, and both it and its worker are loaded as
plain scripts, so the page reads a PDF the same opened off the filesystem as it does
served. [`pdfjs/README.md`](pdfjs/README.md) has the reasoning and the command to fetch
them again.

---

`tesseract/` is [Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 with
`tesseract.js-core` 7.0.0 and the English model, which reads the text in
[`../images-to-pdf.html`](../images-to-pdf.html). Both are Apache 2.0 and their licences
are beside them.

| File | From |
| --- | --- |
| `tesseract.min.js` | `tesseract.js@7.0.0`, `dist/tesseract.min.js` |
| `worker.min.js` | `tesseract.js@7.0.0`, `dist/worker.min.js` |
| `tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core@7.0.0` |
| `eng.traineddata.gz` | `@tesseract.js-data/eng@1.0.0`, `4.0.0_best_int/` |

Note the core version: `tesseract.js-core`'s `latest` tag points at 6.1.2, which does not
carry the builds tesseract.js 7 asks for, so 7.0.0 has to be named outright.

Only the SIMD LSTM build is here, and `corePath` names that file directly rather than the
folder, because tesseract.js would otherwise feature-detect and ask for one of five
variants at four megabytes each. The wasm-in-JS form is the one it wants. The model is the
quantised `best_int` one at 3 MB rather than the 11 MB standard, which is accurate and a
third of the download.

Fetch them again with:

```
npm pack tesseract.js@7.0.0 tesseract.js-core@7.0.0 @tesseract.js-data/eng@1.0.0
```
