# The command line

Every tool here runs in a browser tab. This is the other way in: the same
tools, driven from a terminal, so a colour can be converted in a shell script
and a palette can be read off a picture by something that is not a person.

```
node cli/run.mjs                                  what has one so far
node cli/run.mjs color-picker --help              what that one takes
node cli/run.mjs color-picker convert "#4f8fd0"
node cli/run.mjs color-picker palette photo.jpg --count 6 --json
node cli/run.mjs image-compressor photo.jpg --out small.webp --quality 70
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

### 2. Files in, and files back out

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

`image-compressor.html` was the first of those, so it settled what `--out`
means for every page behind it. Three rules:

| | |
| --- | --- |
| `--out <file>` | written there. Where the page can write more than one format the ending picks it &mdash; and an ending contradicting an explicit `--format` is **refused**, because a WebP under a name ending in `.jpg` is a file that lies about itself. |
| `--out <dir>/` | written into that directory, under the name the page's own save would have given it. So a job that saves something returns that name, which means lifting it out of the download handler into a function of its own. |
| no `--out` | **nothing is written**, and you get the answer for the file that would have been saved. |

That last one is the page rather than caution. Opening a picture in
`image-compressor.html` shows you the tally before you have pressed anything,
and Save is a separate click &mdash; so the bare command is the open and
`--out` is the button. It also makes a sweep over `--quality` cost nothing but
time, which is most of what anybody wants a compressor in a terminal for.

A page that writes several files at once takes `--out <dir>` and nothing else.
Nothing has needed that yet; `split-sheet.html` is where it gets decided.

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
- `--out <file>` for anything that produces a file, under the three rules
  just above. A command with no `--out` writes nothing.
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

## The checklist

A page is CLI-compliant when all of this is true. The first five are the ones
that make it work; the rest are what make it look like the tool next to it.

- [ ] `window.CLI = { page, jobs }` at the foot of the page's script, inside
      whatever closure it already has, exposed unconditionally
- [ ] Every job is the page's own functions and the page's own controls &mdash;
      no arithmetic written a second time
- [ ] Every job returns plain data, and throws a sentence when it cannot
- [ ] Files go in through the page's own file input, with a small `ready`
      reader on the hook to wait on
- [ ] `cli/tools/<page>.mjs` exporting `page`, `summary`, `usage`, `run`
- [ ] `--json` on every command, through `emit`, so prose and JSON cannot
      describe different runs
- [ ] `--out <file>` wherever the page saves something, `--out <dir>` where it
      saves several, and nothing written at all without one
- [ ] Flags with a fixed set of answers go through `oneOf`; numbers through
      `number` with a range
- [ ] Defaults are the page's defaults, and the bare command is whatever the
      page's own "just do it" button does
- [ ] Validation before `open()`, so a typo and `--help` launch nothing
- [ ] A block in `tests/test-cli.mjs`: the command on a fixture whose answer is
      arithmetic, **and** the page driven by hand agreeing with it
- [ ] A line on the page's row in the root [`README.md`](../README.md) saying
      the command line exists
- [ ] A line moved from the list below into *What has one*
- [ ] `node tests/run.mjs` green

## Things that have already cost time

**The page's default is not the obvious default.** `color-picker.html` opens
its rule box on Analogous, but *Build a palette from this* sets it back to
Dominant and clears the count. The bare `palette <picture>` had to be the
button, not the box &mdash; and the check that caught it was the one driving
the page by hand. Read what a page's own "just do it" control does before
picking a default.

**A `<select>` set to a value it has no option for keeps the old value and says
nothing.** So does a missing option name. `wantOption` in `color-picker.html`
throws with the list of real names instead; copy it rather than assigning to
`.value` and hoping.

**A range input silently rounds to its own step, and clamps to its own ends.**
`image-compressor.html` caps the longest side with a slider that starts at 240
and moves in 40, so `--max 300` is not a size that page can be asked for: the
value lands on 320 and the input says nothing about it. `--max 100` lands on
240 and `--max 9000` lands on the picture's own width. So a job that sets a
slider reads the value back off it and returns *that*, and the tool prints the
difference when there is one. Echoing the number the caller typed would have
been wrong on three of those four and unfalsifiable on all of them.

**A page that reports trouble on screen has not thrown.** `encode()` in
`image-compressor.html` catches its own errors, puts them in the status line
and leaves the last good blob where it was &mdash; which is right for someone
watching the page and a trap for a job, because `await encode()` comes back
perfectly happily with an answer about the *previous* run. The job checks the
status line's error class before trusting what it is holding. Any page whose
failure path ends in `setStatus(..., true)` rather than a `throw` wants the
same look.

**Anything a reader needs wants an attribute, not prose.** The shade ramp's
colours were only in each chip's `title`, as `#4f8fd0 — the colour itself`.
`data-hex` on the chip fixed it for the command line and for every test after.
Parsing a sentence back into data is a bug waiting for somebody to improve the
sentence.

