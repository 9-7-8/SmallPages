import { chromium, CHROMIUM_BIN, WORK, need } from './lib/env.mjs';
need('anki/deck.apkg');
import fs from 'node:fs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

// minimal CSV reader for checking what the page wrote
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  row.push(cell); rows.push(row);
  while (rows.length && rows[rows.length-1].every(v => !v.trim())) rows.pop();
  return rows;
}

const page = await browser.newPage({ viewport: { width: 1250, height: 1500 }, acceptDownloads: true });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:8099/quiz-converter.html');
await page.setInputFiles('#fileInput', SCR + '/anki/deck.apkg');
await page.waitForFunction(() => /notes from|Couldn/.test(document.getElementById('status').textContent), null, { timeout: 120000 });

const picked = await page.evaluate(() => {
  const names = [...document.querySelectorAll('#qSel option')].map(o => o.textContent);
  return { q: names[+document.getElementById('qSel').value], a: names[+document.getElementById('aSel').value] };
});
ok('auto-pick skips the numeric Frequency column', /Word/.test(picked.q) && /Meaning/.test(picked.a), JSON.stringify(picked));

await page.fill('#limit', '400');
await page.click('#buildBtn');
await page.waitForFunction(() => /questions? with/.test(document.getElementById('buildTally').textContent), null, { timeout: 60000 });

// pull the built set out so the files can be checked against it
const truth = await page.evaluate(() => built.map(b => ({ q: b.q, a: b.a, wrong: b.wrong })));
ok('400 built', truth.length === 400, truth.length);
ok('no wrong answer equals its right one', truth.every(t => !t.wrong.includes(t.a)), '');
ok('no duplicate wrong answers within a question', truth.every(t => new Set(t.wrong).size === t.wrong.length), '');
ok('every question got 3 wrong answers', truth.every(t => t.wrong.length === 3), truth.filter(t=>t.wrong.length!==3).length + ' short');

const grab = async (index) => {
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.$$eval('.out button', (bs, i) => bs[i].click(), index);
  const got = await dl;
  const p = SCR + '/v-' + index + '.' + got.suggestedFilename().split('.').pop();
  await got.saveAs(p);
  return fs.readFileSync(p, 'utf8');
};

// Blooket: the number in Correct Answer(s) must point at the right option
const blooket = parseCsv(await grab(0));
let bad = 0;
for (let i = 1; i < blooket.length; i++) {
  const r = blooket[i];
  const options = [r[2], r[3], r[4], r[5]];
  const n = Number(r[7]);
  if (options[n - 1] !== truth[i-1].a) bad++;
  if (r[1] !== truth[i-1].q) bad++;
}
ok('Blooket: correct position points at the answer, all 400', bad === 0, bad + ' wrong');
ok('Blooket: header is the documented one', blooket[0][7] === 'Correct Answer(s)', blooket[0].join('|'));

// Wayground
const way = parseCsv(await grab(1));
bad = 0;
for (let i = 1; i < way.length; i++) {
  const r = way[i];
  const options = [r[2], r[3], r[4], r[5], r[6]];
  if (options[Number(r[7]) - 1] !== truth[i-1].a) bad++;
  if (r[1] !== 'Multiple Choice') bad++;
}
ok('Wayground: correct position points at the answer, all 400', bad === 0, bad + ' wrong');

// Gimkit
const gim = parseCsv(await grab(2));
bad = 0;
for (let i = 1; i < gim.length; i++) {
  if (gim[i][1] !== truth[i-1].a || gim[i][0] !== truth[i-1].q) bad++;
  const wrong = [gim[i][2], gim[i][3], gim[i][4]].filter(Boolean);
  if (wrong.some(w => w === truth[i-1].a)) bad++;
}
ok('Gimkit: answer and decoys in their own columns, all 400', bad === 0, bad + ' wrong');

// Quizlet / Anki pairs
const quiz = (await grab(3)).trimEnd().split('\n');
ok('Quizlet: one tab-separated pair per line', quiz.length === 400 && quiz.every(l => l.split('\t').length === 2), quiz.length);
const anki = (await grab(4)).trimEnd().split('\n');
ok('Anki: directives then 400 pairs', anki[0] === '#separator:tab' && anki[1] === '#html:false' && anki.length === 402, anki.length);
ok('Anki: no stray tabs inside a field', anki.slice(2).every(l => l.split('\t').length === 2), '');

// ---- round trip: feed Blooket's own CSV back in ----
fs.writeFileSync(SCR + '/round.csv', fs.readFileSync(SCR + '/v-0.csv'));
await page.setInputFiles('#fileInput', SCR + '/round.csv');
await page.waitForTimeout(1200);
const back = await page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  tally: document.getElementById('tally').textContent,
  first: [...document.querySelectorAll('tbody tr')][0] ?
    [...document.querySelectorAll('tbody tr')[0].children].map(td => td.textContent.trim()) : null,
}));
ok('Blooket CSV is recognised on the way back in', /read as Blooket/.test(back.status), back.status);
ok('round trip keeps all 400 rows', /400 usable rows/.test(back.tally), back.tally);
ok('round trip keeps the question text', back.first && back.first[0] === truth[0].q, JSON.stringify(back.first));

// ---- a pasted Quizlet-style set ----
await page.fill('#pasteBox', 'gato\tcat\nperro\tdog\ncasa\thouse\nlibro\tbook\nmesa\ttable');
await page.click('#pasteBtn');
await page.waitForTimeout(600);
const pasted = await page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  tally: document.getElementById('tally').textContent,
}));
ok('pasted tab pairs read without a header', /5 rows of tab separated/.test(pasted.status), pasted.status);
ok('all 5 pasted rows usable', /5 usable rows/.test(pasted.tally), pasted.tally);
ok('header switch offered for pasted rows', await page.isVisible('#headerCheck'), '');
ok('header switch left off for headerless paste', !(await page.isChecked('#hasHeader')), '');
await page.selectOption('#wrongCount', '2');
await page.click('#buildBtn');
await page.waitForTimeout(500);
const small = await page.evaluate(() => built.map(b => b.wrong.length));
ok('a tiny set still fills its decoys', small.every(n => n === 2), JSON.stringify(small));

if (errs.length) console.log('ERRORS: ' + errs.join(' | '));
const browser2 = browser;

// a labelled CSV must still have its header taken as names
const page2 = await browser2.newPage({ acceptDownloads: true });
await page2.goto('http://127.0.0.1:8099/quiz-converter.html');
fs.writeFileSync(SCR + '/labelled.csv', 'Term,Definition,Note\ngato,cat,a\nperro,dog,b\ncasa,house,c\n');
await page2.setInputFiles('#fileInput', SCR + '/labelled.csv');
await page2.waitForTimeout(800);
const lab = await page2.evaluate(() => ({
  checked: document.getElementById('hasHeader').checked,
  fields: [...document.querySelectorAll('#qSel option')].map(o => o.textContent),
  tally: document.getElementById('tally').textContent,
}));
ok('a labelled CSV is detected as having a header', lab.checked, JSON.stringify(lab));
ok('its column names are used', /Term/.test(lab.fields[0]) && /Definition/.test(lab.fields[1]), lab.fields.join('|'));
ok('3 data rows, header not counted', /3 usable rows/.test(lab.tally), lab.tally);

// and flipping the switch puts the header row back as data
await page2.uncheck('#hasHeader');
await page2.waitForTimeout(400);
const flipped = await page2.evaluate(() => document.getElementById('tally').textContent);
ok('turning the switch off recovers the row', /4 usable rows/.test(flipped), flipped);
await browser2.close();
