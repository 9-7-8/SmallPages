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
- **`test-cards.mjs`** — the card drawer. Checks each deck is the size it
  should be and that a whole deck deals every card once and none of them
  twice, that a face card is worth what the boxes under the table say, that a
  deck written by hand is read the way the page claims to read it, and that a
  spread fills its places in order — including one loaded from a JSON file
  with rubbish in it, which has to come back with the rubbish left out. Then
  the deal: a card finishes in the place the arrangement gave it to the
  millimetre, the cards leave the deck one at a time and land one at a time
  rather than all at once, and each one leaves face down and arrives face up.
  The three arrangements are checked against what they claim — a line is one
  row in the order drawn, three rows divide as 1-1-1, 1-2-1, 1-3-1, 2-3-2,
  2-4-2, 3-3-3 with the present widest, and a ring is a circle rather than an
  oval, evenly spaced, each card turned to face out of it. The colours are
  read off the deck rather than off the screen: hearts red, spades black,
  tarot suits following the suits they are, each Uno colour the colour it
  says, a major arcanum with no colour of its own.
- **`test-dice.mjs`** — the dice roller, where the claim worth checking is that
  the die on the table is showing what the page says was rolled. It reads each
  die's quaternion back out and works out which labelled face is pointing at
  the ceiling, for every solid the page builds: the Platonic ones, the
  trapezohedra, the bipyramids, the doubled solids an odd number of sides gets,
  and the twenty that stands in for a d100. Two checks are there because the
  throw used to be steered: that the last turn a die makes is a degree or two
  rather than a snap onto the face it was told to show, and that a number
  painted on a face comes round with the die when it turns rather than staying
  upright for the camera. Then the arithmetic — three hundred rolls of a d6
  against the range and every face of it, a simulated twenty thousand against
  the mean and the sixths it should land on.
- **`test-applets.mjs`** — the bookmarklets page and the bookmarklet on it.
  Half of it is the page: that the drag button holds exactly the source
  printed under it, that a click on it does not run the thing here, and that
  no source contains `</script>` or touches `innerHTML`. The other half runs
  the applet. A bookmarklet that compiles is not a bookmarklet that works, so
  the suite serves its own YouTube watch page — a transcript, three comments,
  player metadata, nothing else — fulfils the request for `youtube.com`
  locally, runs the exported bookmarklet against it, catches the download and
  reads the Markdown: every cue sorted by time rather than by the order it sat
  in the page, every comment with the likes the page displayed, and the export
  notes saying what it could not vouch for.
- **`test-palette.mjs`** — the colour picker's palette builder. Every image in
  it is painted by the suite in flat bands of known colour and known width, so
  the right answer is arithmetic rather than opinion: a band that is three
  tenths of the picture has to come back as three tenths of it. It checks that
  two shades a hair apart come back as one colour carrying both their
  coverage, that no two colours in a palette the page sized itself are close
  enough to be called the same colour, that the automatic count aims at five
  and moves off it only when the picture says so, and that a count asked for
  still returns colours that are in the picture rather than averages of ones
  that are not. The OKLab arithmetic it measures distances with is written out
  again in the suite rather than read off the page, so a mistake in the page
  cannot agree with itself.
- **`test-pdfb.mjs`** — saves a PDF, reloads it through pdf.js, and reads the
  text back out, which is the only way to prove a copied page stayed a page
  rather than becoming a picture of one.
- **`test-pdfocr.mjs`** — the same idea one step further. It builds its own
  scans — a canvas of text embedded as a JPEG, with no text layer anywhere in
  the file — reads them, saves the searchable PDF, reloads that through pdf.js
  and checks not only that the words extract but that they land where the
  words were printed, to within a few points. The turned pages are the reason
  it is worth the trouble: a document with a `/Rotate` of 90, 180 and 270 on
  three pages has to come back with its text in the same place it would be if
  nothing were turned. It also checks that a page which already had text is
  left alone, and walks a hundred-and-forty-page document to prove the range
  box and the page-at-a-time reading hold up over a long one.
- **`test-stopwatch.mjs`, `test-countdown.mjs`** — the two clocks. What is
  checked is the arithmetic a clock is easy to get wrong in: a stopwatch cuts
  hundredths rather than rounding them, a countdown rounds up and an overrun
  rounds down, lap times add up to splits, and the reading is the wall clock's
  answer rather than a count of frames — measured against `Date.now()` on the
  node side. Both are reloaded mid-run, because a reload that stops the clock
  is the bug a person notices first.
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

Not everything needs to be one. `test-pdfocr.mjs` builds its scans in the
browser when it runs — a picture of a page is a hundred kilobytes and nobody
needs to keep one in a repository — which is worth copying for anything a
suite can draw for itself.

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
