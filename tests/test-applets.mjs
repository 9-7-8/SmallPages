/* The bookmarklets page, and the bookmarklet it carries.

   Half of this is about the page: that what the drag button holds is exactly
   the source printed underneath it, that a click on it does not run the thing
   here, and that the two rules an applet source has to keep are kept.

   The other half runs the applet. A bookmarklet that compiles is not a
   bookmarklet that works, and the only way to find out is to put it on a page
   shaped like the one it is for and read what comes out the other end — so
   the suite serves its own YouTube watch page, with a transcript and three
   comments on it, runs the exported bookmarklet against it, catches the
   download and reads the Markdown. Nothing leaves the machine: the request
   for youtube.com is fulfilled locally. */
import { chromium, CHROMIUM_BIN } from './lib/env.mjs';

const URL = 'http://127.0.0.1:8099/bookmarklets.html';
const VIDEO = 'STUBVIDEO1';
const WATCH = `https://www.youtube.com/watch?v=${VIDEO}`;

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1100 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => {
  if (c) pass++; else fail++;
  console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
};

await page.goto(URL);
await page.waitForTimeout(250);

/* --------------------------------------------------------------- the page -- */

const applets = await page.evaluate(() => APPLETS.map(a => {
  const block = document.querySelector(`.applet[data-applet="${a.id}"]`);
  const link = block?.querySelector('.grab');
  const href = link?.getAttribute('href') || '';
  const source = document.getElementById(`src-${a.id}`)?.textContent.trim() ?? null;
  return {
    id: a.id, name: a.name, what: a.what,
    steps: a.steps?.length || 0, caveats: a.caveats?.length || 0,
    href, source,
    shown: block?.querySelector('pre.src')?.textContent ?? null,
    heading: block?.querySelector('h3')?.textContent ?? null,
    facts: block?.querySelector('.facts')?.textContent ?? '',
  };
}));

ok('the page carries at least one applet', applets.length >= 1, applets.length);

for (const a of applets) {
  ok(`${a.id} has a source block`, typeof a.source === 'string' && a.source.length > 0, a.source);
  ok(`${a.id} is a javascript: URL`, a.href.startsWith('javascript:'), a.href.slice(0, 40));

  /* The claim the whole page rests on: what you drag is what is printed. A
     bookmarklet you cannot read is one you have to take on trust. */
  const decoded = decodeURIComponent(a.href.slice('javascript:'.length));
  ok(`${a.id} decodes back to its own source, exactly`, decoded === a.source,
    `${decoded.length} characters out against ${a.source?.length} in`);
  ok(`${a.id} prints the same source on the page`, a.shown === a.source,
    `${a.shown?.length} shown against ${a.source?.length} encoded`);

  /* Two rules an applet source has to keep. The first is this page's: the
     block holding it is raw text and a closing script tag would end it early.
     The second is YouTube's, and GitHub's, and everybody's: a site with
     require-trusted-types-for 'script' refuses the assignment outright, and a
     panel built that way never appears. */
  ok(`${a.id} has no closing script tag in it`, !/<\/script/i.test(a.source), 'found one');
  ok(`${a.id} never assigns innerHTML`, !/innerHTML|outerHTML|insertAdjacentHTML/.test(a.source),
    (a.source.match(/.{0,40}(innerHTML|outerHTML|insertAdjacentHTML).{0,40}/) || [])[0]);

  ok(`${a.id} compiles`, await page.evaluate((s) => {
    try { new Function(s); return true; } catch { return false; }
  }, a.source), 'it does not');
  ok(`${a.id} says what it is and how to use it`,
    a.what.length > 40 && a.steps >= 3 && a.caveats >= 1,
    `${a.what.length} characters, ${a.steps} steps, ${a.caveats} caveats`);
  ok(`${a.id} prints its own size`, /source \d/.test(a.facts) && /encoded \d/.test(a.facts), a.facts);
}