**A job's return value goes through structured cloning.** A canvas, a blob or
a DOM node throws on the way out. Bytes come back as an array of numbers, and
the tool module is what turns them into a file.

**The page's own parser is the page's own limits.** `color-picker.html` takes
whatever the browser's canvas takes, which does not include an out-of-sRGB
`oklch()`, so the command line refuses one too &mdash; exactly as the hex field
does. Do not paper over that in the tool module. A second parser is a second
tool.

**A console-error check that reads the message text will never see the URL.**
Chromium says *Failed to load resource: the server responded with a status of
404* and puts the file only in `m.location()`, which is why `test-sheet.mjs`
spent its life failing on a favicon it was trying to ignore. Filter on the
location.

## What has one

- [x] **`color-picker.html`** &mdash; `convert`, `palette`, `pixel`,
      `contrast`, `gradient`, `match`, `charts`
- [x] **`image-compressor.html`** &mdash; `<picture> --out --format --quality
      --max`, and `formats`. The first one that writes a file, so it is the
      one to copy the `--out` rules off rather than inventing them again.

Two of the forty-six pages in the index. The rest are below, grouped by the
shape of the work rather than by where they sit in the hub, because pages of
the same shape are the same job twice and the second one is an afternoon.

## What hasn't, yet

### A file in, a file out

The commonest shape. `image-compressor.html` is done, which is what settled
the `--out` rules above, so these are now a matter of following them rather
than deciding anything: a job that returns bytes and a name, a tool module
that writes them, and a check that reads the saved file back through the page
rather than through a parser written to check it.

- [ ] `anything-to-image.html` &mdash; `cells.xlsx --out sheet.png`; a whole
      workbook is a page per visible tab, so this one wants `--out <dir>` too
- [ ] `image-to-svg.html` &mdash; `logo.png --out logo.svg --trace flat|centreline --colours 8`
- [ ] `image-grid.html` &mdash; `*.jpg --across 4 --out sheet.png`; several
      files in, which `setInputFiles` takes as a list
- [ ] `split-sheet.html` &mdash; `sheet.png --out pieces/`, or the page's own
      zip with `--out pieces.zip`. Several files *out*, which nothing has done
- [ ] `remove-background.html` &mdash; `photo.jpg --out cut.png --model flood|detailed`;
      the detailed model is fetched at run time, so an offline run has to say so
      rather than hang
- [ ] `image-upscaler.html` &mdash; `photo.png --out big.png --model general|anime`;
      the models are local but the slowest of these to load, so check `drive`'s
      twenty-second wait is still enough before assuming it hung
- [ ] `video-to-animation.html` &mdash; `clip.mp4 --out loop.webm --from 2 --to 6 --fps 12 --width 480 --cap 2MB`
- [ ] `png-to-swirl-gif.html` &mdash; `still.png --out swirl.gif`; encodes with
      the local `vendor/gifenc`, so it needs nothing fetched
- [ ] `make-cd-image.html` &mdash; `art.jpg --out cd.png --zoom 1.2 --tint "#ff8800"`
- [ ] `make-cassette-image.html` &mdash; the same, plus `--title "…"`
- [ ] `minecraft-item.html` &mdash; `sprite.png --out dir/ --filter lanczos --sizes 16,32,64`
- [ ] `gif-to-mcmeta.html` &mdash; `fire.gif --out dir/`, writing the strip and
      its `.mcmeta` together. The one page here that still pulls its GIF
      decoder from a CDN, so an offline run has to say so rather than hang
- [ ] `palette-to-gem.html` &mdash; `--colours "#…,#…" --out gem.png`, or
      `--from photo.jpg`
- [ ] `dragon-tree.html` &mdash; `saved/ --out tree.svg|tree.png|dragons.csv`;
      a folder of saved pages in
- [ ] `images-to-pdf.html` &mdash; `scans/*.jpg --out doc.pdf --page a4 --margin 12`
- [ ] `pdf-builder.html` &mdash; `a.pdf b.pdf --out one.pdf`; the ordering is
      drag-and-drop on screen, so the job has to take the order as a list
- [ ] `pdf-ocr.html` &mdash; `scan.pdf --out searchable.pdf --lang eng`; slow,
      and already has to be served rather than opened
