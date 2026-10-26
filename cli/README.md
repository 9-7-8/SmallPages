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
node cli/run.mjs playlist-to-audio "https://music.youtube.com/playlist?list=OLAK5uy_…"
node cli/run.mjs uncrop covers/ --left 15%h --out wider/
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

## What it needs

Node, a Playwright library, and a browser for it to drive. Neither has to be
named: both are looked for, in this order, and the first that is there is
used.

| | Playwright | the browser |
| --- | --- | --- |
| 1 | `$PLAYWRIGHT_MODULE` &mdash; its `index.mjs`, or the folder it is in | `$CHROMIUM_BIN` |
| 2 | `node_modules/` in this checkout, the current folder, or your home folder | `$PLAYWRIGHT_BROWSERS_PATH/chromium-*/…` (a container) |
| 3 | npm's global folder &mdash; `%APPDATA%\npm\node_modules` on Windows, `…/lib/node_modules` elsewhere, then whatever `npm root -g` says | Playwright's own Chromium, if `npx playwright install chromium` was ever run |
| 4 | | the Chrome or Edge already installed, where each installs itself: `Program Files`, `Program Files (x86)` and `%LOCALAPPDATA%` on Windows, `/Applications` on a Mac, `/usr/bin` and `/opt/google` on Linux |

So on a machine with Chrome or Edge on it, the whole of the setup is one line,
and the browser download is skipped because the one you have is enough:

```
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1; npm i -g playwright      # PowerShell
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -g playwright            # bash, zsh, Git Bash
```

When either is missing the command says so in those words, with that line in
it, rather than in Playwright's &mdash; and only when something actually needs a
browser, so `--help` works on a machine with neither.

### A browser that remembers

Each command used to open a brand-new browser profile, which forgot
everything a page had kept the moment it ended. For most pages that cost
nothing. For `uncrop.html` it cost 206 MB: LaMa's weights are kept in the
page's IndexedDB so they are only ever fetched once, and every command fetched
them again.

So the command line keeps one profile, in the place each system keeps a
program's cache &mdash; `%LOCALAPPDATA%\SmallPages\cli-profile` on Windows,
`~/Library/Caches/SmallPages/cli-profile` on a Mac,
`~/.cache/smallpages/cli-profile` elsewhere &mdash; and serves the checkout on
the same port every time, 47615, because storage belongs to an origin and the
port is part of the origin. A different port each run would be a different
site each run, with nothing kept. Deleting the folder costs nothing but the
next download.

| | |
| --- | --- |
| `SMALLPAGES_PROFILE=none` | a fresh profile every time, on any free port. `tests/test-cli.mjs` runs every command like this, so nothing one check leaves behind can make the next one pass |
| `SMALLPAGES_PROFILE=<dir>` | keep the profile there instead |
| `SMALLPAGES_PORT=<n>` | the port a remembering run serves on, if something else lives on 47615 |

A profile is a folder only one browser may have open at once, so a second
command started while the first is still running cannot have it. That command
runs anyway, in a fresh profile, and says on stderr that a model will be
fetched again; so does a run whose port is taken.

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
`uncrop`'s batch was the first to need it: given several pictures, or a
folder, its `--out` is a directory whether or not the name ends in a slash,
and a name ending in a picture's own ending is refused rather than made into a
folder called `wide.png`. Each file inside is named the way the page's own
batch names it, which the job returns.

### Several files in

A tool that can take a pile of files does it the way a person would with the
page: open the page once, and hand the files in one after another through the
same file input, with the same flags. Opening the page once is the point &mdash;
it is a model loaded once rather than once a picture. `uncrop` is the one to
copy:

- A folder means the files in it a browser can open, in name order with the
  numbers in names counted as numbers, and not its sub-folders. What the
  command itself wrote last time is left out, so a batch whose `--out` is its
  own folder can be run twice.
- The page already holds the last file when the next goes in, so the wait is
  for a counter on the hook to go up (`image().loads`), not for a picture to
  be there. Waiting on `ready` reads the previous picture's answer.
- One line a file as it finishes, then a total; `--json` is the whole run at
  the end. A file that fails is named and the rest still run, and the exit is
  1 if any failed.
- One file on its own behaves exactly as it did before there were batches.

### 3. A module in `tools/`, named after the page

