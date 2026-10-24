# SmallPages

Single-purpose browser tools. Each page is one standalone HTML file that runs
entirely in the tab — see [`README.md`](README.md) for what each one does and
[`theme.css`](theme.css) for the shared theme every page links.

## Git

Finished work goes to `main`, not left on a branch. Develop on whatever branch
this session was given, then merge it into `main` and push `origin/main`
yourself, without being asked and without opening a pull request for it.

Keep the history linear: rebase the working branch onto the latest
`origin/main` and fast-forward `main` onto it, rather than making a merge
commit. Push the working branch too, so the two stay in step.

Only hold off if the merge would land something broken, or if the user asks for
a pull request instead.

## Licence

GPL-3.0-or-later, the full text in [`LICENSE`](LICENSE). Every page and
`theme.css` carry a five-line notice at the top naming it, because a page here
is meant to be handed over on its own and a file with no notice has no visible
licence. A new page copies that notice with its own name in the first line;
everything else in the repo is covered by `LICENSE` at the root.

Only our own work is under it. `vendor/` is other people's and keeps their
terms, which is why the README says what each one is.

## The index

The tiles in [`index.html`](index.html) are grouped by what the page is for, in
sections with a heading and a line saying what the group is: Pictures, Colour,
Paper, Words, Sound, At the table, Games, Minecraft, The day, Odds and ends. A
new page goes in the group it belongs to, in its alphabetical place inside that
group — not on the end, and not in a group of its own unless there is genuinely
nothing it sits with. The order of the sections themselves is the order above.

Sort on the visible name with the arrows and punctuation taken out, so
`Palette &rarr; Gem` sorts under *palette gem* and lands before `PNG &rarr; Swirl
GIF`. Case is ignored. Every tile is the same height whatever group it is in,
which is what the `min-height` on `nav a` is for. The `<symbol>` sprite above the
list is referenced by id and its order does not matter.

## Games

Read [`games/MAKING.md`](games/MAKING.md) before starting one. It is the whole
procedure — paths, the page skeleton, the fixed-step loop and the test hook,
what a game's suite has to check, how to tune difficulty with the harness, and
the things that have already cost an afternoon once.
[`games/README.md`](games/README.md) is the list of what is still to build.

The short of it: a game lives in `games/<name>/index.html`, so its address is
`/games/<name>/` with no extension on the end, with the theme linked from two
levels up and the back link pointing at `../index.html`. It has to be
self-contained — someone should be able to copy the folder out and have a
working game — so no shared engine, no importing from a sibling, and nothing
outside it but `theme.css`. Its suite goes in `tests/games/`, never in the
game's own folder, which is the only part of `tests/` that nests.

A new game gets a tile in both [`games/index.html`](games/index.html), the list
`/games/` serves, and the hub.

## Applets

Bookmarklets live in [`bookmarklets.html`](bookmarklets.html), which is the
whole of their home: one `<script type="text/plain" id="src-<name>">` block at
the foot of that file holding the source verbatim, and one entry in the
`APPLETS` list naming it, saying what it does, how to use it and what it cannot
do. The button, the encoding, the sizes and the source listing are all built
from that, so a new applet touches nothing else in the repo but the list and
the block.

Two things a source may not contain. `</script>` ends the raw-text block
holding it, and `innerHTML` is refused outright by any site that sets
`require-trusted-types-for 'script'` — which is most of the sites worth writing
an applet for, and fails by doing nothing at all rather than by complaining.
Build a panel with `createElement`, `textContent` and `append`.

An applet gets what a page gets: its limits written down beside it, and a test
that runs it rather than reading it. `tests/test-applets.mjs` serves a stub of
the site the applet is for, runs the applet against it, and checks what came
out the other end.

## Tests

Suites live in [`tests/`](tests/) and run with `node tests/run.mjs`, which starts
the server and the caption stub itself. A new page gets a suite; a bug that
reached the user's ears gets a check that fails if it comes back.

Check what the page produced, not what a function returned — reload the saved
PDF and read its text back, render the audio offline and measure the envelope.
Several bugs here survived a passing test and a quick look, and were caught by
a person listening.

Fixtures go in `tests/docs`, `tests/caps` or beside the suite, and must be
named in the `FIXTURES` list in `tests/lib/env.mjs` to be copied in. Nothing
personal and nothing large. A suite reads them through `WORK` and writes its
scratch output to the same ignored directory, so a fixture there is a fresh
copy, not the committed file — link them instead and a suite that saves output
under a fixture's name overwrites it for every suite after.