/* A click on the drag button runs the applet against this page, which is
   never what was meant, so it is caught. */
const before = page.url();
await page.click('.applet .grab');
await page.waitForTimeout(200);
ok('clicking the drag button goes nowhere', page.url() === before, page.url());
ok('and says to drag it instead',
  /drag/i.test(await page.locator('.applet .said').textContent()),
  await page.locator('.applet .said').textContent());

/* ---------------------------------------------------------- make your own -- */

await page.fill('#ownCode', "alert(document.images.length + ' images');");
await page.fill('#ownName', 'Count images');
await page.waitForTimeout(200);
const own = await page.evaluate(() => ({
  href: document.getElementById('ownGrab').getAttribute('href'),
  label: document.getElementById('ownGrab').textContent,
  hidden: document.getElementById('ownMade').classList.contains('off'),
  facts: document.getElementById('ownFacts').textContent,
  said: document.getElementById('ownSaid').textContent,
}));
ok('a pasted program becomes a bookmarklet',
  !own.hidden && own.href.startsWith('javascript:')
  && decodeURIComponent(own.href.slice(11)) === "alert(document.images.length + ' images');",
  JSON.stringify(own.href));
ok('and takes the name you gave it', own.label === 'Count images', own.label);
ok('with nothing wrong to report', own.said === '' && /syntax compiles/.test(own.facts), own.facts);

await page.fill('#ownCode', "alert('unclosed");
await page.waitForTimeout(200);
const broken = await page.evaluate(() => ({
  hidden: document.getElementById('ownMade').classList.contains('off'),
  said: document.getElementById('ownSaid').textContent,
  error: document.getElementById('ownSaid').classList.contains('error'),
}));
ok('a program that will not compile says so', /SyntaxError/.test(broken.said) && broken.error, broken.said);
ok('and is not offered as a bookmarklet', broken.hidden, 'it was offered anyway');

/* The check compiles the paste; it must not run it. An alert here would be
   the page executing something nobody asked it to. */
