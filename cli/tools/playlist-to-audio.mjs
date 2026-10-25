/* playlist-to-audio.html, from a terminal.

   The page's whole output is a line of text meant for a terminal, which makes
   this the shortest trip in `cli/` — a playlist link in, the `yt-dlp` command
   you run yourself out, and no audio anywhere near either end.

       node cli/run.mjs playlist-to-audio "https://music.youtube.com/playlist?list=OLAK5uy_…"
       node cli/run.mjs playlist-to-audio PLxxxx --tier max --quality flac --shell bash
       node cli/run.mjs playlist-to-audio sizes --tracks 180 --length 3:30

   Writing the command out in Node would have taken an afternoon and would
   have been a second builder sharing a name with the first. So this sets the
   page's own controls and hands back what the Copy button would have put on
   your clipboard, which is why `--shell` opens on PowerShell and `--to` on
   `D:\Music`: the bare command here is the page as it opens, down to the
   boxes that are already ticked. A default invented at this end would be a
   command the tab never shows anybody.

   Nothing is downloaded and nothing is run. The page cannot pull a YouTube
   stream and neither can this — what comes back is text. */

import fs from "node:fs";
import path from "node:path";
import { number, oneOf, only } from "../lib/args.mjs";
import { bold, dim, emit, rows, wrap } from "../lib/out.mjs";

export const page = "playlist-to-audio.html";
export const summary = "a YouTube or YouTube Music playlist as the yt-dlp "
  + "command you run yourself, with what each part of it is for";

const TIERS = ["max", "balanced", "min"];
const SHELLS = ["pwsh", "bash"];
const COOKIES = ["firefox", "chrome", "edge", "brave"];

/* The eight boxes under Options, by the page's own names for them, with the
   state the page opens in: seven ticked, so they are `--no-…` here, and one
   not, so it is `--sponsorblock`.

   This is the one list in `cli/` that is a second copy of something the page
   knows, and it is here because `--help` has to name the flags before a
   browser is open. It is not left to be kept level by hand: the page's own
   `tiers` job reports the same eight names and the same eight states, and
   `tests/test-cli.mjs` holds the two lists against each other. */
const BOXES = [
  ["numbers", true, "leave the 001, 002… prefix off the filenames, so "
    + "playlist order survives only until something sorts them by name"],
  ["tags", true, "leave the title, the artist and the date out of the "
    + "file's tags"],
  ["album", true, "leave the album tag alone rather than setting it to the "
    + "playlist's name"],
  ["cover", true, "leave the thumbnail off rather than embedding it as "
    + "cover art"],
  ["archive", true, "keep no archive.txt, so a second run fetches the whole "
    + "playlist again"],
  ["pauses", true, "no pauses between requests, which a long playlist gets "
    + "rate-limited for"],
  ["skip", true, "stop at the first unavailable video rather than carrying "
    + "on past it"],
  ["sponsorblock", false, "cut the segments SponsorBlock has flagged, which "
    + "works on timestamps and so can clip music"],
];

const flagFor = ([name, on]) => (on ? `no-${name}` : name);

export const booleans = ["one-line", "why", ...BOXES.map(flagFor)];

const FLAGS = ["tier", "quality", "to", "only", "cookies", "shell",
               "tracks", "length", ...booleans];

/* One column for the flag and one for what it does, so a line too long for
   either folds instead of running off the edge of somebody's terminal. */
function opt(flag, text) {
  const head = `  ${flag}`;
  const body = wrap(text, 44, " ".repeat(32));
  if (!body.length) return [head];
  if (head.length > 31) return [head, ...body];
  return [head.padEnd(32) + body[0].trimStart(), ...body.slice(1)];
}

