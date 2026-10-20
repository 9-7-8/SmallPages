# Tests

Every page here is a single HTML file that runs in the tab, which means the
only honest way to test one is to open it in a real browser and use it. These
are Playwright suites that do exactly that: load the page from a local server,
click the things a person would click, and check what the page actually did —
the bytes of a saved file, the shape of an audio envelope, the order of pages
in a PDF — rather than that a function returned what it was asked to return.

```sh
node tests/run.mjs              # all of them
node tests/run.mjs rain noise   # the ones whose name contains either
node tests/test-pdfb.mjs        # one, with the server already up on 8099
```

`run.mjs` starts the static server the suites point at, the caption stub for
the four suites that need it and the relay stub for the one that does, runs
each suite in turn and adds up the result. Nothing is left running afterwards.
Running a suite by hand means starting those yourself — `test-caps-relay.mjs`
with nothing on 8787 fails with the page's Chrome local-network hint, which
reads like a browser problem and is really an empty port.

## What it needs

Playwright and a Chromium. `lib/env.mjs` finds them in this order, so an
ordinary checkout and a container that provides its own both work:

| | Playwright | Chromium |
| --- | --- | --- |
| 1 | `$PLAYWRIGHT_MODULE` | `$CHROMIUM_BIN` |
| 2 | `node_modules/playwright` | `$PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome` |
| 3 | a global install | whatever Playwright picks for itself |

So `npm i -D playwright && npx playwright install chromium` is enough from
nothing. `SITE_PORT` moves the server off 8099; `TEST_WORK` moves the scratch
directory off `tests/.work`.

## What is in here

Suites are named for the page they exercise. The ones worth knowing about:

- **`test-rain.mjs`** — the largest. Renders the rain machine through an
  `OfflineAudioContext` and measures what came out: that a gust raises the
  rain band without slamming it to the ceiling, that a thunder swell rises
  over tens of milliseconds rather than ramping up from silence (which is what
  made it sound reversed), that the crack sits at a sane fraction of the body
  at both 160 m and 2.6 km, and that drops are scheduled on the audio clock
  far enough ahead to survive a stalled frame.
- **`test-noise*.mjs`, `test-breath.mjs`** — the noise machine's nine lanes.
  Loop seams measured as a sample step against the signal's own typical step,
  isochronic envelopes against the formula they claim to implement, breath
  envelopes against the figures in the research the presets came from.
- **`test-dice.mjs`** — the dice roller, where the claim worth checking is that
  the die on the table is showing what the page says was rolled. It reads each
  die's quaternion back out and works out which labelled face is pointing at
  the ceiling, for every solid the page builds: the Platonic ones, the
  ten-sided trapezohedron, the barrels for odd numbers, the bipyramids, and the
  twenty that stands in for a d100. Then the arithmetic — three hundred rolls
  of a d6 against the range and every face of it, a simulated twenty thousand
  against the mean and the sixths it should land on.
- **`test-pdfb.mjs`** — saves a PDF, reloads it through pdf.js, and reads the
  text back out, which is the only way to prove a copied page stayed a page
  rather than becoming a picture of one.
- **`test-caps*.mjs`** — the caption fetcher's route ladder, against
  `stubs/stub-yt.py`, which stands in for both a CORS relay and YouTube behind
  it so the whole path can be walked with neither reachable.
- **`checks/`** — repo-wide rather than per-page, and read-only by design:
  `audit.mjs` opens every page and lists text that starts lower-case where a
  name or a heading belongs, `survey.py` dumps every piece of visible text in
  the repo so a wording change can be eyeballed in one go. Neither edits
  anything. Earlier sessions had scripts here that applied their findings
  automatically; they are gone, because their rules went stale and the first
  thing they did on being run again was capitalise every `placeholder="none"`
  in the repo.

## Fixtures, and the ones that are missing

`docs/`, `caps/`, `dragons/`, `pdflib/`, `clip.webm`, `sample.pdf` and
`text.pdf` are all synthetic — generated for the test, carrying nobody's
content. They are copied into the scratch directory, fresh for each suite, so
a suite's `WORK + "/docs/alpha.pdf"` reads the fixture and its
`WORK + "/shot.png"` writes somewhere git ignores. Copied rather than linked
because linking was tried first and was wrong: `test-pdfb` saves its output as
`text.pdf`, which went through the link and replaced the fixture
`test-ati-file` reads, in the working tree, for good. A new fixture has to be
named in `FIXTURES` in `lib/env.mjs` or it will not be there to read.

Two suites are not runnable as checked out. `test-quiz.mjs` and
`test-quiz2.mjs` were written against a personal 5,000-card Anki collection,
and `anki/check.mjs` against the same deck's `collection.anki2`. Somebody's
flashcards are not repository material, so they are not here. Those suites
call `need()` and stand down with a `SKIP` line rather than a stack trace;
drop an `.anki2` and an `.apkg` of your own into `tests/anki/` and they run.
`anki/sqlite.mjs` is a general-purpose SQLite page reader and stands on its
own regardless.

## A passing suite is not a silent page

Several of these were written after a bug reached a person's ears first — the
startup bang on the noise machine, the gust rubber-band on the rain, the
thunder that sounded like it was playing backwards. Each now has a check that
fails if it returns. But the check exists because somebody listened, not
because the suite found it. Run the page.
