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
