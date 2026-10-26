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

Suites sit in this folder, except the games', which sit in
[`games/`](games/) under it because there are going to be a lot of them and
because a game's tests must not live in the game's own folder. Nothing else
nests.

`run.mjs` starts the static server the suites point at, the caption stub for
the four suites that need it and the relay stub for the one that does, runs
each suite in turn and adds up the result. Nothing is left running afterwards.
Running a suite by hand means starting those yourself — `test-caps-relay.mjs`
with nothing on 8787 fails with the page's Chrome local-network hint, which
reads like a browser problem and is really an empty port. `test-cli.mjs` is
the one that needs nothing started: the command line it is testing serves the
checkout itself, on whatever port is going.

## What it needs

Playwright and a Chromium. `lib/env.mjs` takes both from
[`cli/lib/browser.mjs`](../cli/lib/browser.mjs), which the command line needs
them for too, and they are looked for in this order, so an ordinary checkout
and a container that provides its own both work:

| | Playwright | Chromium |
| --- | --- | --- |
| 1 | `$PLAYWRIGHT_MODULE` (its `index.mjs` or its folder) | `$CHROMIUM_BIN` |
| 2 | `node_modules/playwright` here, in the current folder or in your home folder | `$PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux/chrome` |
| 3 | a global install, wherever npm keeps those | Playwright's own Chromium, if it was ever installed |
| 4 | | the Chrome or Edge already on the machine |

[`cli/README.md`](../cli/README.md) has the full list of places. So
`npm i -D playwright && npx playwright install chromium` is enough from
nothing, and on a machine with Chrome or Edge,
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -g playwright` is. The server and
the stubs are Python 3: `python3`, or `python` or `py` where `python3` is the
Windows Store's placeholder, or `$PYTHON`. `SITE_PORT` moves the server off
8099; `TEST_WORK` moves the scratch directory off `tests/.work`.

The command line keeps a browser profile between runs so that a page's own
storage survives (see *A browser that remembers* in the CLI's README).
`test-cli.mjs` runs every command with `SMALLPAGES_PROFILE=none`, so each one
starts from nothing as a suite should, and checks the kept profile separately
in a folder of its own under `WORK`.

## Writing one

A suite is one file that opens the page in a real browser, uses it, prints a
`PASS` or `FAIL` line per check, and exits non-zero if any failed. `run.mjs`
only starts it and adds the lines up. There is no framework, nothing to
register, and no helper to learn beyond `lib/env.mjs`.

### 1. Check what the page produced

Not what a function returned. Reload the saved PDF and read its text back out,
render the audio through an `OfflineAudioContext` and measure the envelope,
open the saved picture again and read its pixels. Several bugs here survived a
passing test and a quick look, and were caught by a person listening.

Where the page is the only thing in the repo that can read its own output &mdash;
an image encoder, a zip reader, a PDF writer &mdash; hand the file back to the
page rather than writing a reader in the suite to check it. A second reader is
a second implementation, and the two drift. Read bytes directly only for what
no decoder is needed for: a magic number, a PNG's `IHDR`, a string that should
or should not be in there.

### 2. The skeleton

```js
import { chromium, CHROMIUM_BIN, WORK, scoring } from './lib/env.mjs';

