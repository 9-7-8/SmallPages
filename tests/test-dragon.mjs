import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
const SCR = WORK + '';
const DIR = SCR + '/dragons';
const files = fs.readdirSync(DIR).map(f => `${DIR}/${f}`);
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1400 }, acceptDownloads: true });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));

await page.goto('http://127.0.0.1:8099/dragon-tree.html');
await page.waitForTimeout(300);
await page.setInputFiles('#plainInput', files);
await page.waitForFunction(() => /dragons?,|were saved/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
console.log('     ', await page.textContent('#status'));

// --- parsing ---
const parsed = await page.evaluate(() => [...dragons.values()].map(d =>
  ({ did: d.did, name: d.name, parents: d.parents, sex: d.sex, lineage: d.lineage, colour: d.colour })));
ok('all nine pages parsed', parsed.length === 9, parsed.length);
const by = Object.fromEntries(parsed.map(d => [d.did, d]));
ok('name taken from the title, suffix stripped', by['1001'].name === 'Ashveil', by['1001'].name);
ok('sex read from the profile icon', by['1001'].sex === 'Male' && by['1002'].sex === 'Female', JSON.stringify([by['1001'].sex, by['1002'].sex]));
ok('parents read from the lineage list', JSON.stringify(by['1003'].parents) === '["1001","1002"]', JSON.stringify(by['1003'].parents));
ok('the exalted page parses too', by['1007'] && JSON.stringify(by['1007'].parents) === '["1005","1006"]', JSON.stringify(by['1007']));
ok('exalted sex from data-gender', by['1007'].sex === 'Female', by['1007'].sex);
ok('founders matched to their lineage', by['1001'].lineage === 'Emberline' && by['1002'].lineage === 'Tidewatch', JSON.stringify([by['1001'].lineage, by['1002'].lineage]));
ok('a dragon in no lineage has no colour', by['1004'].colour === null, by['1004'].colour);

// --- colour blending, against the value worked out independently ---
await page.selectOption('#rootSel', '*');
await page.waitForTimeout(400);
const col = await page.evaluate(() => {
  const { parents } = edgesOf();
  const ids = new Set(dragons.keys());
  const levels = levelsFor(ids, parents);
  const c = colourAll(ids, parents, levels);
  return Object.fromEntries([...c]);
});
ok('a child of two lineages gets the LAB midpoint', col['1003'] === '#a1517e', `${col['1003']} (expected #a1517e)`);
ok('one coloured parent passes its colour straight down', col['1005'] === col['1003'], `${col['1005']} vs ${col['1003']}`);
ok('an uncoloured founder stays uncoloured', !col['1004'], col['1004']);
ok('colour keeps running two generations on', col['1007'] === col['1003'], `${col['1007']}`);

// --- levels: every edge must point downward, which was the original's bug ---
const levelCheck = await page.evaluate(() => {
  const { parents, children } = edgesOf();
  const ids = new Set(dragons.keys());
  const levels = levelsFor(ids, parents);
  let bad = 0;
  for (const did of ids) for (const kid of children.get(did)) {
    if (levels.get(kid) <= levels.get(did)) bad++;
  }
  return { bad, levels: Object.fromEntries([...levels]), rows: new Set([...levels.values()]).size };
});
ok('every parent sits above every one of its children', levelCheck.bad === 0, `${levelCheck.bad} edges point the wrong way`);
ok('four generations found', levelCheck.rows === 4, JSON.stringify(levelCheck.levels));
console.log('      levels:', JSON.stringify(levelCheck.levels));

// --- the drawing ---
const svg = await page.evaluate(() => ({
  text: lastSvg,
  images: (lastSvg.match(/<image /g) || []).length,
  boxes: (lastSvg.match(/<rect [^>]*rx="3"/g) || []).length,
  eggs: (lastSvg.match(/<ellipse /g) || []).length,
  paths: (lastSvg.match(/<path /g) || []).length,
  w: Number(/width="(\d+)"/.exec(lastSvg)[1]),
  h: Number(/height="(\d+)"/.exec(lastSvg)[1]),
}));
ok('eight sprites drawn, the one without stays blank', svg.images === 8, svg.images);
ok('a name box for every dragon', svg.boxes === 9, svg.boxes);
ok('four founders marked', svg.eggs === 4, svg.eggs);
ok('nine parent-child lines', svg.paths === 9, svg.paths);
ok('the drawing is sized to the tree, not fixed', svg.w < 1600 && svg.h < 1200 && svg.w > 200, `${svg.w} × ${svg.h}`);
console.log('      svg', svg.w, '×', svg.h, '| tally:', (await page.textContent('#tally')).replace(/\s+/g,' ').trim());

// --- one tree per youngest dragon ---
const roots = await page.evaluate(() => [...document.querySelectorAll('#rootSel option')].map(o => o.textContent));
ok('a tree offered for each childless dragon', roots.length === 3 && roots.some(r=>/Mirefeather/.test(r)) && roots.some(r=>/Dunnock/.test(r)), JSON.stringify(roots));

// --- pruning ---
await page.check('#pruneGrey');
await page.waitForTimeout(400);
const pruned = await page.evaluate(() => ({ tally: document.getElementById('tally').textContent, svg: lastSvg }));
ok('pruning drops the branch that never meets a lineage', /2 dropped as uncoloured/.test(pruned.tally), pruned.tally.replace(/\s+/g,' ').trim());
ok('pruning keeps everyone a lineage reaches', (pruned.svg.match(/rx="3"/g) || []).length === 7, (pruned.svg.match(/rx="3"/g) || []).length);
await page.uncheck('#pruneGrey');
await page.waitForTimeout(300);

// --- saves ---
const grab = async (sel, name) => {
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click(sel);
  const p = `${SCR}/${name}`;
  await (await dl).saveAs(p);
  return p;
};
const svgPath = await grab('#svgBtn', 'tree.svg');
const svgText = fs.readFileSync(svgPath, 'utf8');
ok('svg saves', svgText.startsWith('<svg'), svgText.slice(0, 40));
ok('sprites are embedded in the svg, not linked', svgText.includes('data:image/png;base64'), '');
ok('no file:// or http refs in the svg', !/href="(?!data:)/.test(svgText), (svgText.match(/href="[^"]{0,30}/g)||[]).slice(0,2).join(' '));
const pngPath = await grab('#pngBtn', 'tree.png');
ok('png saves', fs.statSync(pngPath).size > 2000, fs.statSync(pngPath).size);
const csvPath = await grab('#csvBtn', 'dragons.csv');
const csv = fs.readFileSync(csvPath, 'utf8');
ok('csv has a row per dragon', csv.trim().split('\n').length === 10, csv.trim().split('\n').length);
ok('csv carries the blended colour', csv.includes('#a1517e'), csv.split('\n')[3]);

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await page.screenshot({ path: SCR + '/dragon-wide.png', fullPage: true });
await page.locator('.stage').screenshot({ path: SCR + '/dragon-tree-shot.png' });
await browser.close();
