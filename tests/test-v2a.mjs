import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const frameCountWebm = () => {
  try { return Number(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0',WORK + '/out.webm']).toString().trim()); }
  catch { return -1; }
};
const SCR = WORK + '';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1400 }, acceptDownloads: true });
const errs = [];
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
const probe = (f, ...a) => execFileSync('ffprobe', ['-v','error',...a,'-of','default=nw=1',f]).toString().trim();

await page.goto('http://127.0.0.1:8099/video-to-animation.html');
await page.waitForTimeout(400);
ok('gifenc loaded as a plain script', await page.evaluate(() => typeof gifenc?.GIFEncoder === 'function'), '');
ok('webm-muxer loaded as a plain script', await page.evaluate(() => typeof WebMMuxer?.Muxer === 'function'), '');

await page.setInputFiles('#fileInput', SCR + '/clip.webm');
await page.waitForFunction(() => /640 × 360/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
ok('video opened, size read', /640 × 360, 4.0s/.test(await page.textContent('#status')), await page.textContent('#status'));

// a short clip so the tests are quick
await page.fill('#startIn', '0.5');
await page.fill('#endIn', '2.5');
await page.fill('#fpsIn', '10');
await page.fill('#widthIn', '320');
await page.locator('#widthIn').dispatchEvent('input');
await page.waitForTimeout(200);
ok('clip maths reported', /2\.0s at 10\/s → 20 frames, 320 × 180/.test(await page.textContent('#clipTally')), await page.textContent('#clipTally'));

const make = async (format, name, { cap = false, mb = 10 } = {}) => {
  await page.selectOption('#formatSel', format);
  if (cap) { await page.check('#capOn'); await page.fill('#capMb', String(mb)); }
  else await page.uncheck('#capOn');
  await page.click('#makeBtn');
  await page.waitForFunction(() => !document.getElementById('saveBtn').disabled
    || /Couldn/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
  const bad = await page.textContent('#status');
  if (/Couldn/.test(bad)) return { error: bad };
  const dl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#saveBtn');
  const p = `${SCR}/${name}`;
  await (await dl).saveAs(p);
  return { path: p, tally: await page.textContent('#outTally'), size: fs.statSync(p).size };
};

for (const [format, name] of [['gif','out.gif'],['webp','out.webp'],['apng','out.png'],['webm','out.webm']]) {
  const r = await make(format, name);
  if (r.error) { ok(`${format} encodes`, false, r.error); continue; }
  ok(`${format} encodes`, r.size > 500, r.size);
  console.log(`      ${name}  ${(r.size/1024).toFixed(0)} KB  |  ${r.tally.split('·').slice(0,3).join('·').trim()}`);
}

// --- every output must really be animated, and really be 20 frames ---
console.log('--- what ffprobe makes of them ---');
for (const [f, want] of [['out.gif','gif'],['out.webp','webp'],['out.png','apng'],['out.webm','vp9']]) {
  try {
    const codec = probe(`${SCR}/${f}`, '-select_streams','v:0','-show_entries','stream=codec_name,width,height,nb_frames');
    console.log(`      ${f}: ${codec.replace(/\n/g,' ')}`);
  } catch (e) { console.log(`      ${f}: ffprobe said ${e.message.split('\n')[0]}`); }
}
// ffmpeg 6.1 cannot demux animated WebP — it fails on its own output — so the
// animated images are counted with the browser's own ImageDecoder instead.
const decoded = await page.evaluate(async (files) => {
  const out = {};
  for (const [name, mime, b64] of files) {
    try {
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dec = new ImageDecoder({ data: u8, type: mime });
      await dec.tracks.ready;
      await dec.completeFramesRange;
      out[name] = { frames: dec.tracks.selectedTrack.frameCount, animated: dec.tracks.selectedTrack.animated };
    } catch (e) { out[name] = { error: e.name + ': ' + e.message }; }
  }
  return out;
}, [
  ['out.gif', 'image/gif', fs.readFileSync(SCR + '/out.gif').toString('base64')],
  ['out.webp', 'image/webp', fs.readFileSync(SCR + '/out.webp').toString('base64')],
  ['out.png', 'image/png', fs.readFileSync(SCR + '/out.png').toString('base64')],
]);
for (const [name, r] of Object.entries(decoded)) {
  ok(`${name} decodes as 20 animated frames`, r.frames === 20 && r.animated, JSON.stringify(r));
}
ok('out.webm holds 20 frames', frameCountWebm() === 20, frameCountWebm());

ok('no audio in the webm', !/audio/.test(probe(`${SCR}/out.webm`, '-show_entries','stream=codec_type')), probe(`${SCR}/out.webm`,'-show_entries','stream=codec_type'));

// --- the size cap, which is the whole point of the port ---
const capped = await make('gif', 'capped.gif', { cap: true, mb: 0.06 });
ok('a cap is met', capped.size <= 0.06 * 1024 * 1024, `${(capped.size/1024).toFixed(0)} KB`);
ok('the cap actually forced a shrink', /→/.test(capped.tally), capped.tally.replace(/\s+/g,' ').trim());
console.log('      attempts:', capped.tally.replace(/\s+/g,' ').trim());
const attempts = (capped.tally.match(/→/g) || []).length + 1;
ok('it got there in a few tries, not a dozen', attempts <= 4, `${attempts} attempts`);

// WebM should be far smaller than GIF for the same clip
const g = fs.statSync(SCR + '/out.gif').size, w = fs.statSync(SCR + '/out.webm').size;
ok('webm is much smaller than gif', w < g / 3, `gif ${(g/1024).toFixed(0)} KB vs webm ${(w/1024).toFixed(0)} KB`);

console.log(errs.length ? 'CONSOLE ERRORS: ' + errs.join(' | ') : 'no console errors');
await page.screenshot({ path: SCR + '/v2a-wide.png', fullPage: true });
await browser.close();
