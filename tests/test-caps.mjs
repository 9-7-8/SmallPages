import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
const SCR = WORK + '';
const CAPS = SCR + '/caps';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1400 }, acceptDownloads: true });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto('http://127.0.0.1:8099/captions-to-transcript.html');
await page.waitForTimeout(300);

const load = async (file) => {
  await page.setInputFiles('#fileInput', `${CAPS}/${file}`);
  await page.waitForFunction(() => /captions read|Couldn/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  return page.textContent('#status');
};

// ---- the rolling repetition, which is the whole point ----
await load('auto.vtt');
let s = await page.evaluate(() => ({
  cues: cues.length,
  out: document.getElementById('outText').value,
  tally: document.getElementById('tally').textContent,
}));
ok('automatic VTT read', s.cues === 5, s.cues);
ok('inline <c> timing tags stripped', !/<c>|<\/c>|00:00:0\d\.\d{3}>/.test(s.out), JSON.stringify(s.out.slice(0,90)));
const words = s.out.replace(/\[[^\]]*\]/g,' ').trim().split(/\s+/);
ok('nothing is said twice', new Set(['so the first thing','you want to do','is open the file'].map(p=>
  (s.out.match(new RegExp(p.replace(/ /g,'\\s+'),'g'))||[]).length)).size === 1
  && (s.out.match(/so the first thing/g)||[]).length === 1, JSON.stringify(s.out));
ok('the real text all survives', /so the first thing/.test(s.out) && /you want to do/.test(s.out)
  && /is open the file/.test(s.out) && /and that is all there is/.test(s.out), JSON.stringify(s.out));
ok('the repetition is counted', /repeated words taken out/.test(s.tally), s.tally.replace(/\s+/g,' ').trim());
console.log('      transcript:', JSON.stringify(s.out.trim()));
console.log('      tally:', s.tally.replace(/\s+/g,' ').trim());

// with dedupe off, the stutter must come back — proving it is the switch doing it
await page.uncheck('#dedupe');
await page.waitForTimeout(250);
const stutter = await page.evaluate(() => document.getElementById('outText').value);
ok('turning it off brings the repetition back', (stutter.match(/so the first thing/g)||[]).length === 2,
   (stutter.match(/so the first thing/g)||[]).length);
await page.check('#dedupe');
await page.waitForTimeout(250);

// ---- the silence gap makes a paragraph ----
const paras = await page.evaluate(() => document.getElementById('outText').value.split(/\n\n+/).length);
ok('a three second silence starts a new paragraph', paras === 2, paras);

// ---- sound annotations ----
await page.check('#dropSounds');
await page.waitForTimeout(250);
ok('[Music] can be dropped', !/\[Music\]/.test(await page.inputValue('#outText')), await page.inputValue('#outText'));
await page.uncheck('#dropSounds');

// ---- timestamps ----
await page.selectOption('#stampSel', 'block');
await page.waitForTimeout(250);
ok('paragraph timestamps appear', /^\[0:00\]/m.test(await page.inputValue('#outText')), (await page.inputValue('#outText')).slice(0,40));
await page.selectOption('#stampSel', 'cue');
await page.waitForTimeout(250);
const perCue = (await page.inputValue('#outText')).trim().split('\n').length;
ok('per-caption timestamps give a line each of the five cues', perCue === 5, perCue);
await page.selectOption('#stampSel', 'none');
await page.selectOption('#groupSel', 'paragraph');

// ---- every input format ----
for (const [file, want] of [['plain.srt', 'A plain subtitle file'], ['track.json3', 'hello from json3'],
                            ['track.srv1', 'srv one line'], ['track.srv3', 'srv three line'],
                            ['track.ttml', 'ttml line one']]) {
  await load(file);
  const r = await page.evaluate(() => ({ n: cues.length, out: document.getElementById('outText').value,
    first: cues[0].start, last: cues[cues.length-1].end }));
  ok(`${file} parses`, r.n === 2 && r.out.includes(want), `${r.n} cues, ${JSON.stringify(r.out.slice(0,60))}`);
  ok(`${file} keeps its timings`, r.first > 0 && r.last > r.first, `${r.first} → ${r.last}`);
}

