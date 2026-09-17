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
