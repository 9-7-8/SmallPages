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

## The index

The tiles in [`index.html`](index.html) are in alphabetical order by the name shown
on the tile. A new page goes in its alphabetical place, not on the end.

Sort on the visible name with the arrows and punctuation taken out, so
`Palette &rarr; Gem` sorts under *palette gem* and lands before `PNG &rarr; Swirl
GIF`. Case is ignored. The `<symbol>` sprite above the list is referenced by id and
its order does not matter.

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