// json3's own rolling repeat must be caught too
await load('track.json3');
ok('json3 repetition also removed', (await page.inputValue('#outText')).match(/hello from json3/g).length === 1,
   await page.inputValue('#outText'));

// ---- outputs ----
await load('auto.vtt');
const grab = async (sel, name) => {
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.click(sel);
  const p = `${SCR}/${name}`;
  await (await dl).saveAs(p);
  return fs.readFileSync(p, 'utf8');
};
const srt = await grab('#srtBtn', 'out.srt');
ok('SRT is numbered and comma-timed', /^1\r?\n00:00:00,320 --> 00:00:02,800/.test(srt), srt.slice(0, 60));
ok('SRT carries the de-duplicated text', !/so the first thing\s*\n?\s*you want/.test(srt) && srt.includes('you want to do'), srt.slice(0,200));
const vtt = await grab('#vttBtn', 'out.vtt');
ok('VTT has its header and dot-timed cues', vtt.startsWith('WEBVTT') && /00:00:00\.320 --> /.test(vtt), vtt.slice(0, 50));
const txt = await grab('#txtBtn', 'out.txt');
ok('TXT saves the transcript', txt.includes('and that is all there is'), txt.slice(0, 80));

// ---- the yt-dlp command ----
const recipeFor = async (link) => {
  await page.fill('#linkIn', link);
  return page.evaluate(() => { showRecipe(document.getElementById('linkIn').value); return document.getElementById('recipeText').textContent; });
};
let cmd = await recipeFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
ok('a watch link becomes a clean command', /watch\?v=dQw4w9WgXcQ"$/m.test(cmd) && !/t=42/.test(cmd), cmd.split('\n')[2]);
cmd = await recipeFor('https://youtu.be/dQw4w9WgXcQ');
ok('a youtu.be link resolves to the same id', /v=dQw4w9WgXcQ/.test(cmd), cmd.split('\n')[2]);
cmd = await recipeFor('https://www.youtube.com/shorts/abc123defgh');
ok('a short resolves too', /v=abc123defgh/.test(cmd), cmd.split('\n')[2]);
cmd = await recipeFor('https://www.youtube.com/playlist?list=PL123');
ok('a playlist becomes a playlist command', /playlist\?list=PL123/.test(cmd), cmd.split('\n')[2]);
await page.fill('#langIn', 'fr');
cmd = await recipeFor('https://youtu.be/dQw4w9WgXcQ');
ok('the language reaches the command', /--sub-langs "fr\.\*"/.test(cmd), cmd.split('\n')[1]);
await page.fill('#langIn', 'en');

// ---- the fetch path fails honestly, and still offers the command ----
await page.fill('#linkIn', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
await page.click('#fetchBtn');
await page.waitForFunction(() => /Couldn't fetch|captions read/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
const after = await page.evaluate(() => ({ status: document.getElementById('status').textContent,
  recipeShown: !document.getElementById('recipe').hidden }));
ok('a blocked fetch says so rather than hanging', /Couldn't fetch them/.test(after.status), after.status.slice(0, 110));
ok('and the command is on screen', after.recipeShown, '');
console.log('      ', after.status.slice(0, 130));

// ---- rubbish in ----
await page.fill('#pasteBox', 'this is not a caption file at all\njust two lines of prose');
await page.click('#pasteBtn');
await page.waitForTimeout(400);
const prose = await page.evaluate(() => ({ status: document.getElementById('status').textContent, out: document.getElementById('outText').value }));
ok('plain prose is taken as a line each rather than refused', /2 captions read/.test(prose.status), prose.status);

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await load('auto.vtt');
await page.screenshot({ path: SCR + '/caps-wide.png', fullPage: true });
await browser.close();