- [ ] `tile-pdf-pages.html` &mdash; `doc.pdf --out sheets.pdf --across 4 --down 4 --sheet a0`
- [ ] `blank-page.html` &mdash; `notes.md --out notes.docx|.odt|.rtf|.html`

### Text in, an answer out

No file plumbing, so these are the quick ones. `playlist-to-audio.html` is
probably the easiest page in the repo to convert: it builds a `yt-dlp` command
and never touches audio, so its whole output is already a line of text meant
for a terminal.

- [ ] `playlist-to-audio.html` &mdash; `<url>` prints the command
- [ ] `readability-check.html` &mdash; `essay.txt`: five formulas, the grade
      that is their middle, and Reading Ease
- [ ] `captions-to-transcript.html` &mdash; `track.vtt --as prose|srt|vtt`
- [ ] `markdown-to-rich-text.html` &mdash; `notes.md --as html|rtf`; the page's
      point is the clipboard, and a terminal wants what it would have put there
- [ ] `unified-palette.html` &mdash; `"#…" "#…" --undertone …`
- [ ] `sleep-calculator.html` &mdash; `--wake 07:00`, or `--bed 23:30`
- [ ] `hex-clock.html` &mdash; `--at 14:23:45` giving `#142345`
- [ ] `unzip.html` &mdash; bare lists the archive, `--extract <name> --out <dir>`
      saves one; the page reads the central directory itself, so this is its
      reader and not Node's
- [ ] `bookmarklets.html` &mdash; `list`, and `source <name> [--encoded]`,
      which is what the page prints on screen anyway
- [ ] `document-viewer.html` &mdash; `letter.eml --as text`, `--find <pattern>`
      for the match walk. The second-biggest page, and the most useful of these
      from a terminal: an `.eml`, a PDF or a Word file read as text. Only the
      PDF path wants the network, and only to fetch `pdf.js`
- [ ] `speed-reader.html` &mdash; `<url> --as text` for the article extraction,
      which is the part worth having off-screen; the reading itself is not
- [ ] `audio-to-text.html` &mdash; `talk.mp3 --out transcript.txt --timestamps`;
      the page fills window by window, so the job has to wait for the last one
      to close rather than for the first text to appear
- [ ] `quiz-converter.html` &mdash; `deck.apkg --as kahoot|quizlet|… --question <field> --answer <field>`;
      its two suites are the ones that skip for want of a fixture, and its
      block in `test-cli.mjs` has to skip the same way
- [ ] `word-puzzles.html` &mdash; `words.txt --as crossword|search|crisscross|… --out puzzle.pdf`
- [ ] `bingo-cards.html` &mdash; `list.txt --players 12 --across 5 --down 5 --out cards.pdf`
- [ ] `house-style.html` &mdash; the page is a document about `theme.css`, so
      the only command that earns its keep is `tokens --sat 0.6 --h 220`
      printing the custom properties those two knobs resolve to

### Rendered rather than read

The answer exists; it is just normally played or dealt instead of printed.
The two noise pages are easier than they look &mdash; their suites already
render offline and measure the envelope, so the machinery is written.

- [ ] `noise-machine.html` &mdash; `--kind pink --seconds 30 --out noise.wav`
- [ ] `rain-machine.html` &mdash; `--seconds 60 --out rain.wav`, with the
      weather map seeded so a run can be repeated
- [ ] `dice-roller.html` &mdash; `"2d6 + d20 + 7"` giving the dice and the
      total; the solids are the on-screen half
- [ ] `card-drawer.html` &mdash; `draw --deck playing --count 5`; the landing
      is the on-screen half

### Pages whose job is to sit on screen

From a terminal a stopwatch is `sleep`, and a microphone monitor needs the
speakers of the machine it is on. Each of these still gets a tool module,
because *every tool runs from a terminal* and a page with none looks like a
page nobody got to. What it gets is a `usage` that says in one line why the
ticking is not here, and a command for whatever part is genuinely answerable.
Inventing a command that pretends to tick is worse than saying so.

- [ ] `countdown.html` &mdash; `--until 2026-12-25` printing what is left; the
      timer half is the on-screen half
- [ ] `pomodoro.html` &mdash; `--work 50 --break 10 --rounds 4` printing the
      schedule it would run
- [ ] `stopwatch.html` &mdash; usage only, unless something better turns up
- [ ] `combat-health-tracker.html` &mdash; usage only; it is one number and a
      log of what changed it
- [ ] `mic-monitor.html` &mdash; usage only; the input and the output are both
      the machine's own
