# Making a game

Everything worth knowing before starting one, so it only has to be worked out
once. [`gridlock/`](gridlock/) is the worked example and every rule below is
visible in it; when this document and that page disagree, the page is probably
right and this should be corrected.

Read this first, then [`../CLAUDE.md`](../CLAUDE.md) for the repo's own rules
and [`README.md`](README.md) for what is still to build.

## What a game is here

The same thing every other page in this repo is: one HTML file that runs
entirely in the tab, uploads nothing, needs no build step and can be handed to
someone as a single file. A game is not an exception to that — it is the
hardest case of it, which is why the rules below exist.

Two things follow that are specific to games:

- **It has to be self-contained.** Someone should be able to copy the folder
  somewhere else, change the one `theme.css` link, and have a working game to
  build on. That is half the point of this section. So: no shared game engine,
  no framework, no importing from a sibling game. Copy the pattern instead.
  The only file outside the folder a game may depend on is `../../theme.css`.
- **Its tests live somewhere else.** In `tests/games/`, never in the game's
  folder, so the copied folder is the game and nothing but the game.

## Where it goes

```
games/<name>/index.html        the game, normally the only file
games/index.html               the list /games/ serves — add a tile
index.html                     the hub — add a tile in the Games group
README.md                      a row in the table of tools
tests/games/test-<name>.mjs    the suite
tests/README.md                a line about what the suite covers
```

A folder rather than `<name>.html` so the address is `/games/<name>/` with no
extension on the end. That means two things about relative paths and both are
easy to get wrong:

```html
<link rel="stylesheet" href="../../theme.css">
<a class="home" href="../index.html">&larr; games</a>
```

`../index.html` rather than `../` so the page still works opened straight off
the filesystem.

A game that genuinely needs more than one file — a sprite sheet, a sound, a
library — puts them in its own folder beside `index.html`. `../../vendor/` is
only for a library two games both want, and a game that reaches into it stops
being copyable on its own, so say so in its own notes when it does.

## The page

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Name</title>
<link rel="stylesheet" href="../../theme.css">
<style>
  /* Layout and sizing only. Colour, type and component styling live in
     theme.css. */
</style>
</head>
<body>
<main>
  <a class="home" href="../index.html">&larr; games</a>
  <h1>Name</h1>
  <p class="lede">One sentence saying what you do.</p>
  ...