const { ok, done } = scoring();
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
/* … */
ok('nothing threw along the way', errs.length === 0, errs.join(' | '));
process.exit(done());
```

`scoring()` keeps the tally, so the exit code still means something when the
suite is run on its own rather than through `run.mjs`. Collect `pageerror` and
console errors into a list as you go and assert it is empty at the end &mdash;
filtering the missing favicon on its **location**, not its text, because
Chromium says only *the server responded with a status of 404* and puts the
file nowhere but `m.location()`. A failure the suite causes on purpose, and
that the page is right to log, comes off that list where it is caused, with a
line saying whose it was.

### 3. Draw the fixtures if you can

A picture, a sound or a document the suite can draw for itself does not belong
in the repository. Put the painter in the suite, seed anything random from a
fixed sequence rather than `Math.random`, and give the thing the structure the
page is actually judged on &mdash; flat colour encodes to nothing at any
quality and so cannot show a quality setting doing anything, and upscales
perfectly by any means at all.

What genuinely cannot be drawn goes in `FIXTURES` in `lib/env.mjs`, read
through `WORK`, carrying nobody's content and nothing large. Write scratch
output under `WORK` too, under a name no other suite uses.

### 4. Wait on the answer, not on a stopwatch

`waitForTimeout` passes on a fast machine and reads the *previous* answer on a
slow one, which is a check that silently stops checking. Wait for the thing
you are about to assert, or for a signal the page changes on every new answer:
`image-compressor.html` puts a fresh object URL on its compressed layer each
time it encodes, so that `src` changing is proof the tally underneath is the
new one.

### 5. Prove every check can fail

The step nobody thinks they need. **A suite that passes the first time it is
run has told you nothing yet** &mdash; a check that would pass whatever the
page did looks exactly like a check that works.

So break the page on purpose, one behaviour at a time, and see which check
notices. Keep the page's text in hand, swap one thing for a wrong thing, run
the suite, restore it. Twenty minutes of that is worth more than twenty more
checks. Three things come out of it:

- **A check nothing catches.** Either it is asserting a tautology, or the
  behaviour has a second guard holding it up &mdash; both worth knowing.
- **A behaviour no check covers.** Write the check.
- **A behaviour that cannot be broken from outside.** `image-compressor.html`
  will not enlarge a picture, and nothing could make it: the slider's ceiling
  is the picture itself, so the clamp underneath is never asked to refuse
  anything. The suite lifts the ceiling to get at it. Without that the clamp
  could be deleted and nothing here would notice.

Two of these are already written up where they were found. `test-rain.mjs` has
six checks that were measuring a random variable against a line drawn from one
good run, and between them lost about one run in six. `test-imgc.mjs` came at
it from the other end: 48 checks passed first time, and of seven deliberate
breakages one went unnoticed and one check turned out to be about a browser
default rather than about the page.

**Write down what you could not check, beside the check concerned.** A limit
recorded is a limit the next person can work with; a limit left implied reads
as coverage that is not there.

### 6. If there is randomness in it

Measure the figure over hundreds of runs before drawing a line anywhere near
it, and do not move the line until it goes quiet &mdash; make the
*measurement* steadier instead, and write the spread it came from down beside
it. Keep a null measurement alongside: the same figure read where there is
genuinely nothing to find, so the check is known to still be able to fail.
How repeats are combined matters as much as taking them; `test-rain.mjs`'s
entry below is the long version, and it is worth reading before averaging
anything.

## What is in here

Suites are named for the page they exercise. The ones worth knowing about:

- **`test-rain.mjs`** — the largest. Renders the rain machine through an
  `OfflineAudioContext` and measures what came out: that a gust raises the
  rain band without slamming it to the ceiling, that a thunder swell rises
  over tens of milliseconds rather than ramping up from silence (which is what
  made it sound reversed), that the crack sits at a sane fraction of the body
  at both 160 m and 2.6 km, and that drops are scheduled on the audio clock
  far enough ahead to survive a stalled frame.

  The page is full of `Math.random`, as a rain machine should be, and for a
  while six of these checks were measuring a random variable against a line
  drawn from a single good run. Four of them were caught failing; the other
  two only turned up when every figure was measured a few hundred times to
  see where it really sits. Between them they lost about one run in six.

  The fix was not to move the lines until they went quiet. Each figure was
  measured over hundreds of renders, and then the *measurement* was made
  steadier wherever it could be — only one line actually moved, and it has
  the spread it was derived from written down beside it, along with a null
  measurement showing what the same figure reads when there is genuinely
  nothing to find, so the check is known to still be able to fail.

  The lever is repeating a render, but **how** you combine the repeats is
  the whole thing, and getting it wrong here made one check worse rather
  than better. Averaging envelopes only works when the feature under test is
  time-locked: the swell test applies the same fixed envelope every time and
  only the noise beneath it differs, so the mean of six envelopes is that
  envelope with the wobble taken off. A thunder strike is not like that —
  only its first segment arrives at a predictable moment and the rest land
  where the generator puts them — so averaging those envelopes sharpens the
  first arrival, smears everything after it, drags the peak back towards the
  onset and reports the opposite of what is there. Those checks take the
  median of each figure measured on its own render instead.
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
- **`test-cli.mjs`** — the command line in [`cli/`](../cli/), run as a
  subprocess the way a person runs it. The picture it reads is painted here in
  flat bands of known width, so a palette's shares are arithmetic rather than
  opinion, and the colour readings, the contrast gradings, the gradient CSS
  and the nearest thread are all checked against known answers. Then the half
  that is the point of the arrangement: it opens `color-picker.html` in a
  browser, types into the hex field and presses *Build a palette from this*,
  and holds what the page shows against what the command printed. A command
  line that grew colour maths of its own would pass everything above and fail
  that. What goes wrong is checked too — a colour the page cannot read, a
  pixel off the edge of the picture, a chart that does not exist and a page
  with no command line yet each exit non-zero with a sentence.

  `image-compressor` is the second tool in it and the first that writes a
  file, so its half ends in a stronger version of the same idea: the page is
  driven by hand through its real format box, its real sliders and its real
  Save button, and the downloaded file is compared *byte for byte* with what
  `--out` wrote at the same three settings. Two files rather than two readings
  of a number. It also pins the thing the page does quietly — the cap slider
  moves in forties from 240, so `--max 300` is not a size that page can be
  asked for, and the command line has to report the 320 it got rather than the
  300 it was given.

  `playlist-to-audio` is the third, and the one whose answer is neither a
  reading nor a file but a command somebody is going to paste into a terminal,
  so the thirteen arguments of the bare command are written out here and
  compared one at a time. Then the page is opened, a playlist is typed into
  it, **nothing else is touched**, and what it shows is held against what
  `playlist-to-audio <url>` printed — which is the check the whole arrangement
  rests on, because the bare command is defined as the page as it opens and
  for a while the page as it opened was lying about itself. Then eight
  controls are moved by hand and compared against the same eight as flags, and
  the annotation table on screen against what `--why` prints. One more holds
  the eight box names in `cli/tools/playlist-to-audio.mjs` — which has to name
  them to print `--help` without launching a browser, and is the only place in
  `cli/` where something a page knows is written down twice — against the
  eight the page reports, the same way round.

  `uncrop` adds a batch: a folder of three pictures of different shapes, with
  a text file and an earlier output lying among them, run with
  `--left 15%h`, and every file checked by its `IHDR` against fifteen per
  cent of its own height; one of them run on its own has to be the batch's
  file byte for byte, and the same picture driven through the page by hand
  &mdash; `15%h` typed into the real Add-left field &mdash; has to be that
  file again. A broken picture in the middle of a batch is named and the rest
  still written. The kept browser profile is checked through `drive` itself:
  something put in uncrop's weight store by one run has to be there for the
  next, on the same origin, and not in a fresh profile.
- **`test-uncrop.mjs`** — the outpainter, without ever fetching a model.
  The model path runs against a stand-in session, and since the batch and
  the GPU fallback both go through `sessionFor`, the later sections stub
  `ort.InferenceSession.create` instead and put a few bytes in the page's
  own weight store, so the real creation code runs and nothing is fetched
  (a request to Hugging Face or jsDelivr fails the check). A batch of three
  is run through *Uncrop all*, the zip it saves is read in Node &mdash; a
  stored zip needs no decoder &mdash; and the session is checked to have been
  created once for the lot. A GPU that fails part way through a run is
  staged with the error a GTX 1070 Ti really threw, and the run has to finish
  on the CPU, say so, and keep the model off the GPU afterwards; the null, a
  GPU that works, has to stay on it. The feather check moved from the mirror
  to the stubbed model, because under a mirror the fill beneath the
  picture's edge is the picture's edge and the blend changes nothing &mdash;
  that check passed on a software canvas by rounding and failed on a GPU one.
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
- **`games/test-approach.mjs`** — the air traffic one, where nearly every
  rule is about the middle of a run rather than the end of it. It drags a
  route with a real pointer and flies the aircraft down it; puts one exactly
  over a threshold and turns it a degree at a time to find where the heading
  tolerance stops; watches every aircraft every step and fails if one ever
  turns faster than it is allowed to; holds one in a tight circle and sends
  another into it to prove two touching ends the shift, and that they light
  up before they do. The one worth the most is the fairness check: an arrival
  is only accepted if nothing comes near it for eleven seconds, so the suite
  plays all three fields on twenty-five seeds each with nobody at the console
  and fails if anything hits anything. An earlier version of that guard
  sampled every half second, which is not often enough for two darts closing
  head-on, and let a pair through that collided nine seconds into a shift the
  player had not touched.
- **`games/test-gridlock.mjs`** — the traffic game. Drawing is done with real
  pointer drags and checked as road: one-way the way it was dragged, two-way
  only after a drag back over it, refused into a blob that makes cars or out
  of one that takes them, and stopped dead by the budget. The rest is the run,
  stepped a sixtieth at a time with the board watched as it goes — a junction
  never holding more than one car whichever way it came, a two-way street
  holding one each way, no car ever entering a junction on somebody else's
  green, every car at a stop sign having actually stopped first, two cars on a
  roundabout at once. Then the levels. Each is wired by a deliberately stupid
  router to prove it can be wired inside its budget at all, and the three that
  exist to teach a piece are played through twice, once without it and once
  with: a level the bare run wins teaches nothing, so the suite fails if one
  does. The gridlock itself is caught the way a player meets it — lights on a
  junction three busy roads meet at, which seizes — and the banner's ring is
  checked car by car for a car still moving.
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
- **`test-upscale.mjs`** — the image upscaler, where the claim worth checking
  is that the picture coming out is *sharper* than the same picture stretched
  rather than merely bigger. It draws a figure of bars and a disc, shrinks it
  by four, hands that over, and measures both the model's answer and the
  browser's own stretch against the original they both came from — a model
  that had quietly failed to load would come out level with the stretch. Then
  the tiling, which is the bug in an upscaler that everybody sees: the models
  take a fixed 64 px patch, so anything wider is walked in overlapping tiles,
  and a blend a hair out leaves a grid down the picture. A dead-straight ramp
  goes in, and the second difference along the middle row comes out, which
  puts a number on the kink at a tile join against the kinks everywhere else.
  The rest is what a size control is easy to get wrong in — 2× and 8× to the
  pixel, a target size that keeps its proportions, a reduction that runs no
  model at all, a size past the sixteen-megapixel ceiling that starts nothing
  and says why — and one check for a state bug rather than a picture: asking
  for the quality model while the fast one is still going has to hand the GPU
  over, because both run through the same worker and the second would
  otherwise orphan the first. Every picture in it is a few dozen pixels
  across, because a container has a software rasteriser where a GPU should be
  and each tile costs seconds there.
- **`test-imgc.mjs`** — the image compressor, where the tally adding up is the
  least of it. The page promises four things it could stop doing without any
  label on screen changing: that a lower quality is a smaller *file* and not
  just a smaller number beside a slider, that the cap on the longest side
  never enlarges anything, that a JPEG — which has no alpha — comes back with
  white where the transparency was rather than the black a canvas would
  otherwise give it, and that the EXIF block does not survive the trip. So
  almost every check here opens the saved file again, and opens it by handing
  it back to the page, which is the only image decoder in the repository; only
  the first few bytes are ever read in node, and only to catch a WebP wearing
  a `.jpg` name.

  A fifth came out of writing the first four. The page used to report a failed
  encode in red and then leave everything else exactly as it was &mdash; the
  previous run's tally, the previous picture under the seam, and a Save button
  that handed that file over and replaced the complaint with "Saved". Past
  about 268 megapixels a canvas is handed over as normal, paints nothing at
  all and returns null from `toBlob` without a word, so a large scan took that
  path. The page now drops what it was holding and turns Save off, and the
  suite injects the failure by replacing `toBlob` rather than carrying a
  gigabyte of fixture &mdash; then checks the page comes *back* when the
  encoder works again, since a page that went quiet for good would be the
  worse bug. The ceiling that avoids the failure is capped at 16383 rather
  than 16384, which is WebP's own limit: its dimensions live in fourteen bits,
  and a column past that is dropped silently, so the round number would have
  made the tally disagree with the file by a pixel.

  The EXIF one is the page's privacy claim and the one thing on it a reader
  cannot check by looking, so the fixture is built in the suite: a picture the
  browser encodes, with an APP1 block spliced in after the SOI carrying an
  orientation flag and a marker string standing in for the camera, the
  timestamp and the coordinates. A photograph with real EXIF in it would be
  somebody's photograph. The check is that the marker is nowhere in what came
  out &mdash; paired with one that it was in what went in, so the detector is
  known to work &mdash; and the orientation rides along to answer the other
  half, that a picture stored on its side comes out the way the page showed
  it, in the size reported and in the saved pixels both.

  Every one of these passed the first time it was run, which is the point at
  which this repository has learned to be suspicious, so the page was broken
  on purpose instead &mdash; eleven ways across two rounds, the second round
  aimed at the fix above. Nine were caught by exactly the check that should
  catch them, including the original stale-output bug, which five checks now
  stand on. The two that were not are written up beside the checks that cannot
  see them, because a limit recorded is worth more than a limit implied:
  taking away the argument that asks the decoder to read the EXIF orientation
  changes nothing, Chromium reading it by default now, so that check is about
  the end-to-end behaviour rather than the flag; and the proportional shrink
  that keeps an oversized picture in proportion is guarded a second time by a
  plain clamp on each side, so removing either alone still comes out right.
  The area ceiling cannot be staged at all &mdash; a source over 268
  megapixels is a gigabyte of fixture and a canvas no browser will paint &mdash;
  so the injected `toBlob` failure covers its consequence instead.

  One check exists only because of that exercise. The page will not enlarge a
  picture, and nothing could make it: the slider's ceiling is the picture
  itself, so the clamp underneath is never asked to refuse anything. The suite
  lifts the ceiling to get at it. Without that the clamp could be deleted and
  nothing here would notice.
- **`test-playlist.mjs`** — the `yt-dlp` command builder, which produces no
  file and no sound, so every check reads the command out of the `<pre>` a
  person copies rather than out of a function. Each of the eight option boxes
  is unticked in turn and the whole argument list compared before and after,
  because a box wired to the wrong flag passes a check that only looks at its
  own flag; the top tier is checked for *not* naming an audio quality, which
  is its entire promise, since naming one is what forces the re-encode it
  exists to avoid; the four shapes of playlist link all have to come out
  canonicalised; and the size estimate is checked against the multiplication
  twice over — against the bitrates the page claims, and against the rate
  printed in each row, which is worked out separately from the figure beside
  it and so can be right while that is wrong.

  The first check in it is the bug the suite was written for. `tier` was set
  to `"mp3"`, which is none of the three `data-tier` names, so the page opened
  with Balanced lit up and the *Smallest file* command underneath it: 6 kbps
  Opus, mono, speech mode, under a card that says it buys playback on anything
  with a headphone jack. Nothing on screen disagreed with anything else on
  screen, which is why it survived.

  Twenty-two deliberate breakages went in across two rounds and four were not
  noticed, which is the only reason this suite is worth anything. Loosening
  the bare-id pattern so that any word at all became a playlist id went
  straight past it — nothing here had ever typed plain text into the field.
  The length field's second branch, the one that reads a three-digit minute
  count, had never been reached, because `4:00` and `1:04:00` both match the
  first. The top tier's rate label and its size are worked out separately and
  only the label was being read, so a mutation that changed just the figure
  left `1411 kbps` sitting next to a size worked out at 160. And the *Wrap
  lines* button turned out to have the same bug as the tier: it offered to
  wrap a command that was already wrapped, which no check could see because
  only one of its two states was ever read.

  One thing written down because the obvious fixture for it is wrong. The
  readout's "Not a URL yet." is nearly unreachable in a browser: Chromium's
  URL parser percent-encodes the spaces in `the one with the horses` and hands
  back a hostname, so the page calls that a host that is not YouTube. Node's
  parser throws on the same string — so a check written against the parser in
  the suite rather than the one in the tab would have been testing a URL
  parser nobody here uses. A scheme with no host at all is what gets there.
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
- **`test-ruler.mjs`** — the true-size rule, where everything rests on one
  number: how many of the page's pixels go to the inch. So the ticks are read
  back off the canvas rather than out of the plan that drew them — a plan
  that is right and a drawing half a millimetre out is exactly the bug this
  page would have, and reading the plan back would not see it. Ten
  centimetres at 96 px to the inch is 377.95 px and the page is not allowed
  to disagree, the ranks have to be a hierarchy on the glass as well as in
  the data, and the dial's arm has to be drawn on the side the convention
  says — a sign error there mirrors every reading off it.

  Two of its checks were passing for the wrong reason, and both are the
  lesson in *Prove every check can fail* twice over. The tick-depth check
  read the lowest lit pixel in a column, which is the *figure* under the
  tick, so it stayed green with the ranks deliberately collapsed; it now
  measures the run of pixels from the measuring edge and stops at the first
  gap. The fraction check asked for `3 5/16` back, which is already in its
  lowest terms and so never exercised the reduction at all; there is a second
  mark at three and a half inches now, which has to come back as a half and
  not as eight sixteenths. Deliberately breaking the page fourteen ways is
  what found those, and it also found a real bug on the page: focusing the
  canvas scrolled it out from under the pointer between the press and the
  handler reading where the press was.

  What it cannot check is whether the scale is *true*. Nothing in a headless
  browser can hold a bank card against the glass, so the suite checks that
  the page draws what its own scale claims and that the claim follows the
  arithmetic — a person with a real rule is the only check on the last step.
  The device-pixel snapping is nearly as awkward: at a ratio of 1 it is the
  same arithmetic as snapping to the page's own pixels, so the one check that
  can tell them apart runs in a second context at a ratio of 2, which is also
  where the division that makes a zoom harmless is checked.
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
because the suite found it.

*Prove every check can fail* above keeps a suite honest about the behaviour it
set out to cover. Nothing keeps it honest about the behaviour nobody thought
of &mdash; and that is most of what reaches a person first. Run the page.