export const usage = [
  "the yt-dlp command for a playlist, out of playlist-to-audio.html.",
  "",
  "  node cli/run.mjs playlist-to-audio <playlist> [options]",
  "  node cli/run.mjs playlist-to-audio tiers",
  "  node cli/run.mjs playlist-to-audio sizes [--tracks n] [--length 4:00]",
  "",
  ...wrap("<playlist> is a playlist link, a watch link that carries one, a "
    + "music.youtube.com link, or the bare list id out of any of them. All "
    + "four come back canonicalised, so yt-dlp never has to guess.", 74, ""),
  "",
  "Options",
  "",
  ...opt(`--tier ${TIERS.join("|")}`,
    "how much fidelity. max keeps YouTube's own stream untouched, balanced "
    + "re-encodes it to MP3, min is Opus at the bottom of its range. The "
    + "page opens on balanced"),
  ...opt("--quality <setting>",
    "the box inside that card — the container for max, the encoder setting "
    + "for balanced, the bitrate for min. `tiers` lists them, and a name the "
    + "card has no option for comes back with the ones it has"),
  ...opt("--to <folder>",
    'where the files land. The page opens with D:\\Music in the box, so that '
    + 'is the default here too; --to "" drops the -P part altogether'),
  ...opt("--only <range>", "a slice of the playlist, like 1-20"),
  ...opt(`--cookies ${COOKIES.join("|")}`,
    "borrow a signed-in session, for a private or age-gated playlist. Close "
    + "that browser first — Chrome and Edge lock their cookie database while "
    + "they are running"),
  ...opt(`--shell ${SHELLS.join("|")}`,
    "which continuation character the wrapped command uses. The page opens "
    + "on PowerShell"),
  ...opt("--one-line",
    "the whole command on one line, which is the page's Wrap lines button "
    + "pressed once"),
  "",
  /* These read as what the flag does rather than as what the box says, so
     the seven that turn something off are written off rather than having a
     "don't" put in front of the page's own wording. */
  ...BOXES.flatMap((box) => opt(`--${flagFor(box)}`, box[2])),
  "",
  ...opt("--why",
    "what every part of the command is for, which is the table the page "
    + "prints under it"),
  ...opt("--json", "the whole answer, every part and every annotation"),
  ...opt("--help", "this"),
  "",
  ...opt("tiers",
    "the three cards, the settings inside them, and the boxes underneath"),
  ...opt("sizes",
    "what a playlist that size comes to at each of the three tiers. "
    + "--tracks and --length are the page's own two fields and default to "
    + "its own 25 and 4:00; --tier marks a row and --quality moves it, since "
    + "a lossless wrapper is five times the stream it wraps"),
  "",
  ...wrap("Needs yt-dlp and ffmpeg on PATH to run the command afterwards — "
    + "not to print it. Neither is called from here and nothing is "
    + "downloaded: the page builds a command, and so does this.", 74, ""),
].join("\n");

/* The page says in a line under its title that this wants yt-dlp and ffmpeg
   on PATH. On a terminal that is checkable rather than merely stated, and a
   command printed for a machine that cannot run it has earned a word. */
function onPath(exe) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32"
    ? [`${exe}.exe`, `${exe}.cmd`, `${exe}.bat`] : [exe];
  return dirs.some((dir) => names.some((name) => {
    try { return fs.statSync(path.join(dir, name)).isFile(); }
    catch { return false; }
  }));
}

/* The things worth saying out loud: what the page would have put in orange
   text or a red border, and what this machine is missing. */
function notes(d) {
  const said = [];
  if (d.url.state === "single") {
    said.push("That link is a single video with no playlist attached, so the "
      + "command will fetch just the one track.");
  }
  if (d.url.needsAuth && !d.cookies) {
    said.push(`${d.url.id} is a playlist tied to your account, so it is not `
      + "reachable at all without --cookies and the browser you are signed "
      + `into: ${COOKIES.join(", ")}.`);
  }
  const absent = d.needs.filter((n) => !n.onPath).map((n) => n.name);
  if (absent.length) {
    said.push(`${absent.join(" and ")} ${absent.length > 1 ? "are" : "is"} not `
      + "on this machine's PATH, so the command above will not run here yet. "
      + "The page's own note says where to get "
      + (absent.length > 1 ? "both" : "it") + ".");
  }
  return said.flatMap((s, i) => (i ? ["", ...wrap(s)] : wrap(s)));
}

/* The command, indented rather than prompted. The page draws a `PS>` in front
   of it because the page is showing you a terminal; in a terminal that is one
   more thing to delete before the line will run. */
const listing = (command) => command.split("\n").map((l) => "  " + l);