```js
export const page = "color-picker.html";
export const summary = "one line for the listing";
export const usage = `the full help`;
export const booleans = ["one-line"];          // optional; see below
export async function run({ words, flags, open }) { … }
```

`words` are the arguments that were not flags, `flags` is everything that was,
and `open()` gives back `{ tab, call, close }` — so a command is: validate,
`open()`, `call('job', {…})`, print, `close()` in a `finally`.

A tool with a flag that takes no value has to say so, in `booleans`, because
`--one-line <url>` is otherwise a flag called `one-line` whose value is the
URL and a command with nothing to work on. `run.mjs` reads the arguments a
second time once the tool is known, since which flags take a value is the
tool's business and not the parser's. `--help`, `--json` and `-h` are always
in there.

Conventions worth keeping to, because they are what somebody will expect from
the second tool having used the first:

- `--json` on everything, printing the whole answer rather than a summary of
  it. `lib/out.mjs` has `emit`, which takes the data and a function that makes
  the readable version, so the two cannot describe different runs.
- `--out <file>` for anything that produces a file, under the three rules
  just above. A command with no `--out` writes nothing.
- A flag with a fixed set of answers uses `oneOf`, so a typo lists the
  answers instead of falling through to the default. Where the answers are a
  `<select>`'s own options, the page refuses it instead — `wantOption` there,
  so the sentence carries the list the page really has rather than a copy of
  it kept in Node.
- A flag the tool does not know is a sentence too, through `only`, rather than
  being ignored. A tool that shrugs at `--no-covers` answers a question it was
  not asked, and the run looks like it worked.
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
      `number` with a range; flags the tool does not know through `only`
- [ ] Any flag that takes no value is named in `booleans`, so it does not
      swallow the word after it
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

**The page's own default is not what the page shows when it opens.** Two
different things, and `playlist-to-audio.html` had them disagreeing: the
Balanced tier card carried `aria-pressed="true"` in the markup while the
variable the command was built from said `"mp3"`, which is none of the three
card names, so the page opened with Balanced lit up and the *Smallest file*
command underneath it — Opus at 6 kbps, downmixed to mono, in speech mode.
Anybody who pasted it got a playlist that sounds like a phone call, and
nothing on screen disagreed with anything else on screen. Its *Wrap lines*
button had the same shape of bug, offering to wrap a command that was already
wrapped. So before deciding what a bare command is, read the markup and the
script against each other: the hook is the first thing that ever has to say
out loud which state the page is in, and a page that cannot answer that
consistently has a bug for the tab as well as for the terminal. The guard in
`tierBox` is there because the answer has to be a sentence rather than a null
dereference.

**A control the page has collapsed is still a control a job can set.** The
quality box inside each tier card is `display: none` until that card is
pressed, which does not stop `wantOption` from setting it — the DOM is the
DOM — and does stop a suite from clicking it, because Playwright waits for
something visible and then times out saying the element is not there. So a
job can reach settings a person would have to go and open first, which is
convenient and worth being deliberate about: `--quality` is read against
whichever card is up, so the flag means the same thing the box does.

**A path is not a URL on Windows.** `import("C:\\…\\tool.mjs")` is read as a
URL whose scheme is `c:` and refused with `ERR_UNSUPPORTED_ESM_URL_SCHEME`,
which is why nothing here ran on Windows at all until `run.mjs` and
`lib/browser.mjs` started handing `import()` a `pathToFileURL`. The same goes
for `page.goto`: a `file://` page is `pathToFileURL(…).href`, not a string
with a path pasted after the slashes.

**A fresh profile forgets.** See *A browser that remembers*, above: it was
costing a 206 MB download a picture before anybody noticed, because a single
run looks exactly the same either way.

**A session that starts on the GPU can still fail on it.** `uncrop.html`
already fell back to the CPU when ONNX Runtime would not *create* a session on
WebGPU. On a GTX 1070 Ti it created one happily and then failed inside a
kernel a pass into the run, which the creation fallback never saw. A page
whose work runs on WebGPU wants the fallback round the run as well, and wants
to remember that it happened.

## What has one

- [x] **`color-picker.html`** &mdash; `convert`, `palette`, `pixel`,
      `contrast`, `gradient`, `match`, `charts`
