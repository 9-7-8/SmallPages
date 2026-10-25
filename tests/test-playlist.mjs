/* playlist-to-audio.html — the yt-dlp command builder.

   The page never touches audio, so there is no file to reload and no envelope
   to measure. What it produces is a line of text somebody is going to paste
   into a terminal, and the thing worth checking is that the line says what
   the page says it says: the tier that is lit up is the tier in the command,
   each box ticks exactly its own flag, the table underneath annotates the
   command it is actually under, and the size estimate is the bitrate times
   the runtime.

   The first check here is a bug. `tier` started life as "mp3", which is not
   one of the three `data-tier` names, so `build` fell through to its last
   branch: the page opened with Balanced lit up and the Smallest file command
   — Opus at 6 kbps, downmixed to mono, in speech mode — underneath it, and
   nothing on screen disagreed with anything else on screen. Anybody who
   pasted it got a playlist that sounds like a phone call.

   Everything is driven through the page's own controls rather than through
   `window.CLI`, which is `test-cli.mjs`'s half of the job. */

import { chromium, CHROMIUM_BIN, SITE, scoring } from "./lib/env.mjs";

const { ok, done } = scoring();

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1400 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await ctx.newPage();

const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/.test(m.location().url || "")) {
    errs.push(m.text());
  }
});

await page.goto(`${SITE}/playlist-to-audio.html`);

/* ------------------------------------------------------------- the page -- */

/* What is on screen, all of it, as the page has it this instant. Every check
   below reads the command out of the <pre> rather than out of a function,
   because the <pre> is what a person copies. */
const screen = () => page.evaluate(() => ({
  pressed: [...document.querySelectorAll(".tier")]
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.dataset.tier),
  lit: [...document.querySelectorAll("#est-rows tr.on .tier-name")]
    .map((td) => td.textContent),
  cmd: document.getElementById("cmd").textContent,
  readout: document.getElementById("readout").textContent.trim(),
  warned: document.getElementById("readout").classList.contains("warn"),
  why: [...document.querySelectorAll("#why tr")]
    .map((tr) => [...tr.children].map((td) => td.textContent)),
  total: document.getElementById("est-total").textContent,
  rows: [...document.querySelectorAll("#est-rows tr")].map((tr) => ({
    name: tr.querySelector(".tier-name").textContent,
    rate: tr.querySelector(".tier-rate").textContent,
    size: tr.querySelector(".tier-size").textContent,
  })),
  lengthMarked: !!document.getElementById("avglen").style.borderColor,
}));

/* The command as arguments rather than as a blob of text. The prompt the page
   draws in front of it is not part of what anybody runs, and neither is the
   continuation character at the end of each line. */