let ran = false;
page.on('dialog', d => { ran = true; d.dismiss().catch(() => {}); });
await page.fill('#ownCode', "alert('this must not run');");
await page.waitForTimeout(400);
ok('checking a program never runs it', !ran, 'something put a dialog up');

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
ok('no sideways scroll at 390px',
  await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
await page.setViewportSize({ width: 1200, height: 1100 });

ok('no page errors', errs.length === 0, errs.join(' | '));

/* ------------------------------------------------- the applet, actually run -- */

const source = applets.find(a => a.id === 'youtube-markdown').source;

/* Somewhere that is not YouTube. The applet should say so and do nothing
   else, which is the only thing standing between a stray click and a panel
   on a page it cannot read. */
const elsewhere = await ctx.newPage();
let said = '';
elsewhere.on('dialog', async d => { said = d.message(); await d.dismiss(); });
await elsewhere.goto(URL);
await elsewhere.evaluate(source);
await elsewhere.waitForTimeout(300);
ok('run anywhere but a watch page, it says so and stops',
  /watch page/i.test(said) && await elsewhere.locator('#ytmd-auto-close').count() === 0, said);
await elsewhere.close();

/* A watch page of our own: the elements the applet reads, and nothing else.
   The transcript cues are deliberately out of order in the markup, because
   the export claims to sort them by time. */
const CUES = [
  ['0:04', 'This is the first thing anybody says.'],
  ['1:02:13', 'An hour in, and still going.'],
  ['0:31', 'The second cue, half a minute later.'],
  ['10:02', 'Ten minutes in.'],
  ['2:45', 'A cue at two forty-five.'],
  ['1:07', 'Just past a minute.'],
];
const COMMENTS = [
  ['Alice', 'The first comment.\nWith a second line.', '1.2K'],
  ['Bob', 'A shorter one.', '34'],
  ['Carol', 'The last of the three.', null],
];
const STUB = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Stub watch page</title><style>
 body{font:14px system-ui;margin:0;padding:12px}
 ytd-watch-metadata,ytd-transcript-renderer,ytd-transcript-segment-renderer,
 ytd-comments,ytd-comment-thread-renderer,ytd-comment-view-model,ytd-channel-name{display:block}
 #transcript-scroll{max-height:160px;overflow-y:auto;border:1px solid #ccc}
 ytd-transcript-segment-renderer{padding:6px 0}
</style></head><body>
<div id="movie_player"></div>
<ytd-watch-metadata>
  <h1>Larping your way into a stub page</h1>
  <div id="owner"><ytd-channel-name>A Channel Of Some Kind</ytd-channel-name></div>
  <div id="description-inline-expander">A description that the player metadata also carries.</div>
</ytd-watch-metadata>
<ytd-transcript-renderer>
  <div id="transcript-scroll">
  ${CUES.map(([t, body]) => `<ytd-transcript-segment-renderer>`
    + `<span class="segment-timestamp">${t}</span>`
    + `<span class="segment-text">${body}</span>`
    + `</ytd-transcript-segment-renderer>`).join('')}
  </div>
</ytd-transcript-renderer>
<ytd-comments id="comments">
  ${COMMENTS.map(([who, body, likes], i) => `<ytd-comment-thread-renderer><ytd-comment-view-model>`
    + `<span id="author-text">${who}</span>`
    + `<span id="published-time-text"><a href="${WATCH}&amp;lc=COMMENT${i}">3 weeks ago</a></span>`
    + (likes ? `<span id="vote-count-middle">${likes}</span>` : '')
    + `<div id="content-text">${body.replace(/\n/g, '<br>')}</div>`
    + `</ytd-comment-view-model></ytd-comment-thread-renderer>`).join('')}
</ytd-comments>
<div style="height:1400px"></div>
<script>
document.getElementById('movie_player').getPlayerResponse = () => ({
  videoDetails: {
    videoId: '${VIDEO}',
    title: 'Larping your way into a stub page',
    author: 'A Channel Of Some Kind',
    shortDescription: 'A description that the player metadata also carries.',
    channelId: 'UCstubchannel0000000000',
    viewCount: '123456',
    lengthSeconds: '3740',
  },
});
<\/script></body></html>`;

const tube = await ctx.newPage();
const tubeErrs = [];
tube.on('pageerror', e => tubeErrs.push(e.message));
await tube.route('https://www.youtube.com/**', route =>
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: STUB }));
await tube.goto(WATCH);
await tube.waitForTimeout(200);

await tube.evaluate(source);
await tube.waitForTimeout(300);
ok('on a watch page it puts its panel up',
  await tube.locator('#ytmd-auto-close').count() === 1,
  await tube.locator('#ytmd-auto-close').count());
ok('and the panel is the auto-closing one',
  /auto-close/i.test(await tube.locator('#ytmd-auto-close h3').textContent()),
  await tube.locator('#ytmd-auto-close h3').textContent());

await tube.fill('#ytmd-auto-close input[type="number"]', String(COMMENTS.length));
const wait = tube.waitForEvent('download', { timeout: 120000 });
await tube.locator('#ytmd-auto-close button', { hasText: 'Collect' }).first().click();

let file = null;
let md = '';
try {
  file = await wait;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const bit of stream) chunks.push(bit);
  md = Buffer.concat(chunks).toString('utf8');
} catch (err) {
  ok('the applet downloads a Markdown file', false,
    `${err.message}\n--- log ---\n${await tube.locator('#ytmd-auto-close pre').textContent()}`);
}

if (md) {
  ok('the applet downloads a Markdown file', true);
  ok('named after the video, with its id on the end',
    /^Larping your way into a stub page \[STUBVIDEO1\]\.md$/.test(file.suggestedFilename()),
    file.suggestedFilename());

  ok('the title is the heading', md.startsWith('# Larping your way into a stub page\n'),
    md.slice(0, 60));
  ok('the channel, the link and the id are all in it',
    md.includes('- Channel: A Channel Of Some Kind')
    && md.includes(`- Video: ${WATCH}`) && md.includes(`- Video ID: ${VIDEO}`),
    md.slice(0, 400));
  ok('and what the player knew that the page does not show',
    md.includes('- Channel URL: https://www.youtube.com/channel/UCstubchannel0000000000')
    && md.includes('- Views (metadata): 123456') && md.includes('- Duration (seconds): 3740'),
    md.slice(0, 500));
  ok('the description has a section of its own',
    md.includes('## Description\n\nA description that the player metadata also carries.'),
    'it does not');

  /* The comments: all three, in order, each with its author, its date, its
     likes and its link, and the body quoted a line at a time. */
  ok('every comment is there, numbered and in order',
    md.includes(`## Comments (${COMMENTS.length})`)
    && md.indexOf('### 1. Alice') < md.indexOf('### 2. Bob')
    && md.indexOf('### 2. Bob') < md.indexOf('### 3. Carol'),
    md.slice(md.indexOf('## Comments'), md.indexOf('## Comments') + 200));
  ok('with the likes the page displayed',
    md.includes('Likes: 1.2K') && md.includes('Likes: 34'), 'they are not');
  ok('and "Not displayed" where it showed none',
    md.includes('Likes: Not displayed'), 'it claimed a number instead');
  ok('a comment of two lines is quoted on two lines',
    md.includes('> The first comment.\n> With a second line.'),
    JSON.stringify(md.slice(md.indexOf('### 1. Alice'), md.indexOf('### 2. Bob'))));
  ok('each comment carries its own link',
    md.includes(`${WATCH}&lc=COMMENT0`) && md.includes(`${WATCH}&lc=COMMENT2`), 'they do not');

  /* The transcript: every cue, sorted by time rather than by the order they
     sat in the page, and every one linked to the second it is said at. */
  const lines = md.slice(md.indexOf('## Transcript')).split('\n').filter(l => l.startsWith('['));
  ok('every cue is in the transcript', lines.length === CUES.length,
    `${lines.length} of ${CUES.length}:\n${lines.join('\n')}`);
  const order = lines.map(l => l.slice(1, l.indexOf(']')));
  ok('sorted by time, not by the order they were in the page',
    order.join(' ') === '0:04 0:31 1:07 2:45 10:02 1:02:13', order.join(' '));
  ok('each one links to the second it is said at',
    lines[0].includes(`(${WATCH}&t=4s)`) && lines.at(-1).includes(`(${WATCH}&t=3733s)`),
    `${lines[0]}\n${lines.at(-1)}`);
  ok('and carries what was said',
    lines[0].endsWith('This is the first thing anybody says.')
    && lines.at(-1).endsWith('An hour in, and still going.'),
    `${lines[0]}\n${lines.at(-1)}`);

  /* The notes are the point of the exercise: the file says what it does not
     know rather than presenting itself as complete. */
  ok('the export says what it cannot vouch for',
    md.includes('## Export notes')
    && /not independently verified/.test(md.slice(md.indexOf('## Export notes'))),
    md.slice(md.indexOf('## Export notes')));
  ok('and why comment collection stopped',
    /Stop reason: Requested count reached/.test(md), md.slice(md.indexOf('## Export notes')));
}

/* It closes behind itself, which is the whole of the change made to the
   version this page carries. */
await tube.waitForTimeout(2500);
ok('the panel closes itself once the download is away',
  await tube.locator('#ytmd-auto-close').count() === 0,
  'it is still open');
ok('and the applet threw nothing on the way', tubeErrs.length === 0, tubeErrs.join(' | '));

await tube.close();
console.log(`\n${pass} passing, ${fail} failing`);
await browser.close();
process.exit(fail ? 1 : 0);