</main>
<script> ... </script>
</body>
</html>
```

The shared vocabulary — `.card`, `.seg`, `.status`, `button`, form controls —
is styled once in [`../theme.css`](../theme.css), so a page that uses it needs
almost no CSS of its own. Read that file before writing any.

**No page declares a colour or a typeface.** A game is allowed to break that
only where colour *is* the mechanic, the way `gridlock` has five hues for its
blobs, and then:

- say so in a comment at the top of the `<style>` block, with the reason;
- pair every colour with a **shape** carrying the same information, so the
  board still reads for anyone who cannot tell the hues apart;
- leave the chrome at the theme's default white glow, so colour on the page
  never means anything except the thing it was broken for;
- keep the colours in the script next to the shapes, not in the stylesheet.

Canvas cannot read a stylesheet, so pull the theme out once with
`getComputedStyle` and paint with the values — `--line`, `--line-soft`,
`--raised`, `--text`, `--text-faint`, `--neon`, `--neon-deep`. Then the game
follows `--sat` and `--h` like everything else.

Every game ends with two sections of prose in `.card`s, and both are load
bearing:

- **How it goes** — the rules, including the ones that are only obvious from
  the inside.
- **What it is not** — what the game leaves out and gets wrong on purpose. The
  repo's rule is that a page's limits are written down beside it, and a
  simulation of anything real has a lot of them. Say that cars have no
  acceleration, that the AI cannot bluff, that there is no amber.

## The engine

**Fixed step.** Run the simulation at a constant `1/60` and accumulate real
time into it, rather than stepping by frame time:

```js
const STEP = 1 / 60;
let acc = 0, last = null;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let guard = 12;                       // a stalled tab must not spiral
  while (acc >= STEP && guard-- > 0) { acc -= STEP; step(STEP); }
  if (dirty) { draw(); dirty = false; }
}
```

**Nothing random, or one seeded generator.** `Math.random()` anywhere means a
run cannot be reproduced, a bug cannot be chased and a test cannot assert
anything but averages. Drive what needs variety off a timer, an index or a
small seeded PRNG you can restart. Say which in *What it is not*.

**A test hook.** Expose one object with the state, a way to step the
simulation without waiting for real time, and whatever the test needs to set a
position up:

```js
window.GAME = {
  get S() { return S; },
  LEVELS, STEP, load, step, draw, refresh,
  fast(seconds) {                      // the page's own loop, minus the waiting
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n && !S.over; i++) step(STEP);
    refresh(); draw();
    return S.over;
  },
};
```

This is not a second copy of the rules for the test to check against — that
would prove nothing. It is the same `step()` the page runs, called faster.

## The canvas

- Draw at a whole number of pixels per cell and show the canvas at exactly
  that size. A canvas stretched by CSS to a fractional multiple gives a grid
  with some lines fatter than others.
- Multiply the backing store by `devicePixelRatio` (capped at 3) and
  `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` once, so everything after is in CSS
  pixels.
- Size it to the **window** as well as the column. A tall board at the width
  of the page pushes the controls off the bottom, and a game you have to
  scroll to play is not one you can watch:
  `unit = min(cap, floor(width / cols), floor(height * 0.62 / rows))`.
- `touch-action: none` on the canvas, or a drag scrolls the page instead of
  playing the game. Use pointer events, not mouse events, and
  `setPointerCapture` on the way down.
- Repaint only when something changed. A paused board is a still picture and
  painting it sixty times a second is somebody's battery.
- Map a pointer to the board through `getBoundingClientRect()`, never through
  the canvas's own width.

## Making it playable by more people

- **Never put information in colour alone** — pair it with a shape, a glyph or
  a position.
- Give the canvas `role="img"` and keep its `aria-label` up to date with the
  score, the level and whatever else the picture is saying.
- Offer keyboard shortcuts for everything with a button, and say in *What it
  is not* if the game itself cannot be played from the keyboard. That is a
  real limit; write it down rather than letting someone find out.
- It must work at 390px wide with no horizontal scroll. There is a check for
  this in the suite; copy it.
- A game starts paused. `theme.css` honours `prefers-reduced-motion` for
  transitions, but it cannot stop your animation loop, so do not start one
  nobody asked for.
- Keep progress in `localStorage`, every read and write wrapped in
  `try`/`catch` — it throws in a private window.

## The test

`tests/games/test-<name>.mjs`, importing `../lib/env.mjs`, which finds
Playwright and a Chromium and hands back `SITE`, `WORK` and a `scoring()`
tally. Run it with `node tests/run.mjs <name>`, which starts the static
server itself.

```js
import { chromium, CHROMIUM_BIN, WORK, SITE, scoring } from "../lib/env.mjs";
const { ok, done } = scoring();
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await page.goto(`${SITE}/games/<name>/`);
await page.waitForFunction(() => window.GAME);
...
ok("nothing shouted at the console", errs.length === 0, errs.join(" | "));
await browser.close();
process.exit(done());
```

The repo's rule is **check what the page produced, not what a function
returned**. For a converter that means reloading the saved file. For a game
there is no saved file, so what stands in for it is the run:

- **Drive the real controls.** Lay out a board with real pointer drags and
  real clicks through `page.mouse`, not by calling into the game. Then check
  the board that came out of it.
- **Watch the middle of a run, not only the end.** Most of what a game claims
  is true only while it is going — that a cell never holds two things, that
  nothing moves on a red light, that a piece always stops before it turns.
  Step the simulation a sixtieth at a time with a callback and assert every
  frame.
- **Read the readouts.** The score the page shows, the text in the banner, the
  pixels on the canvas. `getImageData` at a known cell is a fair way to prove
  a thing was drawn where it was meant to be.
- **Prove the failure states.** A game is mostly interesting when it goes
  wrong. Make it go wrong on purpose and check it says so.
- Take one screenshot into `WORK` so there is something to look at.
- Check the hub tiles resolve: `games/index.html` and the root `index.html`
  both have to link the game, and it is easy to ship one without the other.

## Tuning, if the game has difficulty in it

Do not guess at numbers. The harness is a playtester that never gets bored:
write a crude solver in the suite — one that wires up or plays a level badly
but legally — and sweep the rates, budgets and goals until the level does what
it is supposed to.

Where a level exists to teach a mechanic, **play it twice: without the
mechanic and with it, and assert the one without loses.** A level that can be
won without the thing it is teaching is a level that teaches nothing, and the
only way to know is to try it. Two of `gridlock`'s rules changed because of
what this turned up — the first model of hesitating at a junction cost nothing
once traffic was heavy, and stop signs beat traffic lights because stopping
was free.

## Names

Give the game its own name and its own art. Re-implementing a familiar set of
rules is fine; rules are not copyrightable. Shipping somebody's title, their
characters or their artwork is a different thing, and the repo is CC BY 4.0,
which means anyone may use what is here commercially. So a match-three is not
*Bejeweled*, a lane runner is not *Subway Surfers*, and the hidden-role game is
*The Committee*. Folk games — Werewolf, Liar's Dice, whist, cribbage, Klondike
— have no owner and keep their names.

## The four places that have to learn about it

1. **`index.html`** — a tile in the **Games** group, in its alphabetical place,
   with a `<symbol>` added to the sprite at the top of the file. Keep the
   `.what` description to about 65 characters: `tests/test-index.mjs` checks
   every tile is the same height, and a description that wraps to a third line
   fails it.
2. **`games/index.html`** — the same tile. When there are two groups of games
   this page should grow sections with headings the way the hub has, rather
   than one long list.
3. **`README.md`** — a row in the table, in its alphabetical place by path,
   saying what the game is and what is interesting about how it works.
4. **`tests/README.md`** — a few lines on what the suite actually checks.

Then `node tests/checks/audit.mjs`, which reads every page for text that
starts lower case, and `node tests/run.mjs` for the lot.

## Things that cost an afternoon

- `[hidden]` loses to `display: flex`. A banner with `hidden` on it stays
  visible unless the rule says `.banner[hidden] { display: none; }`.
- `--raised` on true black is a 6% difference and effectively invisible.
  Ground you cannot build on wants a hatch or an outline, not a darker grey.
- Draw every road casing before any road surface, or the second thing drawn
  cuts a notch out of the first.
- A `const` at the top level of a classic `<script>` is reachable from a later
  `<script>` and from `page.evaluate`, which is convenient but means two
  blocks cannot both declare the same name.
- `page.mouse` drags between adjacent cell centres land on the boundary; use
  `steps: 2` and let the game treat a non-adjacent jump as picking the pen up.
- A game is far easier than it feels while you are building it. Whatever
  number feels right, the harness will tell you it is too generous.

## Checklist

- [ ] `games/<name>/index.html`, self-contained, theme linked from two levels up
- [ ] Back link to `../index.html`, `h1`, `.lede`
- [ ] Layout-only CSS, or a comment saying why not
- [ ] Fixed step, nothing random, `window.GAME` hook with `fast()`
- [ ] Canvas crisp, sized to the window, `touch-action: none`, repaints when dirty
- [ ] Colour never alone, canvas `aria-label` live, keys for the buttons
- [ ] Works at 390px wide
- [ ] *How it goes* and *What it is not*
- [ ] `tests/games/test-<name>.mjs` driving the real controls and watching a run
- [ ] Tiles in `index.html` and `games/index.html`, rows in both READMEs
- [ ] `node tests/run.mjs` green, `node tests/checks/audit.mjs` quiet