- [x] **`image-compressor.html`** &mdash; `<picture> --out --format --quality
      --max`, and `formats`. The first one that writes a file, so it is the
      one to copy the `--out` rules off rather than inventing them again.
- [x] **`playlist-to-audio.html`** &mdash; `<playlist> --tier --quality --to
      --only --cookies --shell --one-line --why` and the seven `--no-…`
      boxes, plus `tiers` and `sizes`. The first with no file at either end
      and the first with boolean flags, so it is where `booleans` and `only`
      came from. Its bare command is the page exactly as it opens, down to
      `D:\Music` and PowerShell, which is what makes the check at the end of
      `tests/test-cli.mjs` mean anything.
- [x] **`uncrop.html`** &mdash; `<picture>… | <folder> --left --right --top
      --bottom --canvas --width --height --ratio --grow --swap --scale --fit
      --at --fill --out --show-added --format --quality`, plus `sizes` and
      `formats`. Every control on the page has a flag: the four Add fields,
      the two size fields, the Swap button, the seven size presets, the eight
      shapes, the size slider, the nine align buttons, Fit inside, Actual
      pixels, dragging the picture, the three fills, the four formats, the
      quality slider, Save, and *Show what was added*, which `--show-added`
      saves at the size of the picture rather than the size of the panel.

      ```
      node cli/run.mjs uncrop cover.jpg --left 15%h --out cover-wide.png
      node cli/run.mjs uncrop covers/ --left 15%h --out wider/
      ```

      `--left 74` is a 74-pixel strip down the left; `--left 15%` is fifteen
      per cent of the picture's width, and `--left 15%h` fifteen per cent of
      its height, which is what a strip beside a book cover usually wants. The
      four are handed over as typed, like `--canvas`, and the page works out
      what they come to. Several pictures, or a folder, are a batch: the page
      and the model are loaded once, each picture goes in through the file
      input in turn, and each is written as `<its name>-uncropped.<ext>`.
      The fill defaults to `best`, LaMa, because that is what the page now
      opens on.

      The first whose bare command runs *nothing*: on that page opening a
      picture only shows you the figures and Uncrop is a separate press, so
      the bare command is those figures and `--out` is the press, which also
      means the arithmetic can be checked without fetching 80 MB of weights.
      It is also the first where the page's own default fill wants a
      download, so an offline run says so in a sentence rather than hanging,
      and the one fill that needs nothing fetched is what the written files
      are checked with.

      `--canvas` is the one flag here that is *not* parsed in `cli/`. A canvas
      can be two numbers or the name on one of the page's own preset buttons,
      and which names there are is the page's business, so the string is
      handed over as it was typed and the page resolves it or refuses it.
      `uncrop sizes` lists them by asking the page the same way. That is the
      rule at the top of this file taken one step further than the other
      three tools needed: not just *do not work the answer out*, but *do not
      keep a copy of the question either*.

- [x] **`ruler.html`** &mdash; `screen`, `ticks`, `dial`, `convert`, `objects`,
      with `--units`, `--finest`, `--degrees`, `--zero`, `--at`, `--dpi` and
      `--diagonal`.

      The first whose own job a terminal cannot do. The page is a length held
      against the glass; a shell has no glass, and no way of finding out how
      dense a screen it is not looking at. So what it offers is the
      arithmetic under the page &mdash; where every tick falls at a given
      density, what a length is in the other system, what a screen of a given
      diagonal works out at &mdash; and `--dpi` is how a density gets in,
      meaning what the page's own box means: pixels to the inch on the page.
      With nothing said the scale is the page's own opening guess rather than
      a figure invented here, which is why `screen` can say *guess* and mean
      it.

      Four of its flags are handed over exactly as they were typed, because
      which divisions a scale has, and which steps a dial is marked in, is
      the page's business: `--finest 1/5` comes back with the list the page
      really has. The lengths are the page's too &mdash; `30cm`, `300mm`,
      `12in`, `4ft`, or a bare number meaning whatever that scale counts in
      &mdash; so there is no second parser in Node to disagree with the box
      on the page.

Five of the forty-eight pages in the index. The rest are below, grouped by the
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

No file plumbing, so these are the quick ones. `playlist-to-audio.html` was
the first of them and took an afternoon including its two suites, most of
which went on the page rather than on the command — so the next one is
genuinely an hour's work and not a day's.

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
