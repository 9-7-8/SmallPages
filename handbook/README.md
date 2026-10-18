# The handbook's sources

`../minecraft-server-guide.html` is **built**. Edit the files in here, then run:

```
python handbook/build.py
```

| | |
|---|---|
| `nav.txt` | The groups and the section order. **The only place the order lives.** |
| `sections/<id>.html` | One file per section. `<id>` matches `nav.txt` and the panel id. |
| `shell.html` | Everything else — head, styles, masthead, scripts — with `<!--BUILD:NAV-->` and `<!--BUILD:PANELS-->` where the generated parts go. |
| `build.py` | Assembles them. `--check` exits 1 if the built page is out of date. |

## Adding a section

1. Write `sections/<id>.html`, starting with a banner comment and
   `<section class="panel" id="panel-<id>" role="tabpanel" aria-labelledby="tab-<id>" tabindex="0">`.
   **Do not write `hidden`** — `build.py` owns that.
2. Add a line to `nav.txt` under the group it belongs to.
3. `python handbook/build.py`.

That is all — `build.py` generates the sidebar button, puts the section in the
same order as the nav, and hides everything but the default section.

## Why it is still one published file

The split is at the source, not the URL. The built page stays one file at
`https://9-7-8.github.io/SmallPages/minecraft-server-guide.html` because the
Discord bot's `/links`, the pack download page, every friend's bookmark,
`server-stats.py`, `sync-handbook-counts.sh` and `publish-handbook.sh` all
point at it.

The two things other scripts write **into** the built page — the server stats
payload and the jar count — are carried forward by `build.py` out of the
previous build rather than regenerated, so a rebuild never reverts them. The
numbers baked into these sources are only a fallback for a first build.

## Publishing

`publish-handbook.sh` (in the server repo) builds first, then structure-checks,
commits and pushes. It treats this folder and the built page as one unit, and
still refuses to carry anything else out with them.
