# Games

Small ones, the same way round as the rest of the repo: a single page that
runs in the tab, keeps nothing and asks for nothing. The sort of thing that
used to come pre-installed or cost a pound once, and is now three adverts and
a timer.

[`MAKING.md`](MAKING.md) is the procedure — read it before starting one.
[`gridlock/`](gridlock/) is the worked example.

## Built

| | |
| --- | --- |
| [`gridlock/`](gridlock/) | Traffic puzzle. Blobs make cars, blobs eat them, you draw the one-way roads in between. |

## To build

Rough sizes: **small** is a sitting or two, **medium** needs a model worked out
first, **large** needs physics or an opponent that can think. Nothing here is
in a fixed order, but the list inside each group is roughly easiest first.

If you want somewhere to start: `sudoku`, `one-button`, `pegboard` and
`liars-dice` are one from each group and between them settle every pattern the
rest will copy — a board held in the DOM, a fixed-step loop against a clock,
hand-rolled collisions, and hidden information passed round one device.

### Puzzles

No clock. The whole state is on the board and the player can stare at it.

| Folder | What it is | Notes |
| --- | --- | --- |
| `sudoku` | The classic. | Small. Wants a generator that can promise a unique solution and grade difficulty by which techniques are needed, plus pencil marks and a check button that does not just give it away. |
| `2048` | Slide the board, equal tiles merge. | Small. The original is MIT-licensed and the name is a number. Exact tile-spawn rules matter more than they look; make them seeded so a run repeats. |
| `sand-jars` | Jars of five bands of coloured sand; pour between them until every jar is one colour. | Small. Generate by shuffling *backwards* from a solved position, so every puzzle is known-solvable. Needs an undo. |
| `cascade` | Match three. | Small, but the cascade resolution is fiddlier than it looks: match, collapse, refill, re-match until stable, and score the chain. No timer, no lives, no energy. |
| `tumbler` | Roll a 1×2 block across a tiled floor and drop it in the hole. (Bloxorz.) | Medium. The block has three states and the maths is small; the work is levels worth playing. Isometric 2D is enough — no 3D needed. |
| `solitaire` | Klondike. | Medium. Drag and drop with real pointer events, draw-one and draw-three, and the one honest hard part: telling the player when it is unwinnable rather than letting them shuffle forever. |
| `jigsaw` | Your own picture, any number of pieces. Flat, and curved onto a surface. | Medium flat, large curved. Cut tabs with a seeded edge shape so two pieces that meet actually interlock. The 3D mode is the one thing here that would want a library. |
| `maze-crawl` | First person through a maze, deliberately PS2 about it. | Medium. A raycaster in a canvas gets the look with no library and no build step, which is more in keeping than WebGL would be. Wants a map, a compass, and something to find. |

### Arcade

Something is coming at you and the clock does not stop.

| Folder | What it is | Notes |
| --- | --- | --- |
| `one-button` | Side-scroller with two modes: **Flap** (hold to rise, gravity otherwise) and **Dash** (jump on a beat, the ground does the rest). | Small. One engine, two feels — worth building together as you suggested. Fixed step matters here or the difficulty changes with the frame rate. |
| `wordfall` | Words fall; type one and it blows up. | Small. Needs a word list in the page, difficulty that comes from word length and fall speed rather than from volume, and a fair rule for which word your keystroke is aimed at. |
| `bricks` | Bat, ball, wall. | Small. Ball angle off the bat should depend on where it hit, or it plays dead. |
| `three-lanes` | Three lanes, step between them, dodge what is coming. | Small. The interesting part is generating runs that are always survivable — never two obstacles that close every lane at once. |
| `reeling` | Hold a bar over a fish that will not stay still. | Small. Stardew's version is a spring under the player's thumb; getting that feel right is the whole game. |
| `lockpick` | Feel for the sweet spot before the pick snaps. | Small. Skyrim's, and it needs the controls to be analogue — slow rotation, audible feedback — or it is just a guess. |
| `small-fry` | Eat the smaller fish, grow, avoid the bigger ones. | Medium. Needs flocking that is cheap enough for a few hundred fish, and a growth curve that keeps the danger real. |
| `approach` | Draw flight paths; keep the planes apart and land them. | Medium. Path-following plus separation checking. The original's genius is that you cause your own disasters a minute in advance. |