export async function run({ words, flags, open }) {
  const asJson = !!flags.json;
  only(flags, FLAGS);

  /* Everything a typo could be caught by, before `open()`. The three names
     below are stable enough to live at this end; `--quality` is not, because
     its answers are the <option>s inside one card, so the page is what
     refuses that one — with the card's real list in the sentence. */
  const tier = oneOf(flags.tier, "--tier", TIERS, null);
  const shell = oneOf(flags.shell, "--shell", SHELLS, null);
  const cookies = oneOf(flags.cookies, "--cookies", COOKIES, null);
  const tracks = number(flags.tracks, "--tracks", { min: 1, max: 20000 });
  for (const [name, flag] of [["--quality", flags.quality],
                              ["--only", flags.only], ["--length", flags.length]]) {
    if (flag === true) throw new Error(`${name} wants a value`);
  }
  if (flags.to === true) {
    throw new Error('--to wants a folder, or "" for no -P part at all');
  }

  /* A flag that belongs to another command is the same mistake as a flag
     that belongs to no command: it reads as having been applied. */
  const misplaced = (what, allowed) => {
    const stray = Object.keys(flags)
      .find((f) => !["help", "json", "h", ...allowed].includes(f));
    if (stray) {
      throw new Error(`--${stray} is not a flag \`${what}\` takes`
        + (allowed.length
          ? `. It takes ${allowed.map((a) => `--${a}`).join(", ")}`
          : ", which takes none but --json")
        + "; the rest belong to the command itself");
    }
  };

  if (words[0] === "tiers") {
    if (words.length > 1) throw new Error("`tiers` takes nothing after it");
    misplaced("tiers", []);
    const handle = await open();
    try {
      const said = await handle.call("tiers", {});
      emit(said, (d) => [
        "",
        ...d.tiers.flatMap((t) => [
          `  ${bold(t.key.padEnd(9))} ${t.name}${t.chosen ? dim("  — the page opens here") : ""}`,
          ...wrap(t.what, 62, "            ").map(dim),
          ...rows(t.quality.map((q) => [`--quality ${q.value}`,
            q.name + (q.default ? dim("  — the card's own") : "")]), "            "),
          "",
        ]),
        `  ${bold("boxes")}  ${dim("— each flag turns its own box the other way")}`,
        ...rows(d.options.map((o) => [`--${o.on ? "no-" : ""}${o.name}`,
          `${o.what}${o.on ? dim("  — ticked when the page opens") : ""}`]), "    "),
        "",
        ...rows([
          ["--cookies", d.cookies.join(", ")],
          ["--shell", d.shells.map((s) => `${s.value} (${s.name})`
            + (s.default ? dim(" — the page's own") : "")).join(", ")],
          ["--to", d.dest],
        ], "    "),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  if (words[0] === "sizes") {
    if (words.length > 1) {
      throw new Error("`sizes` takes nothing after it — the playlist's own "
        + "length goes in --tracks and --length");
    }
    misplaced("sizes", ["tracks", "length", "tier", "quality"]);
    const handle = await open();
    try {
      const said = await handle.call("sizes", {
        tier, tracks,
        quality: flags.quality === undefined ? null : String(flags.quality),
        length: flags.length === undefined ? null : String(flags.length),
      });
      emit(said, (d) => [
        "",
        `  ${bold(`${d.tracks} tracks`)} averaging `
          + `${Math.floor(d.each / 60)}:${String(d.each % 60).padStart(2, "0")}`
          + ` is ${bold(d.duration)} of audio`,
        "",
        ...rows(d.tiers.map((t) => [t.key,
          `${t.human.padStart(8)}   ${dim(t.label)}`
            + (t.chosen ? bold("  ←") : "")]), "  "),
        "",
        ...wrap("An estimate off the bitrate and the runtime, which is all "
          + "anybody can say before the files exist. The count is on the "
          + "playlist page next to the title.").map(dim),
        "",
      ], asJson);
    } finally { await handle.close(); }
    return;
  }

  const link = words[0];
  if (!link) {
    throw new Error("which playlist? a link, or the bare list id out of one — "
      + "or `tiers` for the three quality cards and `sizes` for an estimate");
  }
  if (words.length > 1) {
    throw new Error("one playlist at a time, and "
      + `${words.length} were given. A slice of one goes in --only 1-20`);
  }
  if (tracks !== null || flags.length !== undefined) {
    throw new Error("--tracks and --length are the estimate's, not the "
      + "command's: `playlist-to-audio sizes --tracks 180 --length 3:30`");
  }

  const asked = {
    url: link, tier, quality: flags.quality === undefined ? null : String(flags.quality),
    shell, cookies,
    dest: flags.to === undefined ? null : String(flags.to),
    items: flags.only === undefined ? null : String(flags.only),
    wrap: flags["one-line"] ? false : null,
  };
  /* A box is passed only when it was asked about, so the page's own ticks are
     what an unmentioned one keeps. */
  for (const box of BOXES) {
    if (flags[flagFor(box)]) asked[box[0]] = !box[1];
  }

  const handle = await open();
  try {
    const said = await handle.call("command", asked);
    said.needs = ["yt-dlp", "ffmpeg"].map((name) => ({ name, onPath: onPath(name) }));

    emit(said, (d) => [
      "",
      `  ${bold(d.url.kind || "single video")}`
        + (d.url.id ? ` ${dim("·")} ${d.url.id}` : ""),
      "",
      ...listing(d.command),
      "",
      ...rows([
        ["tier", `${d.tier} ${dim("·")} ${d.setting}`],
        ["saving to", d.dest || dim("wherever it is run")],
        ["only", d.items || null],
        ["cookies", d.cookies || null],
        ["shell", d.shell === "pwsh" ? "PowerShell" : "bash / zsh"],
        ["ticked", Object.keys(d.options).filter((k) => d.options[k]).join(", ")],
        ["left off", Object.keys(d.options).filter((k) => !d.options[k]).join(", ")
          || null],
      ]),
      ...(notes(d).length ? ["", ...notes(d)] : []),
      "",
      ...(flags.why
        ? [...d.parts.filter((p) => p.why).flatMap((p) => [
            `  ${bold(p.arg.split(" ")[0])}`,
            ...wrap(p.why, 70, "      ").map(dim),
          ]), ""]
        : [`  ${dim("--why says what every part of that is for")}`, ""]),
    ], asJson);
  } finally { await handle.close(); }
}