const argsOf = (cmd) => cmd
  .replace(/^(PS>|\$) /, "")
  .split(/\s[`\\]\n\s+|\n\s+/)
  .map((s) => s.trim())
  .filter(Boolean);

const LIST = "OLAK5uy_kVmHRcAlIhVuN0GLqDxvXVQ7pnU";
const MUSIC = `https://music.youtube.com/playlist?list=${LIST}`;

/* A size off the screen, back into bytes, so the check is against arithmetic
   rather than against a second copy of the page's own rounding. The display
   carries three or four figures, so the comparison below allows for the
   digit it dropped. */
function bytesOf(text) {
  const m = /^([\d.]+)\s*(KB|MB|GB)$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * { KB: 1024, MB: 1048576, GB: 1073741824 }[m[2]];
}

/* ----------------------------------------------- the tier the page opens on -- */

{
  const was = await screen();
  ok("the page opens with one tier card pressed",
    was.pressed.length === 1, was.pressed.join(", "));
  ok("the estimate table lights up that same tier and no other",
    was.lit.length === 1 && was.lit[0] === "Balanced", was.lit.join(", "));
  /* The bug itself. Balanced is MP3; the branch the page used to fall into is
     Opus at the bottom of its range with the speech-mode postprocessor on it,
     which is the one thing the command must not say while Balanced is lit. */
  ok("and the command underneath is that tier's command, not another's",
    /--audio-format mp3 --audio-quality 0/.test(was.cmd)
      && !/-application voip/.test(was.cmd), was.cmd.replace(/\n\s+/g, " "));
  ok("the page opens with no playlist and says so rather than looking ready",
    was.readout === "Nothing pasted yet."
      && /"PLAYLIST_URL"$/.test(was.cmd.trim()), was.readout);
}

/* --------------------------------------------------------- what was pasted -- */

/* Four shapes turn up in practice and all four have to come out as one
   canonical playlist URL, because the one thing worse than a command that
   fails is a command that quietly fetches something else. */
{
  const shapes = [
    [LIST, `https://www.youtube.com/playlist?list=${LIST}`, "playlist ID"],
    [MUSIC, MUSIC, "YouTube Music playlist"],
    [`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${LIST}&index=3`,
      `https://www.youtube.com/playlist?list=${LIST}`, "YouTube playlist"],
    [`https://youtube.com/playlist?list=${LIST}`,
      `https://www.youtube.com/playlist?list=${LIST}`, "YouTube playlist"],
  ];
  for (const [typed, want, kind] of shapes) {
    await page.fill("#url", typed);
    const now = await screen();
    const last = argsOf(now.cmd).at(-1);
    ok(`${kind} from ${typed.slice(0, 44)}${typed.length > 44 ? "…" : ""}`,
      last === `"${want}"` && now.readout.startsWith(kind) && !now.warned,
      `${last} · ${now.readout}`);
  }

  /* A bare id is recognised by its prefix — PL, OLAK5uy_, LL, WL, LM and the
     rest — and that list is the only thing between the field and treating any
     word somebody pastes as a playlist. This check exists because loosening
     that regex to anything alphanumeric was the one deliberate breakage of
     eighteen that the first draft of this suite did not notice. */
  for (const id of ["PLm1EdDzsvLfHhXHDTqOjzRCfZmE7zFcsx", "LL", "WL",
                    "UUabc123", "RDCLAK5uy_abc"]) {
    await page.fill("#url", id);
    const now = await screen();
    ok(`the bare id ${id} is taken for one`,
      now.readout.startsWith("playlist ID")
        && argsOf(now.cmd).at(-1) === `"https://www.youtube.com/playlist?list=${id}"`,
      now.readout);
  }
  /* A word that is not one of those prefixes is refused, though not always
     with the message you would guess: `hello` survives `new URL` as a
     hostname, so what the page says about it is that the host is not YouTube.
     Which message it is matters less than that nothing was built. */
  for (const word of ["hello", "mixtape", "untitled-1"]) {
    await page.fill("#url", word);
    const now = await screen();
    ok(`and ${word} is not, since nothing on YouTube is called that`,
      now.warned && /"PLAYLIST_URL"$/.test(now.cmd.trim()), now.readout);
  }
  /* The readout's fourth message, "Not a URL yet.", is harder to reach than
     it looks, and this is written down because the obvious fixture for it is
     wrong. `new URL` has to fail outright, and Chromium's parser does not
     fail on much: "the one with the horses" comes back as a host called
     `the%20one%20with%20the%20horses`, so the page calls that a host that is
     not YouTube. Node's parser throws on the same string, so a check written
     against the one in the suite rather than the one in the tab would have
     been testing a URL parser nobody here uses. A scheme with no host at all
     is what gets there. */
  await page.fill("#url", "http://");
  const nonsense = await screen();
  ok("something that is not a URL at all is told so in those words",
    nonsense.warned && nonsense.readout === "Not a URL yet."
      && /"PLAYLIST_URL"$/.test(nonsense.cmd.trim()), nonsense.readout);

  await page.fill("#url", "https://vimeo.com/channels/staffpicks");
  let now = await screen();
  ok("a host that is not YouTube is a warning, and nothing is built for it",
    now.warned && /isn't YouTube/.test(now.readout)
      && /"PLAYLIST_URL"$/.test(now.cmd.trim()), now.readout);

  await page.fill("#url", "https://youtu.be/dQw4w9WgXcQ");
  now = await screen();
  ok("a single video is a warning rather than a refusal, since it will work",
    now.warned && /Single video/.test(now.readout)
      && argsOf(now.cmd).at(-1) === '"https://youtu.be/dQw4w9WgXcQ"', now.readout);

  await page.fill("#url", "https://www.youtube.com/playlist?list=LM");
  now = await screen();
  ok("and Liked Music says up front that it needs your cookies",
    now.warned && /tied to your account/.test(now.readout), now.readout);
}

/* ------------------------------------------------------------ the tiers -- */

await page.fill("#url", MUSIC);

/* Each card, pressed, has to move all three of the things that claim to show
   which tier is on — and the command is the one that matters. */
{
  const want = {
    max: /-x --audio-format best$/m,
    balanced: /-x --audio-format mp3 --audio-quality 0$/m,
    min: /-x --audio-format opus --audio-quality 6K$/m,
  };
  for (const [tier, pattern] of Object.entries(want)) {
    await page.click(`.tier[data-tier="${tier}"]`);
    const now = await screen();
    const named = { max: "Highest quality", balanced: "Balanced",
                    min: "Smallest file" }[tier];
    ok(`pressing ${tier} moves the card, the estimate row and the command together`,
      now.pressed.join() === tier && now.lit.join() === named
        && argsOf(now.cmd).some((a) => pattern.test(a)),
      `${now.pressed} · ${now.lit} · ${argsOf(now.cmd)[2]}`);
  }
}

/* The top tier's whole claim is that nothing is re-encoded — "there is no
   better-sounding version behind it to go and fetch". Naming an audio quality
   is what forces ffmpeg to decode and re-encode, so the As-served setting
   must not carry one, and the two editor containers must. */
{
  await page.click('.tier[data-tier="max"]');
  await page.selectOption("#maxq", "best");
  let now = await screen();
  ok("kept as served, the top tier asks for no audio quality at all",
    !/--audio-quality/.test(now.cmd) && /--audio-format best/.test(now.cmd),
    argsOf(now.cmd)[2]);

  for (const [value, format] of [["flac", "flac"], ["wav", "wav"]]) {
    await page.selectOption("#maxq", value);
    now = await screen();
    ok(`and asked for ${value.toUpperCase()} it names that container instead`,
      argsOf(now.cmd).includes(`-x --audio-format ${format}`)
        && !/--audio-quality/.test(now.cmd), argsOf(now.cmd)[2]);
  }
  await page.selectOption("#maxq", "best");
}

/* The bottom tier is the opposite: a bitrate on its own would be copied
   across untouched, since YouTube already serves Opus, so it has to force the
   re-encode and then say what the re-encode is for. */
{
  await page.click('.tier[data-tier="min"]');
  for (const rate of ["6K", "12K", "32K"]) {
    await page.selectOption("#minq", rate);
    const now = await screen();
    ok(`the smallest tier at ${rate} is mono, speech mode, and that bitrate`,
      argsOf(now.cmd).includes(`-x --audio-format opus --audio-quality ${rate}`)
        && /-ac 1 -application voip/.test(now.cmd),
      argsOf(now.cmd).slice(2, 4).join(" | "));
  }
  await page.selectOption("#minq", "6K");
}

{
  await page.click('.tier[data-tier="balanced"]');
  const settings = [
    ["mp3:0", "-x --audio-format mp3 --audio-quality 0"],
    ["mp3:2", "-x --audio-format mp3 --audio-quality 2"],
    ["mp3:320K", "-x --audio-format mp3 --audio-quality 320K"],
    ["opus:128K", "-x --audio-format opus --audio-quality 128K"],
  ];
  for (const [value, arg] of settings) {
    await page.selectOption("#balq", value);
    const now = await screen();
    ok(`the balanced box's ${value} is ${arg.replace("-x --audio-format ", "")}`,
      argsOf(now.cmd).includes(arg) && !/-application voip/.test(now.cmd),
      argsOf(now.cmd)[2]);
  }
  await page.selectOption("#balq", "mp3:0");
}

/* --------------------------------------------------------------- the boxes -- */

/* Eight checkboxes, each of which claims one piece of the command. The check
   is that it is one piece: unticking a box takes its own flag out and leaves
   every other argument exactly where it was. A box wired to the wrong flag
   would pass a check that only looked at its own flag. */
{
  /* A box's own argument, and for the one box that swaps an argument rather
     than dropping it, what it swaps it for. */
  const BOXES = [
    ["o-number", "-o ", '-o "%(playlist_title|Downloads)s/%(playlist_index)03d %(title)s.%(ext)s"',
      '-o "%(playlist_title|Downloads)s/%(title)s.%(ext)s"'],
    ["o-meta", "--embed-metadata", "--embed-metadata"],
    ["o-album", "--parse-metadata", '--parse-metadata "playlist_title:%(album)s"'],
    ["o-thumb", "--embed-thumbnail", "--embed-thumbnail"],
    ["o-archive", "--download-archive", '--download-archive "archive.txt"'],
    ["o-slow", "--sleep-requests", "--sleep-requests 1.5 --sleep-interval 2 --max-sleep-interval 6"],
    ["o-continue", "--ignore-errors", "--ignore-errors --no-overwrites"],
  ];
  const whole = argsOf((await screen()).cmd);
  for (const [id, mark, arg, swap] of BOXES) {
    ok(`${id} ticked puts ${mark.trim()} in the command`,
      whole.includes(arg), whole.filter((a) => a.startsWith(mark)).join(" / "));
    await page.uncheck(`#${id}`);
    const without = argsOf((await screen()).cmd);
    const missing = whole.filter((a) => !without.includes(a));
    const added = without.filter((a) => !whole.includes(a));
    ok(`and unticked it changes that one argument and nothing else`,
      missing.length === 1 && missing[0] === arg
        && added.join() === (swap || "")
        && without.length === whole.length - (swap ? 0 : 1),
      `gone: ${missing.join(" / ")} · came: ${added.join(" / ")}`);
    await page.check(`#${id}`);
  }

  await page.check("#o-sponsor");
  const extra = argsOf((await screen()).cmd);
  ok("the one box that starts unticked adds its flag when it is ticked",
    extra.includes("--sponsorblock-remove sponsor,selfpromo")
      && extra.length === whole.length + 1, String(extra.length));
  await page.uncheck("#o-sponsor");
  ok("and the command comes back to exactly what it was",
    argsOf((await screen()).cmd).join("\n") === whole.join("\n"));
}

/* ------------------------------------------------------ the fields beside them -- */

{
  await page.fill("#dest", "/srv/music");
  let now = await screen();
  ok("the folder goes in as -P, quoted",
    argsOf(now.cmd).includes('-P "/srv/music"'), argsOf(now.cmd)[3]);

  await page.fill("#dest", "");
  now = await screen();
  ok("and an empty folder drops -P rather than quoting nothing",
    !/-P /.test(now.cmd), argsOf(now.cmd).slice(0, 4).join(" | "));
  await page.fill("#dest", "D:\\Music");

  await page.fill("#items", "1-20");
  now = await screen();
  ok("a slice of the playlist goes in as --playlist-items",
    argsOf(now.cmd).includes("--playlist-items 1-20"));
  await page.fill("#items", "");

  await page.selectOption("#cookies", "firefox");
  now = await screen();
  ok("and the cookie browser as --cookies-from-browser",
    argsOf(now.cmd).includes("--cookies-from-browser firefox"));
  await page.selectOption("#cookies", "");
  ok("with Not needed leaving it out altogether",
    !/--cookies-from-browser/.test((await screen()).cmd));
}

/* ---------------------------------------------------------- the annotations -- */

/* The page says the table under the command "is generated from the same
   source as the command itself and can never drift out of sync with it". It
   is one `build` call for both, so this checks the claim rather than the
   mechanism: every row is a part that is in the command, in the order the
   command has them, and nothing in the command is left unexplained but
   yt-dlp itself. */
{
  const now = await screen();
  const args = argsOf(now.cmd);
  ok("every annotated row is the head of an argument that is in the command",
    now.why.every(([head]) => args.some((a) => a.split(" ")[0] === head)),
    now.why.map(([h]) => h).filter((h) =>
      !args.some((a) => a.split(" ")[0] === h)).join(", "));
  ok("the rows are in the order the command has them",
    now.why.map(([head]) => head).join("\n")
      === args.map((a) => a.split(" ")[0]).filter((h) => h !== "yt-dlp").join("\n"),
    `${now.why.length} rows for ${args.length} arguments`);
  ok("and every row says something rather than carrying an empty cell",
    now.why.every(([, why]) => why && why.trim().length > 20));
}

/* ---------------------------------------------------------------- the shell -- */

{
  await page.selectOption("#shell", "pwsh");
  let text = (await screen()).cmd;
  ok("PowerShell gets a backtick at each line end and a PS prompt",
    text.startsWith("PS> ") && / `\n/.test(text) && !/ \\\n/.test(text),
    JSON.stringify(text.slice(0, 40)));

  await page.selectOption("#shell", "bash");
  text = (await screen()).cmd;
  ok("bash gets a backslash and a dollar prompt",
    text.startsWith("$ ") && / \\\n/.test(text) && !/ `\n/.test(text),
    JSON.stringify(text.slice(0, 40)));

  /* And the wrapping itself, which is the same arguments either way. The
     button's label is what pressing it would do, so with the command wrapped
     it has to offer One line — it said Wrap lines on a page whose lines were
     already wrapped until a deliberate breakage of the check below showed the
     check could not tell. */
  const wrapped = argsOf(text);
  ok("with the command wrapped, the button offers to flatten it",
    (await page.textContent("#wrap-btn")) === "One line",
    await page.textContent("#wrap-btn"));
  await page.click("#wrap-btn");
  const flat = (await screen()).cmd;
  ok("Wrap lines pressed puts the whole command on one line",
    !/\n/.test(flat.trim())
      && flat.replace(/^\$ /, "").trim() === wrapped.join(" "),
    JSON.stringify(flat.slice(0, 60)));
  ok("and then offers to put it back",
    (await page.textContent("#wrap-btn")) === "Wrap lines",
    await page.textContent("#wrap-btn"));

  /* Copy is the page's whole point, so what lands on the clipboard is worth
     reading back: the arguments, no prompt, and the continuation character of
     whichever shell is selected. */
  await page.click("#wrap-btn");
  ok("and comes back round to offering One line, rather than sticking",
    (await page.textContent("#wrap-btn")) === "One line"
      && /\n/.test((await screen()).cmd), await page.textContent("#wrap-btn"));

  await page.click("#copy-btn");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  ok("the Copy button puts the command on the clipboard without the prompt",
    copied.startsWith("yt-dlp \\\n") && argsOf(copied).join("\n") === wrapped.join("\n"),
    JSON.stringify(copied.slice(0, 40)));
  await page.selectOption("#shell", "pwsh");
  await page.click("#copy-btn");
  const again = await page.evaluate(() => navigator.clipboard.readText());
  ok("and copies the continuation character of the shell that is selected",
    again.startsWith("yt-dlp `\n") && !again.includes("\\\n"),
    JSON.stringify(again.slice(0, 40)));
}

/* ------------------------------------------------------------- the estimate -- */

/* Bitrate times runtime, which is all anybody can say before the files exist,
   but it is arithmetic and so it either adds up or it does not. The figures
   are read off the screen and compared with the multiplication done here. */
{
  const RATES = { "Highest quality": 160, Balanced: 245, "Smallest file": 6 };

  await page.fill("#tracks", "25");
  await page.fill("#avglen", "4:00");
  let now = await screen();
  ok("25 tracks of four minutes is a hundred minutes of audio",
    now.total === "1 h 40 m of audio", now.total);
  for (const row of now.rows) {
    const want = RATES[row.name] * 1000 * 6000 / 8;
    const got = bytesOf(row.size);
    ok(`${row.name} at ${RATES[row.name]} kbps over that comes to ${row.size}`,
      got !== null && Math.abs(got - want) / want < 0.01,
      `${row.size} is ${got} bytes, not ${want}`);
  }

  /* And each row's size against the rate printed in that same row, which is
     not the check above said twice: the label and the figure are worked out
     separately, so one can be right beside the other being wrong. A breakage
     that changed only the figure left 1411 kbps sitting next to a size worked
     out at 160, and nothing here noticed until this went in. */
  const follows = (row, seconds) => {
    const said = /^([\d.]+) kbps/.exec(row.rate);
    if (!said) return false;
    const want = Number(said[1]) * 1000 * seconds / 8;
    return Math.abs(bytesOf(row.size) - want) / want < 0.01;
  };
  ok("and every row's size is the rate printed beside it times the runtime",
    now.rows.every((r) => follows(r, 6000)),
    now.rows.map((r) => `${r.rate} -> ${r.size}`).join(" | "));

  /* The three shapes the length field takes, each of which has to mean the
     same number of seconds as the one before it. */
  /* Four shapes, and `120:30` is not the same shape as `4:30`: the page's
     own pattern matches one to two digits of minutes in its first branch and
     has a second branch for a longer count, which nothing here reached until
     a deliberate breakage of that second branch went unnoticed. */
  for (const [typed, minutes] of [["4:00", 4], ["1:04:00", 64], ["4.5", 4.5],
                                  ["0:30", 0.5], ["120:30", 120.5]]) {
    await page.fill("#avglen", typed);
    now = await screen();
    const want = 10 * minutes * 60;
    await page.fill("#tracks", "10");
    now = await screen();
    const hours = Math.floor(want / 3600);
    const mins = Math.round((want % 3600) / 60);
    ok(`a length written ${typed} is ${minutes} minutes a track`,
      now.total === (hours ? `${hours} h ${String(mins).padStart(2, "0")} m of audio`
                           : `${mins} m of audio`),
      `${typed} gave ${now.total}, wanted ${want} seconds`);
  }

  await page.fill("#avglen", "half an hour");
  now = await screen();
  ok("a length the page cannot read falls back to four minutes and says so",
    now.lengthMarked && now.total === "40 m of audio", now.total);
  await page.fill("#avglen", "4:00");
  now = await screen();
  ok("and the mark comes off when it can read it again", !now.lengthMarked);

  /* The count is clamped rather than refused, so the clamp is what is
     checked: ten thousand tracks is a real playlist, a million is a typo. */
  await page.fill("#tracks", "20000");
  const most = await screen();
  await page.fill("#tracks", "999999");
  const past = await screen();
  ok("a track count past the field's own ceiling is held at it",
    past.total === most.total && past.total === "1333 h 20 m of audio",
    `${past.total} vs ${most.total}`);
  await page.fill("#tracks", "0");
  ok("and a count of none is held at one",
    (await screen()).total === "4 m of audio", (await screen()).total);

  /* The top tier's rate is the one that moves, because a lossless wrapper
     round a lossy stream is several times the size of the stream. */
  await page.fill("#tracks", "25");
  /* A card's box is only on screen while that card is pressed, so this is the
     one setting the suite has to go and press a card to reach. */
  await page.click('.tier[data-tier="max"]');
  await page.selectOption("#maxq", "wav");
  now = await screen();
  ok("asked for WAV, the top tier's estimate is uncompressed PCM",
    /1411 kbps/.test(now.rows[0].rate)
      && Math.abs(bytesOf(now.rows[0].size) - 1411 * 1000 * 6000 / 8)
         / (1411 * 1000 * 6000 / 8) < 0.01,
    `${now.rows[0].rate} · ${now.rows[0].size}`);

  /* And it stays that rate once another card is pressed, which is the point
     of the table: it is three answers to compare, not one answer for the tier
     that happens to be chosen. */
  await page.click('.tier[data-tier="balanced"]');
  now = await screen();
  ok("and keeps it once another tier is chosen, so the three can be compared",
    /1411 kbps/.test(now.rows[0].rate) && now.rows[1].name === "Balanced"
      && now.rows.every((r) => follows(r, 6000)),
    now.rows.map((r) => `${r.rate} -> ${r.size}`).join(" | "));

  await page.click('.tier[data-tier="max"]');
  await page.selectOption("#maxq", "best");
  await page.click('.tier[data-tier="balanced"]');
  now = await screen();
  ok("back as served it is the Opus stream's own rate",
    /160 kbps/.test(now.rows[0].rate), now.rows[0].rate);
}

/* ------------------------------------------------------------------------- */

ok("nothing threw along the way", errs.length === 0, errs.join(" | "));

await browser.close();
process.exit(done());