### Machines

Physics and luck. The ones where watching is half of it.

| Folder | What it is | Notes |
| --- | --- | --- |
| `pegboard` | Drop a disc down a field of pins. | Small. Hand-rolled circle collisions are enough. Print the real distribution next to it, because the honest version of this is a lesson in the binomial. |
| `slots` | Three reels. | Small, and the point of building it is to put the odds on the page: every symbol's frequency, every payline's return. The opposite of what the genre does. |
| `pool` | Eight-ball on a bar table. | Medium. Circle-to-circle impulses, rolling friction, cushions, and a cue that is actually aimable. Spin can wait. |
| `coin-pusher` | The seaside machine. | Large. Stacked coins need real contact physics; a 2D side-on version is the sane way in. |
| `pinball` | One table: flippers, bumpers, a plunger, a drain. | Large. Needs swept collision against line segments or the ball tunnels through the flippers at speed. The most fun and the most work. |

### Round a table

Pass-and-play, because this repo has no server (see below).

| Folder | What it is | Notes |
| --- | --- | --- |
| `liars-dice` | Bluffing with hidden dice. | Small. Pass-and-play with a hand-over screen, or everyone with their own window. An opponent that bluffs believably is a nice optional extra. |
| `werewolf` | The folk game, with the device as narrator. | Medium. Deal roles by passing the phone round, then run the night script and keep the timer. No rules invention needed — it is public domain and centuries old. |
| `the-committee` | Hidden roles, policy cards and an election tracker. | Medium. *Secret Hitler*, rebuilt and renamed. The rules are not copyrightable but the name and art are, and the original is published CC BY-NC-SA, which a GPL repo cannot take in: a non-commercial clause is exactly the kind of restriction the GPL forbids adding. So: our name, our board, our wording. |
| `cribbage` | Two-handed, with the board. | Medium. The scoring hand is the whole game and is very testable — fifteens, pairs, runs, flush, his nobs. |
| `whist` | Four-handed trick-taking. | Medium. Needs three opponents that follow suit sensibly. |
| `bridge` | Bidding and play. | Large. Bidding is a language; a partner that can hold up its end is the hard part, and it may be worth shipping play-only first. |

## On "multiplayer"

Nothing here talks to a server, and that is not going to change: it is the
rule the whole repo rests on. So the games above are built in this order of
preference:

1. **Pass-and-play on one device.** A hand-over screen hides the last
   player's secrets before the next one looks. This is how these games get
   played in a room anyway, and it works offline, forever, with no account.
2. **Several windows on one machine**, using `BroadcastChannel` to keep them
   in step. No server, no network, and it gives everyone their own hidden
   hand. Worth doing wherever hidden information makes passing a device
   awkward — which is most of this group.
3. **Actually online** would need something to relay messages between
   strangers. That is a server, and this repo does not have one. If a game
   here ever needs it, it should say so plainly on the page rather than
   quietly phoning somewhere.

## Before writing the card games

The repo already knows about cards and dice, and it is worth reading what is
there before starting again:

- [`../card-drawer.html`](../card-drawer.html) — deck definitions, shuffling
  and dealing, including a standard 52 with suits and colours already worked
  out.
- [`../dice-roller.html`](../dice-roller.html) — dice that land showing what
  was rolled, which `liars-dice` wants.

Copy from them rather than importing; a game stays self-contained.

## Also still to do

- When there are two groups of games, [`index.html`](index.html) should grow
  sections with headings and a line of gloss each, the way the hub does,
  rather than one long list of tiles.
