# The command line

Every tool here runs in a browser tab. This is the other way in: the same
tools, driven from a terminal, so a colour can be converted in a shell script
and a palette can be read off a picture by something that is not a person.

```
node cli/run.mjs                                  what has one so far
node cli/run.mjs color-picker --help              what that one takes
node cli/run.mjs color-picker convert "#4f8fd0"
node cli/run.mjs color-picker palette photo.jpg --count 6 --json
```

Games are not in this. A game is something you play.

## How it works, and why it works that way

A command does not reimplement anything. It opens the real page in a headless
Chromium, calls one of the jobs the page offers on `window.CLI`, and prints
what comes back.

That is the whole design, and it is not an accident. A page here is one
self-contained HTML file and the only copy of what it knows — the press model
in `color-picker.html`, the k-means in OKLab, the PDF writer in
`pdf-builder.html`. A Node version of any of that would be a second tool
sharing a name with the first, right up until somebody touched one of them.
Driving the page costs a browser launch, which is about a second, and buys an
answer that *cannot* disagree with the one in the tab. `tests/test-cli.mjs`
checks that it doesn't: it runs the command, then drives the page by hand, and
holds the two answers against each other.

Three pieces:

| | |
| --- | --- |
| [`run.mjs`](run.mjs) | the dispatcher. Finds the tool, prints usage, launches nothing until a command has been understood. |
| [`lib/`](lib/) | a static server over the checkout, the Playwright and Chromium lookup, argument parsing, printing. |
| [`tools/`](tools/) | one module per page, named after it. Its arguments, its output, and nothing else. |

`lib/browser.mjs` is also where `tests/lib/env.mjs` gets its Playwright and its
Chromium, so there is one list of places to look rather than two that can
disagree.

## Adding a page to it

### 1. A `window.CLI` hook on the page

At the foot of the page's script, inside whatever closure it already has:

```js
window.CLI = {
  page: 'color-picker',
  jobs: {
    async convert(o) { … },
    palette(o) { … },
  },
};
```

Each job takes one plain object and returns plain data — it has to survive the
trip out of the tab, so no canvas, no blob, no node, and a `Uint8Array` of a
saved file comes back as an array of numbers. A job may be `async`. A job that
cannot do what was asked **throws with a sentence**, which is what the person
at the terminal will read.

The one rule: **a job is the page doing its own work.** Set the page's own
controls and call the page's own functions. If the page's logic is tangled up
in the drawing, pull the answer out into a function that returns data and have
the drawing call that — `matchHits` in `color-picker.html` was split out of
`renderMatches` for exactly this, and the page is better for it. What a job
must never do is work the answer out itself. Two copies drift, and the one in
the tab is the one people see.

Expose it unconditionally, the way a game exposes `window.GAME`. It adds no
capability a page did not already have.

### 2. Files in through the page's own inputs

A tool that takes a file does not read it in Node and hand the bytes over. It
puts the file into the page's file input with `setInputFiles`, which is the
same path a dropped file takes, and then waits for the page to say it is ready:

```js
await handle.tab.setInputFiles('#file', file);
await handle.tab.waitForFunction(() => window.CLI.image().ready);
```

So the hook also wants a small "are you ready" reader for whatever the page
has to load. A tool that *saves* a file goes the other way: the job returns
the bytes, and the tool module writes them where `--out` says.

### 3. A module in `tools/`, named after the page

```js
export const page = "color-picker.html";
export const summary = "one line for the listing";
export const usage = `the full help`;
export async function run({ words, flags, open }) { … }
```

`words` are the arguments that were not flags, `flags` is everything that was,
and `open()` gives back `{ tab, call, close }` — so a command is: validate,
`open()`, `call('job', {…})`, print, `close()` in a `finally`.

Conventions worth keeping to, because they are what somebody will expect from
the second tool having used the first:

- `--json` on everything, printing the whole answer rather than a summary of
  it. `lib/out.mjs` has `emit`, which takes the data and a function that makes
  the readable version, so the two cannot describe different runs.
- `--out <file>` for anything that produces a file.
- A flag with a fixed set of answers uses `oneOf`, so a typo lists the
  answers instead of falling through to the default.
- Default to whatever the page defaults to. Where the page has a button that
  means "just do the obvious thing" — `color-picker.html` has *Build a palette
  from this*, which sets the rule back to Dominant and lets the picture pick
  the count — the bare command is that button.
- Validate before `open()`. A typo should not cost a browser launch.

### 4. A suite

`tests/test-cli.mjs` is the one suite for all of this. A new tool adds a
block to it: the command run for real on a fixture whose right answer is
arithmetic, and a check that the page, driven by hand, says the same thing.
That second half is the one that matters. Without it a command line is free to
grow its own arithmetic and quietly be right about the wrong page.

### 5. The listing

Nothing. `run.mjs` reads `tools/`, and the page's row in the root
[`README.md`](../README.md) gains a line saying what the command line takes.

## What has one

- [x] `color-picker.html` — convert, palette, pixel, contrast, gradient, match, charts

## What hasn't, yet

Roughly biggest first inside each group, since the big ones are where a
terminal saves the most clicking.

**Pictures** · `anything-to-image.html` · `image-to-svg.html` ·
`remove-background.html` · `image-upscaler.html` · `video-to-animation.html` ·
`make-cassette-image.html` · `make-cd-image.html` · `image-grid.html` ·
`png-to-swirl-gif.html` · `split-sheet.html` · `image-compressor.html`

**Colour** · `palette-to-gem.html` · `unified-palette.html`

**Paper** · `document-viewer.html` · `pdf-ocr.html` · `pdf-builder.html` ·
`images-to-pdf.html` · `tile-pdf-pages.html`

**Words** · `speed-reader.html` · `blank-page.html` · `quiz-converter.html` ·
`captions-to-transcript.html` · `readability-check.html` ·
`markdown-to-rich-text.html`

**Sound** · `noise-machine.html` · `rain-machine.html` · `audio-to-text.html` ·
`mic-monitor.html` · `playlist-to-audio.html`

**At the table** · `card-drawer.html` · `dice-roller.html` ·
`word-puzzles.html` · `bingo-cards.html` · `combat-health-tracker.html`

**Minecraft** · `minecraft-item.html` · `gif-to-mcmeta.html`

**The day** · `countdown.html` · `pomodoro.html` · `stopwatch.html` ·
`sleep-calculator.html` · `hex-clock.html`

**Odds and ends** · `dragon-tree.html` · `bookmarklets.html` ·
`house-style.html` · `unzip.html`

A few of these are mostly a clock or a timer, and what a command line gives
them is worth thinking about before writing one: `stopwatch.html` from a
terminal is `sleep`. Where a page's job really is to sit on screen and tick,
say so in its tool module's usage rather than inventing a command for it.
