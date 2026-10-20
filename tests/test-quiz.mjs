import { chromium, CHROMIUM_BIN, WORK, need } from './lib/env.mjs';
need('anki/deck.apkg');
import fs from 'node:fs';
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1500 }, acceptDownloads: true });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto('http://127.0.0.1:8099/quiz-converter.html');
await page.waitForTimeout(400);

// The real 90 MB deck, handed over as a real File via the picker.
const t0 = Date.now();
await page.setInputFiles('#fileInput', SCR + '/anki/deck.apkg');
await page.waitForFunction(() => /notes from|Couldn/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
console.log('      read the 90 MB package in', Date.now() - t0, 'ms');

const s1 = await page.evaluate(() => ({
  status: document.getElementById('status').textContent,
  types: [...document.querySelectorAll('#typeSel option')].map(o => o.textContent),
  fields: [...document.querySelectorAll('#qSel option')].map(o => o.textContent),
  q: document.getElementById('qSel').value,
  a: document.getElementById('aSel').value,
  tally: document.getElementById('tally').textContent,
}));
ok('read 5004 notes', /5004 notes/.test(s1.status), s1.status);
ok('found both note types', s1.types.length === 2, JSON.stringify(s1.types));
ok('biggest note type first', /Russian Vocabulary — 5000/.test(s1.types[0]), s1.types[0]);
ok('real field names, not Field 1', /Word/.test(s1.fields[1]) && /Meaning/.test(s1.fields[2]), s1.fields.slice(0,4).join(' | '));
ok('21 fields listed', s1.fields.length === 21, s1.fields.length);
console.log('      auto-picked q =', s1.fields[+s1.q], ', a =', s1.fields[+s1.a]);

// map to Word -> Meaning, as the original script did
await page.selectOption('#qSel', '1');
await page.selectOption('#aSel', '2');
await page.waitForTimeout(800);
const s2 = await page.evaluate(() => ({
  tally: document.getElementById('tally').textContent,
  rows: [...document.querySelectorAll('tbody tr')].slice(0, 3).map(tr =>
    [...tr.children].map(td => td.textContent.trim())),
}));
ok('usable rows reported', /\d{4} usable rows/.test(s2.tally), s2.tally);
console.log('      first rows:', JSON.stringify(s2.rows.slice(0, 2)));
ok('media tags stripped', !s2.rows.some(r => r.join(' ').includes('[sound:')), JSON.stringify(s2.rows));

// build with 3 wrong answers
await page.fill('#limit', '400');
const tb = Date.now();
await page.click('#buildBtn');
await page.waitForFunction(() => /questions? with/.test(document.getElementById('buildTally').textContent), null, { timeout: 60000 });
const s3 = await page.evaluate(() => ({
  tally: document.getElementById('buildTally').textContent,
  sample: [...document.querySelectorAll('tbody tr')].slice(0, 4).map(tr =>
    [...tr.children].map(td => td.textContent.trim())),
}));
console.log('      build:', s3.tally, '| wall', Date.now() - tb, 'ms');
ok('400 questions built', /^400 questions with 3 wrong/.test(s3.tally), s3.tally);
ok('wrong answers present', s3.sample.every(r => r[2].length > 0), JSON.stringify(s3.sample[0]));
ok('wrong answers differ from the right one', s3.sample.every(r => !r[2].includes(r[1])), '');
console.log('      e.g.', JSON.stringify(s3.sample[0]));

// every output
const want = ['blooket','wayground','gimkit','quizlet','anki','plain'];
const buttons = await page.$$('.out');
ok('six outputs offered', buttons.length === 6, buttons.length);
for (let i = 0; i < buttons.length; i++) {
  const name = await buttons[i].$eval('.who', e => e.textContent);
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await buttons[i].$eval('button', b => b.click());
  const got = await dl;
  if (!got) { ok(`${name} saves`, false, 'no download'); continue; }
  const file = `${SCR}/q-${want[i]}.${got.suggestedFilename().split('.').pop()}`;
  await got.saveAs(file);
  ok(`${name} saves`, true);
  console.log('        ', got.suggestedFilename(), fs.statSync(file).size, 'bytes');
}

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await page.screenshot({ path: SCR + '/quiz-wide.png', fullPage: true });
await browser.close();
