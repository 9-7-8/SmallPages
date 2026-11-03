/* discord-compressor.html — a file brought under Discord's upload limit.
 *
 * Nearly everything here is checked by reading the file that came out rather
 * than the figure the page printed: the WebMs go back into a <video> and into
 * ffprobe, the pictures are decoded again and measured, the sound is rendered
 * through an OfflineAudioContext and its pitch read off the spectrum, the zip
 * is handed to unzip.html — the repo's own zip reader — and the split parts
 * are concatenated and compared byte for byte with what went in.
 *
 * The fixtures are drawn rather than carried: a PNG and a WAV and two bags of
 * bytes out of Node, an animated GIF out of vendored gifenc, and a video with
 * sound recorded by MediaRecorder in the browser, which is a different code
 * path from the WebCodecs the page uses and so is not the page marking its own
 * homework. The one committed fixture is tests/clip.webm, which was already
 * here for test-v2a.
 *
 * Seven deliberate breakages went through the page afterwards; what each one
 * cost is written down beside the check that caught it, and the two that
 * nothing caught are named at the foot of the file.
 */

import { chromium, CHROMIUM_BIN, WORK, scoring } from './lib/env.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const { ok, done } = scoring();
const SITE = 'http://127.0.0.1:8099';
const PAGE = `${SITE}/discord-compressor.html`;

/* ffprobe is the only thing here that is not the browser, and it is used only
   for what a browser will not tell you: the codec a track really is, and how
   many frames are really in it. A machine without it loses four checks and
   says so rather than passing them by default. */
let HAVE_FFPROBE = true;
const probe = (file, ...args) => {
  try {
    return execFileSync('ffprobe', ['-v', 'error', ...args, '-of', 'default=nw=1', file],
      { encoding: 'utf8' }).trim();
  } catch {
    HAVE_FFPROBE = false;
    return null;
  }
};

/* ------------------------------------------------------------- fixtures -- */

/* Structured rather than flat, and noisy rather than smooth: a flat colour
   encodes to nothing at any quality, so it cannot show a quality setting
   doing anything at all. The noise is from a fixed sequence, not Math.random,
   so two runs are the same run. */
function drawPng(path, w, h) {
  const zlib = require('node:zlib');
  let seed = 20260811;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    let at = y * (1 + w * 3);
    raw[at++] = 0;
    for (let x = 0; x < w; x++) {
      const wave = (Math.sin(x * 0.06) + Math.sin(y * 0.045) + Math.sin((x + y) * 0.03)) * 40;
      raw[at++] = Math.max(0, Math.min(255, Math.round(120 + wave + (next() - 0.5) * 60)));
      raw[at++] = Math.max(0, Math.min(255, Math.round(100 + wave * 0.6 + (next() - 0.5) * 60)));
      raw[at++] = Math.max(0, Math.min(255, Math.round(150 - wave * 0.4 + (next() - 0.5) * 60)));
    }
  }
  const chunk = (tag, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const middle = Buffer.concat([Buffer.from(tag, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(middle) >>> 0 : crc32(middle));
    return Buffer.concat([head, middle, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* A 16-bit WAV, because it is the one sound format whose header is shorter
   than the code to avoid writing it. 440 Hz on the left and 660 on the right,
   so a downmix to mono is something the suite can actually see. */
function drawWav(path, seconds, rate = 48000) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 4);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 660 * i) / rate) * 12000), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path, Buffer.concat([head, data]));
}

const WORKDIR = WORK;
const F = (name) => `${WORKDIR}/${name}`;
const require = (await import('node:module')).createRequire(import.meta.url);

drawPng(F('dc-photo.png'), 1400, 900);
drawWav(F('dc-tone.wav'), 5);
fs.writeFileSync(F('dc-log.txt'), Array.from({ length: 50000 },
  (_, i) => `line ${i}: the quick brown fox jumps over the lazy dog ${i * 7}\n`).join(''));
/* Incompressible on purpose: deflate makes this bigger, which is the case the
   zip's store-instead-of-deflate branch exists for. */
{
  /* xorshift, and the high bits of it. The obvious thing — a linear
     congruential generator's low byte — looks random and is not: the first
     version of this fixture deflated to 2% of itself, which is the opposite
     of what it is here to be. */
  let seed = 0x9e3779b9;
  const bag = Buffer.alloc(900000);
  for (let i = 0; i < bag.length; i++) {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    bag[i] = (seed >>> 19) & 0xff;
  }
  fs.writeFileSync(F('dc-noise.bin'), bag);
}

/* ------------------------------------------------------------- the page -- */

const browser = await chromium.launch({ executablePath: CHROMIUM_BIN,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, acceptDownloads: true });
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errs.push(m.text());
});
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

/* --- the two fixtures only a browser can draw ---------------------------- */

await page.goto(`${SITE}/index.html`);
await page.addScriptTag({ url: '/vendor/gifenc/gifenc.js' });
const drawGif = (kind) => page.evaluate((how) => {
  const { GIFEncoder, quantize, applyPalette } = gifenc;
  const w = 320, h = 240, frames = 24;
  const enc = GIFEncoder();
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  for (let f = 0; f < frames; f++) {
    if (how === 'static') {
      /* Flickering noise: about the hardest thing a video encoder can be
         handed, and the case the second pass exists for. */
      ctx.fillStyle = `hsl(${(f * 15) % 360} 70% 45%)`;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#101010';
      for (let i = 0; i < 300; i++) {
        ctx.fillRect((i * 37 + f * 13) % w, (i * 53 + f * 29) % h, 7, 7);
      }
    } else {
      /* What a GIF actually looks like: flat areas, a few moving things, and
         the same background frame after frame. */
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#1d3f7a');
      sky.addColorStop(1, '#8fc2e8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(0, h - 50, w, 50);
      ctx.fillStyle = '#f5d142';
      ctx.beginPath();
      ctx.arc(30 + (f / frames) * 260, h - 80 - Math.sin((f / frames) * Math.PI) * 70, 26, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(20, 20, 60 + f * 2, 14);
    }
    const data = ctx.getImageData(0, 0, w, h).data;
    const palette = quantize(data, 64);
    /* Uneven on purpose. A GIF's delays are whatever its author set, and a
       page that reads the average back as a frame rate and then filters on
       it drops frames the Keep box said it would keep. A fixture at a steady
       80 ms cannot show that happening. */
    enc.writeFrame(applyPalette(data, palette), w, h,
      { palette, delay: f % 4 === 3 ? 140 : 60 });
  }
  enc.finish();
  return Array.from(enc.bytes());
}, kind);
const gif = await drawGif('smooth');
fs.writeFileSync(F('dc-anim.gif'), Buffer.from(gif));
const staticGif = await drawGif('static');
fs.writeFileSync(F('dc-static.gif'), Buffer.from(staticGif));

/* A real recording, with real sound in it, made by MediaRecorder — which is
   not the encoder the page uses, so this fixture is independent of the thing
   it is about to test. */
const rec = await page.evaluate(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 270;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(25);
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  osc.frequency.value = 440;
  const gain = ac.createGain();
  gain.gain.value = 0.35;
  const dest = ac.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus',
                                               videoBitsPerSecond: 1200000 });
  const bits = [];
  recorder.ondataavailable = (e) => bits.push(e.data);
  const stopped = new Promise((r) => { recorder.onstop = r; });
  recorder.start();
  /* Long enough that 96 kbps of sound alone is over a 0.05 MB limit, which
     is the one way to a budget that cannot be met now that the limit box has
     a floor of its own. Five and a bit seconds; the check below says so. */
  const until = performance.now() + 5200;
  let n = 0;
  await new Promise((settle) => {
    const draw = () => {
      n++;
      ctx.fillStyle = `hsl(${(n * 3) % 360} 75% 48%)`;
      ctx.fillRect(0, 0, 480, 270);
      ctx.fillStyle = '#000';
      for (let i = 0; i < 500; i++) {
        ctx.fillRect((i * 41 + n * 9) % 480, (i * 67 + n * 5) % 270, 8, 8);
      }
      if (performance.now() < until) requestAnimationFrame(draw);
      else { recorder.stop(); settle(); }
    };
    draw();
  });
  await stopped;
  osc.stop();
  ac.close();
  const blob = new Blob(bits, { type: 'video/webm' });
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});
fs.writeFileSync(F('dc-rec.webm'), Buffer.from(rec));
console.log(`      drew dc-anim.gif ${(gif.length / 1024).toFixed(0)} KB,`
  + ` dc-static.gif ${(staticGif.length / 1024).toFixed(0)} KB,`
  + ` dc-rec.webm ${(rec.length / 1024).toFixed(0)} KB`);

/* ---------------------------------------------------------------- harness -- */

await page.goto(PAGE);

/* Setting the same file twice over does not fire `change` a second time —
   Chromium, driven through CDP, compares the list it is given with the one
   that is there. A suite that loads the same fixture twice reads the first
   answer again and passes on it, so the input is emptied in between. */
async function load(name) {
  const before = await page.evaluate(() => window.CLI.file().loads);
  await page.setInputFiles('#fileInput', []);
  await page.setInputFiles('#fileInput', F(name));
  await page.waitForFunction((n) => window.CLI.file().loads > n || window.CLI.file().failed,
    before, { timeout: 90000 });
  return page.evaluate(() => window.CLI.file());
}

const fit = (o) => page.evaluate((opts) => window.CLI.jobs.fit(opts), o);
const fitFails = async (o) => {
  try { await fit(o); return null; } catch (e) { return String(e.message).split('\n')[0]; }
};

async function saveAndRead(name) {
  const waiting = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#saveBtn');
  const got = await waiting;
  const at = F(name);
  await got.saveAs(at);
  return { at, suggested: got.suggestedFilename(), bytes: fs.readFileSync(at) };
}

/* --------------------------------------------------- what it makes of it -- */

console.log('--- what it makes of what it is given ---');

const seen = {};
for (const [name, want] of [['clip.webm', 'video'], ['dc-rec.webm', 'video'],
                            ['dc-photo.png', 'image'], ['dc-anim.gif', 'animation'],
                            ['dc-tone.wav', 'audio'], ['dc-noise.bin', 'file']]) {
  seen[name] = await load(name);
  ok(`${name} is read as ${want}`, seen[name].kind === want,
    `${seen[name].kind} — ${seen[name].note}`);
}
ok('a video that has no sound in it is known to have none',
  seen['clip.webm'].sound === false && seen['dc-rec.webm'].sound === true,
  `clip ${seen['clip.webm'].sound}, recording ${seen['dc-rec.webm'].sound}`);
ok('a video gives up its size and length',
  seen['clip.webm'].width === 640 && seen['clip.webm'].height === 360
  && Math.abs(seen['clip.webm'].duration - 4) < 0.2,
  JSON.stringify(seen['clip.webm']));
/* The frame rate is measured off played frames rather than read, because
   there is nothing to read it from. Breaking the median out of measureFps and
   returning a flat 30 was caught here and nowhere else. */
ok('a video gives up its frame rate, measured', seen['clip.webm'].fps === 15,
  `${seen['clip.webm'].fps} (clip.webm is 15/s, which nothing in the file says out loud)`);
ok('an animation is counted in frames, not assumed',
  seen['dc-anim.gif'].kind === 'animation' && /24 frames/.test(seen['dc-anim.gif'].note),
  seen['dc-anim.gif'].note);
ok('a bag of bytes is not pretended at', seen['dc-noise.bin'].kind === 'file',
  seen['dc-noise.bin'].note);
ok('and it is not mistaken for something the browser merely could not open',
  seen['dc-noise.bin'].unreadable === null, String(seen['dc-noise.bin'].unreadable));

/* A file that says it is a video and will not open is not the same thing as
   a zip, and should not read like one. This Chromium has no H.264, which is
   what makes an MP4 a usable fixture for it; on a build that does have one
   the same bytes would open as a video, so the check is on the sentence the
   page gives for whichever answer it reached. */
fs.writeFileSync(F('dc-fake.mp4'), Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42', 'latin1'),
  Buffer.alloc(4), Buffer.from('mp42isom', 'latin1'), Buffer.alloc(4096, 0x5a),
]));
const fake = await load('dc-fake.mp4');
ok('a video this browser cannot decode says so rather than being filed as a zip',
  fake.kind !== 'file' || fake.unreadable === 'video',
  `${fake.kind}, unreadable: ${fake.unreadable}`);
if (fake.kind === 'file') {
  const why = await page.textContent('#planWhat');
  ok('and the sentence names the decoder rather than the file',
    /will not decode that video/.test(why), why.trim());
}

const limits = await page.evaluate(() => window.CLI.jobs.limits());
ok('the limit presets are offered, 10 MB first',
  limits.presets[0].mb === 10 && limits.presets[0].default
  && limits.presets.map((l) => l.mb).join() === '10,20,50,100,500',
  JSON.stringify(limits.presets.map((l) => l.mb)));
ok('this browser reports its own encoders rather than being told',
  limits.encoders.video && limits.encoders.audio && limits.codecs.length >= 2,
  JSON.stringify(limits.encoders) + ' ' + limits.codecs.map((c) => c.id).join());
/* The probe is the whole fix for the page saying "no video encoder" on a
   phone, so what it asked and what came back is reported rather than
   summarised: it is the one thing worth reading out when a file compresses
   on one machine and not on another. */
ok('and says every codec string it tried and what the answer was',
  limits.asked.length >= 8 && limits.asked.every((a) => typeof a.supported === 'boolean')
    && limits.asked.some((a) => a.tried.startsWith('avc1.')),
  JSON.stringify(limits.asked.map((a) => [a.tried, a.supported])));
ok('the codecs it offers carry the containers they can go in',
  limits.codecs.every((c) => c.containers.length >= 1
    && c.containers.every((b) => b === 'webm' || b === 'mp4')),
  JSON.stringify(limits.codecs.map((c) => [c.id, c.containers])));
ok('exactly one codec is the default, and it is one the browser has',
  limits.codecs.filter((c) => c.default).length === 1,
  JSON.stringify(limits.codecs.map((c) => [c.id, c.default])));

/* ------------------------------------------------------------- the video -- */

console.log('--- a video, and the bitrate ladder under it ---');

await load('clip.webm');
const small = await fit({ limit: 0.08, res: '240', fps: 'keep', codec: 'vp9', sound: '0' });
ok('a video comes out under the limit', small.went.bytes <= small.limit,
  `${small.went.bytes} vs ${small.limit}`);
ok('three bitrates were tried off one read', small.tries.length === 3,
  JSON.stringify(small.tries));
ok('exactly one rung was kept', small.tries.filter((t) => t.kept).length === 1,
  JSON.stringify(small.tries));
/* The whole point of the ladder: not merely that something fitted, but that
   the biggest thing that fitted is what was handed over. Changing the sort in
   fitMoving to take the smallest rung instead was caught here. */
const fitting = small.tries.filter((t) => t.size <= small.limit);
ok('the kept rung is the largest that fits',
  small.tries.find((t) => t.kept).size === Math.max(...fitting.map((t) => t.size)),
  JSON.stringify(small.tries));
ok('the resolution asked for is the resolution written',
  small.video.width === 426 && small.video.height === 240,
  `${small.video.width}×${small.video.height}`);
ok('the sides are even, as every codec here needs',
  small.video.width % 2 === 0 && small.video.height % 2 === 0, '');
ok("the clip's own 15 a second over 4 seconds is 60 frames",
  small.video.frames === 60 && small.video.fps === 15,
  `${small.video.frames} frames at ${small.video.fps}/s`);
ok('dropping the sound leaves no audio track', small.video.audio === null, '');

const saved = await saveAndRead('dc-out.webm');
ok('Save hands over the file the page named', saved.suggested === small.name,
  `${saved.suggested} vs ${small.name}`);
ok('and the bytes on disk are the bytes it counted', saved.bytes.length === small.went.bytes,
  `${saved.bytes.length} vs ${small.went.bytes}`);
ok('what came out is a WebM', saved.bytes.subarray(0, 4).toString('hex') === '1a45dfa3',
  saved.bytes.subarray(0, 4).toString('hex'));

const codecLine = probe(F('dc-out.webm'), '-select_streams', 'v:0',
  '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames');
if (codecLine) {
  ok('ffprobe reads it as VP9 at the size asked for',
    /codec_name=vp9/.test(codecLine) && /width=426/.test(codecLine) && /height=240/.test(codecLine),
    codecLine.replace(/\n/g, ' '));
  ok('and finds the 60 frames in it', /nb_read_frames=60/.test(codecLine),
    codecLine.replace(/\n/g, ' '));
} else {
  console.log('SKIP  no ffprobe here, so the codec and frame count go unchecked');
}

/* The page plays its own output back, which is the only check that the file
   is a file a player will take rather than a plausible pile of bytes. */
const played = await page.evaluate(async (bytes) => {
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
  await new Promise((r, j) => {
    video.addEventListener('loadeddata', r, { once: true });
    video.addEventListener('error', () => j(new Error('would not load')), { once: true });
    setTimeout(() => j(new Error('timed out')), 15000);
  });
  return { w: video.videoWidth, h: video.videoHeight, duration: video.duration };
}, Array.from(saved.bytes));
ok('a browser will play what came out',
  played.w === 426 && played.h === 240 && Math.abs(played.duration - 4) < 0.3,
  JSON.stringify(played));

const slower = await fit({ limit: 0.08, res: '240', fps: '10', codec: 'vp9', sound: '0' });
ok('asking a video for fewer frames a second reads fewer frames',
  slower.video.frames === 40, `${slower.video.frames} at ${slower.video.fps}/s`);
ok('and the clip is still four seconds long',
  Math.abs(slower.video.seconds - 4) < 0.1, slower.video.seconds);

const asVp8 = await fit({ limit: 0.08, res: '240', fps: 'keep', codec: 'vp8', sound: '0', bytes: true });
ok('the codec box is obeyed', asVp8.video.codec === 'vp8', asVp8.video.codec);
fs.writeFileSync(F('dc-vp8.webm'), Buffer.from(asVp8.bytes));
const vp8Line = probe(F('dc-vp8.webm'), '-select_streams', 'v:0', '-show_entries', 'stream=codec_name');
if (vp8Line) {
  ok('and ffprobe agrees it is really VP8', /codec_name=vp8/.test(vp8Line), String(vp8Line));
}

/* The limit box has a floor of its own, and a number under it is a sentence
   rather than a silent clamp — the slider lesson from image-compressor.html,
   applied to a number box. */
/* The sound box is hidden when there is nothing in the file to keep, and a
   hidden box is still a box a job can set. Asking to keep sound that is not
   there has to be a sentence rather than a setting that does nothing. */
const noSound = await fitFails({ limit: 0.08, sound: '64' });
ok('asking to keep sound a silent video has not is refused',
  !!noSound && /no sound in that video/.test(noSound), String(noSound));

const belowFloor = await fitFails({ limit: 0.004 });
ok('a limit under the box\'s own floor is refused, not clamped',
  !!belowFloor && /limit box runs from/.test(belowFloor), String(belowFloor));

/* ------------------------------------------------------- the other box -- */

/* H.264 cannot go in a WebM — the format does not allow it — so a page that
   only ever wrote WebM could only ever offer the codecs WebM takes, and on a
   browser whose encoder writes H.264 and nothing else that is no codecs at
   all. The MP4 half is what makes the page work on a phone, and this is it
   being exercised on a codec this machine does have. */
console.log('--- the same clip in an MP4 ---');

await load('clip.webm');
const inMp4 = await fit({ limit: 0.08, res: '240', fps: 'keep', codec: 'vp9',
                          container: 'mp4', sound: '0', bytes: true });
ok('the container asked for is the container written',
  inMp4.video.container === 'mp4' && /\.mp4$/.test(inMp4.name), inMp4.name);
fs.writeFileSync(F('dc-out.mp4'), Buffer.from(inMp4.bytes));
ok('and the bytes really are an MP4, not a WebM under another name',
  fs.readFileSync(F('dc-out.mp4')).subarray(4, 8).toString('latin1') === 'ftyp',
  fs.readFileSync(F('dc-out.mp4')).subarray(0, 12).toString('latin1'));
const mp4Line = probe(F('dc-out.mp4'), '-count_frames', '-select_streams', 'v:0',
  '-show_entries', 'stream=codec_name,width,height,nb_read_frames',
  '-show_entries', 'format=format_name');
if (mp4Line) {
  ok('ffprobe reads it as an MP4 holding the same 60 frames of VP9',
    /format_name=mov,mp4/.test(mp4Line) && /codec_name=vp9/.test(mp4Line)
      && /nb_read_frames=60/.test(mp4Line),
    mp4Line.replace(/\n/g, ' '));
}
const playedMp4 = await page.evaluate(async (bytes) => {
  const video = document.createElement('video');
  video.muted = true;
  video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }));
  try {
    await new Promise((r, j) => {
      video.addEventListener('loadeddata', r, { once: true });
      video.addEventListener('error', () => j(new Error('would not load')), { once: true });
      setTimeout(() => j(new Error('timed out')), 15000);
    });
    return { w: video.videoWidth, h: video.videoHeight, duration: video.duration };
  } catch (e) { return { error: e.message }; }
}, inMp4.bytes);
ok('and a browser will play it',
  playedMp4.w === 426 && Math.abs(playedMp4.duration - 4) < 0.3, JSON.stringify(playedMp4));

/* The container is not a free choice: it follows what the codec can live in,
   and the page refuses the pairs that do not exist rather than writing a
   file that lies about itself. */
const wrongBox = await fitFails({ codec: 'vp8', container: 'mp4' });
ok('a codec that cannot go in the box asked for is refused, with the real list',
  !!wrongBox && /container here is one of webm/.test(wrongBox), String(wrongBox));

/* ------------------------------------------------- a video with sound in -- */

console.log('--- sound inside a video ---');

await load('dc-rec.webm');
const withSound = await fit({ limit: 0.25, res: 'keep', fps: '10', sound: '64' });
ok('a recording with sound comes out under the limit', withSound.went.bytes <= withSound.limit,
  `${withSound.went.bytes} vs ${withSound.limit}`);
ok('the sound is kept, and costs what it said it would',
  withSound.video.audio && withSound.video.audio.bytes > 1000, JSON.stringify(withSound.video.audio));
/* The sound's own bytes come off the budget as a measured figure rather than
   an estimate, so the video bitrate it asked for plus the sound it already
   had must come to roughly the limit. */
const spent = (withSound.video.asked * withSound.video.seconds) / 8 + withSound.video.audio.bytes;
ok('the budget adds up to the limit it was given',
  Math.abs(spent - withSound.limit) / withSound.limit < 0.08,
  `${Math.round(spent)} spent of ${withSound.limit}`);

const sounded = await page.evaluate(async () => {
  const r = await window.CLI.jobs.fit({ bytes: true });
  return r.bytes;
});
fs.writeFileSync(F('dc-sound.webm'), Buffer.from(sounded));
/* Rendered rather than asserted: the sound is decoded again and its loudest
   frequency read off a transform, because a muxer that wrote the audio track
   into the file at the wrong timestamps produces a file with an audio stream
   in it that plays silence. */
const heard = await page.evaluate(async (bytes) => {
  const ac = new AudioContext({ sampleRate: 48000 });
  const buf = await ac.decodeAudioData(new Uint8Array(bytes).buffer);
  ac.close();
  const lane = buf.getChannelData(0);
  const from = Math.round(buf.sampleRate * 0.5);
  const n = 8192;
  if (lane.length < from + n) return { seconds: buf.duration, peak: 0, hz: 0 };
  let peak = 0;
  for (let i = from; i < from + n; i++) peak = Math.max(peak, Math.abs(lane[i]));
  /* One Goertzel pass per candidate rather than a whole FFT: the question is
     only which of a handful of tones is loudest. */
  const power = (hz) => {
    const k = (2 * Math.PI * hz) / buf.sampleRate;
    const coeff = 2 * Math.cos(k);
    let s1 = 0, s2 = 0;
    for (let i = from; i < from + n; i++) {
      const s0 = lane[i] + coeff * s1 - s2;
      s2 = s1; s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  };
  let best = 0, bestHz = 0;
  for (let hz = 200; hz <= 1200; hz += 5) {
    const p = power(hz);
    if (p > best) { best = p; bestHz = hz; }
  }
  return { seconds: buf.duration, peak, hz: bestHz, channels: buf.numberOfChannels };
}, sounded);
ok('the sound that came out is as long as the video',
  Math.abs(heard.seconds - withSound.video.seconds) < 0.3,
  `${heard.seconds} vs ${withSound.video.seconds}`);
ok('and it is audible rather than an empty track', heard.peak > 0.02, `peak ${heard.peak}`);
ok('and it is still the 440 Hz that went in', Math.abs(heard.hz - 440) <= 10, `${heard.hz} Hz`);

/* A budget nothing could meet has to be a sentence, not a soup of blocks and
   not a crash: 51 KB will not hold five seconds of 96 kbps sound, never mind
   a picture. Lifting the MIN_VIDEO_BITRATE guard produced a file of grey mush
   that the page called a success — caught here. */
ok('the recording is long enough for the next check to mean anything',
  withSound.video.seconds > 4.6, `${withSound.video.seconds}s`);
const hopeless = await fitFails({ limit: 0.05, res: 'keep', fps: '10', sound: '96' });
ok('a budget nothing could meet is refused in a sentence',
  !!hopeless && /will not go into/.test(hopeless), String(hopeless));
/* The page is right to log that one — it is a real failure, caused here on
   purpose — so it comes off the list the suite asserts is empty at the end,
   and this says whose it was rather than widening the filter. */
const mine = errs.findIndex((e) => /will not go into/.test(e));
ok('and the page logged it, which is the evidence it really failed', mine !== -1,
  errs.join(' | '));
if (mine !== -1) errs.splice(mine, 1);
ok('the sentence says where the budget went',
  !!hopeless && /of it is sound/.test(hopeless), String(hopeless));
ok('and what to do about it',
  !!hopeless && /(frame rate|split)/.test(hopeless), String(hopeless));

const silenced = await fit({ limit: 0.25, res: 'keep', fps: '10', sound: '0' });
ok('dropping the sound makes the picture better off, not just smaller',
  silenced.video.asked > withSound.video.asked,
  `${silenced.video.asked} vs ${withSound.video.asked} bps for the picture`);

/* --------------------------------------------------------- the animation -- */

console.log('--- an animated GIF ---');

await load('dc-anim.gif');
const animated = await fit({ limit: 0.04 });
ok('an animated GIF comes out as a video under the limit',
  animated.kind === 'video' && animated.went.bytes <= animated.limit,
  `${animated.kind} ${animated.went.bytes} vs ${animated.limit}`);
/* An exact frame-rate test against summed GIF delays threw away every other
   frame, silently halving the animation. Nothing on screen said so; this is
   the check that notices. */
ok('every frame of it is kept when nothing asked for fewer',
  animated.video.frames === 24, `${animated.video.frames} of 24`);

/* The page says in as many words that a WebM is a fraction of a GIF of the
   same picture, so the claim is checked on an animation that looks like one —
   flat areas, a few moving things — and at a limit generous enough that the
   limit is not what is doing the shrinking. */
const roomy = await fit({ limit: 5 });
ok('given room, a GIF still comes out a fraction of its old size',
  roomy.went.bytes < roomy.came.bytes / 2,
  `${(roomy.came.bytes / roomy.went.bytes).toFixed(2)}× smaller — `
  + `${roomy.went.bytes} from ${roomy.came.bytes}`);
/* And the reason it does: the budget is not spent for its own sake. Taking
   the source-bitrate ceiling out turns this GIF into a 5 MB WebM that the
   page reports, perfectly truthfully, as fitting. */
ok('a generous limit is not spent just because it is there',
  roomy.video.held && roomy.video.asked < roomy.video.allowed / 4,
  `asked ${roomy.video.asked}, allowed ${roomy.video.allowed}`);
ok('and the page says the ceiling was the file, not the limit',
  /came in with/.test(roomy.detail), roomy.detail);
const fewer = await fit({ limit: 0.04, fps: '8' });
ok('asking for fewer frames a second gives fewer frames',
  fewer.video.frames < animated.video.frames,
  `${fewer.video.frames} vs ${animated.video.frames}`);
ok('and the clip is still the same length',
  Math.abs(fewer.video.seconds - animated.video.seconds) < 0.05,
  `${fewer.video.seconds} vs ${animated.video.seconds}`);

/* Flickering static comes out at about twice the bitrate it is given and
   sails over every rung of the first ladder. That is the case the second
   pass exists for, so the suite insists it happened rather than hoping it
   was not needed: deleting the second pass leaves this file over the limit
   with the page reporting it as done. */
await load('dc-static.gif');
const hard = await fit({ limit: 0.04 });
ok('static that beats the whole ladder is aimed at again', hard.video.passes === 2,
  `${hard.video.passes} passes — ` + JSON.stringify(hard.tries));
ok('and the second pass is the one that fits',
  hard.went.bytes <= hard.limit && hard.tries.some((t) => t.pass === 2 && t.kept),
  `${hard.went.bytes} vs ${hard.limit} — ` + JSON.stringify(hard.tries));

/* ------------------------------------------------------------ the picture -- */

console.log('--- a picture ---');

await load('dc-photo.png');
const loose = await fit({ limit: 2, format: 'webp', quality: 82 });
ok('a generous limit leaves the quality where it was asked for',
  loose.image.quality === 82 && loose.tries.length === 1, JSON.stringify(loose.tries));
ok('and the picture keeps every pixel it came with',
  loose.image.width === 1400 && loose.image.height === 900,
  `${loose.image.width}×${loose.image.height}`);

const tight = await fit({ limit: 0.06, format: 'webp', quality: 82 });
ok('a tight limit is met', tight.went.bytes <= tight.limit,
  `${tight.went.bytes} vs ${tight.limit}`);
/* The order is the point. Shrinking first and dropping quality afterwards is
   the obvious loop and it is the wrong way round, so the suite insists that
   every full-size try comes before the first smaller one. */
const firstShrunk = tight.tries.findIndex((t) => !/^1400×900/.test(t.label));
const lastFull = tight.tries.map((t) => /^1400×900/.test(t.label)).lastIndexOf(true);
ok('quality is spent before pixels are', firstShrunk === -1 || firstShrunk > lastFull,
  tight.tries.map((t) => t.label).join(' → '));
ok('and the quality ladder bottomed out before anything shrank',
  tight.tries.filter((t) => /^1400×900/.test(t.label)).length >= 3,
  tight.tries.map((t) => t.label).join(' → '));

const asWebp = await saveAndRead('dc-out.webp');
const measured = await page.evaluate(async (bytes) => {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  const out = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  return out;
}, Array.from(asWebp.bytes));
ok('the saved picture decodes at the size the page claimed',
  measured.w === tight.image.width && measured.h === tight.image.height,
  `${measured.w}×${measured.h} vs ${tight.image.width}×${tight.image.height}`);
ok('and it really is a WebP', asWebp.bytes.subarray(8, 12).toString('latin1') === 'WEBP',
  asWebp.bytes.subarray(8, 12).toString('latin1'));

const asJpeg = await fit({ limit: 0.06, format: 'jpg', quality: 82 });
ok('the format box is obeyed', asJpeg.image.format === 'jpg' && /\.jpg$/.test(asJpeg.name),
  asJpeg.name);

/* The documented case: a canvas writes a plain PNG with no palette reduction
   and no filter search, so a PNG that came from a tool which did both grows
   here. The page is allowed to be bigger; it is not allowed to be bigger and
   quiet about it. */
const asPng = await fit({ limit: 2, format: 'png' });
ok('PNG from a canvas can come out bigger, and the tally says so',
  asPng.tries[0].size > asPng.came.bytes || asPng.saved.bytes > 0,
  `${asPng.tries[0].size} from ${asPng.came.bytes}`);

/* --------------------------------------------------------------- the sound -- */

console.log('--- sound on its own ---');

await load('dc-tone.wav');
const asOpus = await fit({ limit: 0.03 });
ok('sound on its own comes out under the limit', asOpus.went.bytes <= asOpus.limit,
  `${asOpus.went.bytes} vs ${asOpus.limit}`);
ok('and it worked the bitrate out rather than being told one',
  asOpus.sound.bitrate > 8000 && asOpus.sound.bitrate < 60000, asOpus.sound.bitrate);

const mono = await fit({ limit: 0.03, channels: 'mono' });
ok('mono is one channel', mono.sound.channels === 1, mono.sound.channels);
const stereo = await fit({ limit: 0.03, channels: 'keep' });
ok('and keeping the channels keeps two', stereo.sound.channels === 2, stereo.sound.channels);

const opusBytes = await page.evaluate(async () => (await window.CLI.jobs.fit({ bytes: true })).bytes);
/* Both tones have to survive the trip, because taking channel one instead of
   averaging — which is the obvious way to write a downmix — loses the 660
   entirely, and a file with the 440 still in it sounds fine. */
const tones = await page.evaluate(async (bytes) => {
  const ac = new AudioContext({ sampleRate: 48000 });
  const buf = await ac.decodeAudioData(new Uint8Array(bytes).buffer);
  ac.close();
  const look = (lane, hz) => {
    const from = Math.round(buf.sampleRate * 0.5);
    const n = 8192;
    const k = (2 * Math.PI * hz) / buf.sampleRate;
    const coeff = 2 * Math.cos(k);
    let s1 = 0, s2 = 0;
    for (let i = from; i < from + n; i++) { const s0 = lane[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
    return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - coeff * s1 * s2)) / n;
  };
  const left = buf.getChannelData(0);
  const right = buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0);
  return { seconds: buf.duration, channels: buf.numberOfChannels,
           left440: look(left, 440), left660: look(left, 660),
           right440: look(right, 440), right660: look(right, 660),
           leftQuiet: look(left, 1500) };
}, opusBytes);
ok('the sound is still five seconds long', Math.abs(tones.seconds - 5) < 0.2, tones.seconds);
ok('440 on the left survived', tones.left440 > tones.leftQuiet * 8,
  `${tones.left440.toFixed(4)} against ${tones.leftQuiet.toFixed(4)} where there is nothing`);
ok('660 on the right survived', tones.right660 > tones.leftQuiet * 8,
  `${tones.right660.toFixed(4)} against ${tones.leftQuiet.toFixed(4)}`);

const monoBytes = await page.evaluate(async () =>
  (await window.CLI.jobs.fit({ channels: 'mono', bytes: true })).bytes);
const mixed = await page.evaluate(async (bytes) => {
  const ac = new AudioContext({ sampleRate: 48000 });
  const buf = await ac.decodeAudioData(new Uint8Array(bytes).buffer);
  ac.close();
  const lane = buf.getChannelData(0);
  const look = (hz) => {
    const from = Math.round(buf.sampleRate * 0.5);
    const n = 8192;
    const k = (2 * Math.PI * hz) / buf.sampleRate;
    const coeff = 2 * Math.cos(k);
    let s1 = 0, s2 = 0;
    for (let i = from; i < from + n; i++) { const s0 = lane[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
    return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - coeff * s1 * s2)) / n;
  };
  return { at440: look(440), at660: look(660), quiet: look(1500) };
}, monoBytes);
/* The two tones held against *each other*, not against the noise floor. The
   first version of this check asked only that 660 stood clear of a frequency
   with nothing at it, and taking the left channel instead of averaging —
   which is the obvious way to write a downmix, and loses whatever was panned
   right — sailed through it, because 660 sits close enough to a loud 440 for
   the leakage alone to clear that bar. Averaged, the two come out level:
   measured at 0.091 and 0.092. Taking the left channel gives 0.183 and
   0.0014, a ratio of 1 against a ratio of 0.007, so a third is a line with a
   factor of forty-five on either side of it. */
ok('a downmix keeps both channels rather than throwing one away',
  mixed.at660 > mixed.at440 / 3 && mixed.at440 > mixed.quiet * 20,
  `440 ${mixed.at440.toFixed(4)}, 660 ${mixed.at660.toFixed(4)}, `
  + `nothing ${mixed.quiet.toFixed(4)}`);

/* ----------------------------------------------------- anything else at all -- */

console.log('--- a file nothing can read inside ---');

await load('dc-log.txt');
const zipped = await fit({ limit: 1, zip: true });
ok('a text file deflates to a fraction of itself',
  zipped.kind === 'zip' && zipped.zip.deflated && zipped.went.bytes < zipped.came.bytes / 5,
  `${zipped.went.bytes} from ${zipped.came.bytes}`);
const zipFile = await saveAndRead('dc-out.zip');
ok('the zip is named after the file that went in', zipFile.suggested === 'dc-log.zip',
  zipFile.suggested);

/* Handed back to unzip.html, which is this repo's own zip reader, rather than
   to a reader written here: a second reader is a second implementation, and
   the two drift. If the page writes a zip nothing else in the repo can open,
   that is worth knowing from inside the repo. */
const reader = await browser.newPage();
await reader.goto(`${SITE}/unzip.html`);
await reader.setInputFiles('input[type=file]', F('dc-out.zip'));
await reader.waitForFunction(() => /dc-log\.txt/.test(document.body.textContent), null,
  { timeout: 20000 }).catch(() => {});
const readBack = await reader.evaluate(() => document.body.textContent);
ok('unzip.html finds the file inside it', /dc-log\.txt/.test(readBack),
  readBack.slice(0, 200).replace(/\s+/g, ' '));
await reader.close();

/* And the bytes, by a reader that is not a browser at all, because "it lists"
   and "it round-trips" are different claims. */
let zipRoundTrip = 'no reader';
try {
  const out = execFileSync('python3', ['-c',
    'import zipfile,sys,hashlib;z=zipfile.ZipFile(sys.argv[1]);'
    + 'd=z.read(z.namelist()[0]);print(z.namelist()[0], len(d), hashlib.sha256(d).hexdigest())',
    F('dc-out.zip')], { encoding: 'utf8' }).trim();
  zipRoundTrip = out;
} catch (e) { zipRoundTrip = 'failed: ' + String(e.message).split('\n')[0]; }
const wanted = fs.readFileSync(F('dc-log.txt'));
const wantedSum = (await import('node:crypto')).createHash('sha256').update(wanted).digest('hex');
ok('and the bytes inside it are the bytes that went in',
  zipRoundTrip.includes(String(wanted.length)) && zipRoundTrip.includes(wantedSum),
  zipRoundTrip);

await load('dc-noise.bin');
const stored = await fit({ limit: 2, zip: true });
/* Deflate makes incompressible bytes bigger. Storing instead is what every
   zip writer does, and the page has to say which happened rather than quietly
   handing over something larger than it was given. */
ok('incompressible bytes are stored rather than deflated',
  stored.zip.deflated === false && stored.zip.method === 0, JSON.stringify(stored.zip));
ok('and the page says that is what happened', /bigger/.test(stored.detail), stored.detail);
ok('the zip is barely larger than the bytes in it',
  stored.went.bytes >= stored.came.bytes && stored.went.bytes < stored.came.bytes + 400,
  `${stored.went.bytes} from ${stored.came.bytes}`);

console.log('--- splitting, which is the last resort ---');

const split = await page.evaluate(async () =>
  window.CLI.jobs.fit({ limit: 0.25, zip: true, split: true, bytes: true }));
ok('a file too big for anything is cut into parts', (split.parts || []).length === 4,
  JSON.stringify((split.parts || []).map((p) => p.bytes)));
ok('and no part is over the limit', split.parts.every((p) => p.bytes <= split.limit),
  JSON.stringify(split.parts.map((p) => p.bytes)));
ok('the parts are numbered so they sort in a file listing',
  split.parts.every((p, i) => p.name.endsWith(`.00${i + 1}`)),
  split.parts.map((p) => p.name).join(' '));
ok('and the line to put them back names the file',
  /^cat dc-noise\.zip\.\* > dc-noise\.zip/.test(split.join), split.join);

const joined = Buffer.concat(split.partBytes.map((b) => Buffer.from(b)));
fs.writeFileSync(F('dc-joined.zip'), joined);
ok('the parts, concatenated, are the whole file again',
  joined.length === split.went.bytes, `${joined.length} vs ${split.went.bytes}`);
let joinedOk = false;
try {
  execFileSync('python3', ['-c',
    'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);'
    + 'assert z.read(z.namelist()[0])==open(sys.argv[2],"rb").read()',
    F('dc-joined.zip'), F('dc-noise.bin')]);
  joinedOk = true;
} catch (e) { joinedOk = String(e.message).split('\n')[0]; }
ok('and the zip they make still holds the original, byte for byte',
  joinedOk === true, String(joinedOk));

/* --------------------------------------- what a browser that is not this -- */

/* The bug this section exists for: the page shipped offering VP9, VP8 and
   AV1, and on an iPhone — where every browser is Safari underneath and
   Safari's encoder writes H.264 and HEVC — it said "no video encoder" and
   stopped. Nothing in this container can run Safari, and no amount of
   reading documentation from here is the same as the browser's own answer,
   so the shape of that browser is built instead: an encoder that takes avc1
   and nothing else, AAC and nothing else, and no ImageDecoder.
 *
 * What this can check is everything up to the encode — which codec is
 * offered, which container follows it, what the page says about sound and
 * about animations. What it cannot check is the encode itself, because this
 * Chromium has no H.264 encoder to do it with. That limit is real and worth
 * stating rather than papering over: the H.264 path is exercised here as far
 * as the configure call and no further.
 */
console.log('--- a browser shaped like the one on a phone ---');

async function pretending(stub) {
  const other = await browser.newContext({ viewport: { width: 420, height: 1200 } });
  const tab = await other.newPage();
  const broke = [];
  tab.on('pageerror', (e) => broke.push(e.message));
  await tab.addInitScript(stub);
  await tab.goto(PAGE);
  return { tab, broke, close: () => other.close() };
}

const ONLY_H264 = () => {
  VideoEncoder.isConfigSupported = async (c) => ({ supported: /^avc1\./.test(c.codec), config: c });
  AudioEncoder.isConfigSupported = async (c) => ({ supported: c.codec === 'mp4a.40.2', config: c });
  delete window.ImageDecoder;
};

{
  const { tab, broke, close } = await pretending(ONLY_H264);
  const said = await tab.evaluate(() => window.CLI.jobs.limits());
  ok('a browser that will only write H.264 is offered H.264',
    said.codecs.length === 1 && said.codecs[0].id === 'h264' && said.codecs[0].default,
    JSON.stringify(said.codecs.map((c) => c.id)));
  ok('and the container that follows it is MP4, because a WebM cannot hold it',
    said.codecs[0].containers.join() === 'mp4', JSON.stringify(said.codecs[0].containers));
  ok('and the sound it is offered is the AAC it can write, not the Opus it cannot',
    said.sound.length === 1 && said.sound[0].id === 'aac',
    JSON.stringify(said.sound.map((a) => a.id)));

  await tab.setInputFiles('#fileInput', F('clip.webm'));
  await tab.waitForFunction(() => window.CLI.file().ready, null, { timeout: 90000 });
  const boxes = await tab.evaluate(() => ({
    codecs: [...document.getElementById('codecSel').options].map((o) => o.value),
    codec: document.getElementById('codecSel').value,
    containers: [...document.getElementById('boxSel').options].map((o) => o.value),
    container: document.getElementById('boxSel').value,
    plan: document.getElementById('planWhat').textContent,
  }));
  /* The regression itself. Before the MP4 half existed this read
     ["none"] / "no video encoder", on the device most of the files too big
     for Discord are sitting on. */
  ok('the boxes on screen offer it rather than saying there is nothing',
    boxes.codecs.join() === 'h264' && boxes.codec === 'h264'
      && boxes.containers.join() === 'mp4' && boxes.container === 'mp4',
    JSON.stringify(boxes));
  ok('and the page does not tell it there is no encoder',
    !/no WebCodecs|will not encode/.test(boxes.plan), boxes.plan.slice(0, 120));

  /* An animated GIF, on a browser with no ImageDecoder to read its frames.
     Decoding it gives the first frame and nothing says so, which is how you
     get a still picture of an animation back; the bytes are sniffed instead
     so the page can say what would be lost. */
  await tab.setInputFiles('#fileInput', []);
  await tab.setInputFiles('#fileInput', F('dc-anim.gif'));
  await tab.waitForFunction(() => window.CLI.file().kind === 'image', null, { timeout: 60000 });
  const lost = await tab.evaluate(() => ({
    plan: document.getElementById('planWhat').textContent,
    deflate: !document.getElementById('zipChk').closest('label').hidden,
  }));
  ok('an animation it cannot read the frames of is recognised from its bytes',
    /animated picture/.test(lost.plan) && /first frame/.test(lost.plan),
    lost.plan.slice(0, 140));
  ok('and it is offered the deflate it would otherwise not be',
    lost.deflate, String(lost.deflate));

  /* And a still picture is still a still picture — the sniff has to say no
     as well as yes, or it is not telling anybody anything. */
  await tab.setInputFiles('#fileInput', []);
  await tab.setInputFiles('#fileInput', F('dc-photo.png'));
  await tab.waitForFunction(() => window.CLI.file().kind === 'image', null, { timeout: 60000 });
  const stillStill = await tab.textContent('#planWhat');
  ok('a picture that is not animated is not accused of being one',
    !/animated picture/.test(stillStill), stillStill.slice(0, 100));

  ok('nothing threw in the browser that is not this one', broke.length === 0, broke.join(' | '));
  await close();
}

/* The three other ways a browser can be missing something this page wants.
   Each has to be a sentence rather than a stack trace, because each of them
   is somebody's actual phone. */
for (const [what, stub, wants] of [
  ['no WebCodecs at all', () => { delete window.VideoEncoder; }, /no WebCodecs/],
  ['an encoder that refuses everything',
    () => { VideoEncoder.isConfigSupported = async (c) => ({ supported: false, config: c }); },
    /will not encode/],
]) {
  const { tab, broke, close } = await pretending(stub);
  await tab.setInputFiles('#fileInput', F('clip.webm'));
  await tab.waitForFunction(() => window.CLI.file().ready, null, { timeout: 90000 });
  let why = null;
  try { await tab.evaluate(() => window.CLI.jobs.fit({ limit: 0.08 })); }
  catch (e) { why = String(e.message).split('\n')[0]; }
  ok(`${what}: a sentence, not a stack trace`, !!why && wants.test(why), String(why));
  ok(`${what}: and it says what to do instead`, !!why && /deflate or split/i.test(why),
    String(why));
  ok(`${what}: nothing threw`, broke.length === 0, broke.join(' | '));
  await close();
}

{
  /* No audio encoder: the video still comes out, silent, and says so rather
     than quietly dropping the sound. */
  const { tab, broke, close } = await pretending(() => { delete window.AudioEncoder; });
  await tab.setInputFiles('#fileInput', F('dc-rec.webm'));
  await tab.waitForFunction(() => window.CLI.file().ready, null, { timeout: 90000 });
  const quiet = await tab.evaluate(() =>
    window.CLI.jobs.fit({ limit: 0.3, fps: '10', sound: '64' }));
  ok('with no audio encoder the video is still made, and still fits',
    quiet.fits && quiet.video.audio === null, JSON.stringify(quiet.video.audio));
  ok('and the page says the sound was wanted and could not be had',
    quiet.video.soundWanted && /silent because/.test(quiet.detail), quiet.detail);
  ok('no audio encoder: nothing threw', broke.length === 0, broke.join(' | '));
  await close();
}

{
  /* No CompressionStream: a zip of stored bytes is still a zip, and the page
     says that is what it is rather than handing over something that is not
     any smaller without a word.

     Caught rather than awaited bare, because the behaviour under test is a
     page that used to throw right here — and a suite that goes down with it
     reports a stack trace instead of a failure, which is how the
     deliberate-breakage pass found this check in the first place. */
  const { tab, broke, close } = await pretending(() => { delete window.CompressionStream; });
  await tab.setInputFiles('#fileInput', F('dc-log.txt'));
  await tab.waitForFunction(() => window.CLI.file().kind === 'file', null, { timeout: 60000 });

  let bare = null;
  let threw = null;
  try {
    bare = await tab.evaluate(() => window.CLI.jobs.fit({ limit: 10, zip: true, bytes: true }));
  } catch (e) { threw = String(e.message).split('\n')[0]; }

  ok('with no CompressionStream the zip stores rather than failing',
    !!bare && bare.zip.deflated === false && bare.went.bytes > bare.came.bytes,
    threw || JSON.stringify(bare.zip));
  ok('and says that is why it is no smaller',
    !!bare && /no CompressionStream/.test(bare.detail), threw || bare.detail);

  let storedOk = threw ? 'nothing was made to read' : false;
  if (bare) {
    fs.writeFileSync(F('dc-stored.zip'), Buffer.from(bare.bytes));
    try {
      execFileSync('python3', ['-c',
        'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);'
        + 'assert z.read(z.namelist()[0])==open(sys.argv[2],"rb").read()',
        F('dc-stored.zip'), F('dc-log.txt')]);
      storedOk = true;
    } catch (e) { storedOk = String(e.message).split('\n')[0]; }
  }
  ok('and the zip it made is still a zip with the file in it', storedOk === true,
    String(storedOk));
  ok('no CompressionStream: nothing threw', broke.length === 0, broke.join(' | '));
  await close();
}

{
  /* A phone will not open three hardware encoders at once, and the ladder
     asks for three. Losing a rung costs accuracy; losing the run costs
     everything, so the rungs that did open carry on without the ones that
     did not. Built here as a browser that allows exactly one encoder at a
     time and refuses the rest the way a real one does, from `configure`. */
  const { tab, broke, close } = await pretending(() => {
    const Real = window.VideoEncoder;
    let live = 0;
    class OneAtATime extends Real {
      configure(config) {
        if (live >= 1) throw new DOMException('Encoder creation error.', 'NotSupportedError');
        live++;
        this.__on = true;
        return super.configure(config);
      }
      close() {
        if (this.__on) { this.__on = false; live--; }
        return super.close();
      }
    }
    OneAtATime.isConfigSupported = Real.isConfigSupported.bind(Real);
    window.VideoEncoder = OneAtATime;
  });
  await tab.setInputFiles('#fileInput', F('clip.webm'));
  await tab.waitForFunction(() => window.CLI.file().ready, null, { timeout: 90000 });
  /* Caught, not awaited bare. The behaviour under test is a page that used
     to throw at exactly this point, and the first version of this check went
     down with it — a stack trace and no FAIL line, which is the second time
     the breakage pass has caught that mistake in this file. A check written
     against a failure path has to survive the failure. */
  let lean = null;
  let fell = null;
  try {
    lean = await tab.evaluate(() => window.CLI.jobs.fit({ limit: 0.08, res: '240', fps: '10' }));
  } catch (e) { fell = String(e.message).split('\n')[0]; }
  ok('a browser that will only open one encoder still gets a video out',
    !!lean && lean.fits && lean.went.bytes <= lean.limit,
    fell || `${lean.went.bytes} vs ${lean.limit}`);
  ok('and it ran the rungs it could rather than the three it wanted',
    !!lean && lean.video.short === 1 && lean.tries.filter((t) => t.pass === 1).length === 1,
    fell || `short ${lean.video.short}, ` + JSON.stringify(lean.tries));
  ok('and the page says the ladder came up short rather than hiding it',
    !!lean && /only open 1 encoder at once/.test(lean.detail), fell || lean.detail);
  ok('one encoder at a time: nothing threw', broke.length === 0, broke.join(' | '));
  await close();
}

{
  /* Which sound goes in which box is a pairing, not a list — AAC cannot go
     in a WebM at all — and the pairing is invisible from outside until
     something has been encoded, which is why the page reports it. A browser
     that can write both is the only one that can tell a correct pairing from
     "whichever came first", and no browser here can, so one is made. */
  const { tab, broke, close } = await pretending(() => {
    AudioEncoder.isConfigSupported = async (c) => ({ supported: true, config: c });
  });
  const both = await tab.evaluate(() => window.CLI.jobs.limits());
  ok('a browser that writes both is offered both', both.sound.length === 2,
    JSON.stringify(both.sound.map((a) => a.id)));
  ok('and a WebM is given the Opus it can hold, not the AAC it cannot',
    both.soundFor.webm === 'opus', JSON.stringify(both.soundFor));
  ok('and an MP4 is given the AAC that everything opens',
    both.soundFor.mp4 === 'aac', JSON.stringify(both.soundFor));
  ok('both codecs: nothing threw', broke.length === 0, broke.join(' | '));
  await close();
}

/* ---------------------------------------------------------------- the page -- */

console.log('--- the page itself ---');

await load('dc-photo.png');
const already = await page.evaluate(() => {
  document.getElementById('limitMb').value = '50';
  document.getElementById('limitMb').dispatchEvent(new Event('input'));
  return { button: document.getElementById('goBtn').textContent,
           said: document.getElementById('planStatus').textContent };
});
ok('a file that already fits is told so rather than compressed at a guess',
  /already fits/.test(already.said), already.said);
ok('and the button stops claiming it will make it fit',
  /anyway/.test(already.button), already.button);

const narrow = await browser.newPage({ viewport: { width: 390, height: 1400 } });
await narrow.goto(PAGE);
await narrow.setInputFiles('#fileInput', F('clip.webm'));
await narrow.waitForFunction(() => window.CLI.file().ready, null, { timeout: 60000 });
const overflow = await narrow.evaluate(() => ({
  wide: document.documentElement.scrollWidth > window.innerWidth,
  scroll: document.documentElement.scrollWidth,
  window: window.innerWidth,
}));
ok('nothing runs off the side of a phone', !overflow.wide, JSON.stringify(overflow));
await narrow.screenshot({ path: F('dc-narrow.png'), fullPage: true });
await narrow.close();

await page.screenshot({ path: F('dc-wide.png'), fullPage: true });
ok('nothing threw along the way', errs.length === 0, errs.join(' | '));

console.log(`\n(ffprobe ${HAVE_FFPROBE ? 'was' : 'was not'} available)`);
await browser.close();
process.exit(done());

/* What the deliberate breakages found, and what they did not.
 *
 * Eleven went through the page when it was written, one at a time, each run
 * against the whole suite. Eight were caught by the checks you would hope:
 * keeping the smallest rung that fits instead of the largest; measureFps
 * returning a flat 30; shrinking the picture before spending the quality; no
 * floor under the video bitrate; no second pass when the whole ladder
 * overshoots; no ceiling from the bitrate the file arrived with; a zip that
 * always deflates and never stores; split parts numbered without padding.
 *
 * Three were not, and two of those earned a change here rather than a shrug.
 * Keeping an animation's frames on an exact test went unnoticed because the
 * fixture's delays were a steady 80 ms and the arithmetic only drifts when
 * they are not; the fixture now has uneven delays, and the deeper fix was in
 * the page, where Keep now means every frame rather than a grid at the
 * average rate — a rate no frame in an unevenly timed GIF actually has, and
 * it was dropping a third of the animation. A downmix that takes the left
 * channel went unnoticed because the check held 660 Hz against a frequency
 * with nothing at it rather than against the 440 beside it; the two now
 * differ by a factor of forty-five. And handing the muxer all the sound at
 * once instead of interleaving it changed nothing at all, because webm-muxer
 * queues whichever track is ahead until the other catches up: the
 * interleaving is there to keep three whole files out of memory, not to keep
 * them correct, and the suite cannot tell the two apart.
 *
 * Seven more went through when the page learned to write MP4 — which it had
 * to, because it was saying "no video encoder" on every iPhone. Five were
 * caught: the container always coming out WebM (three checks, one of them
 * ffprobe reading the bytes); H.264 missing from the table; the animation
 * sniff stuck at no, and stuck at yes; the codec box filled from the table
 * rather than from what the browser said yes to.
 *
 * The other two were more instructive than the five.
 *
 *   - **The sound codec ignoring which container it is going in** was caught
 *     by nothing, because no browser available here can write both AAC and
 *     Opus, and with only one of them the right answer and the first answer
 *     are the same answer. The pairing is now reported as data — AAC cannot
 *     go in a WebM at all — and checked against a browser built to claim it
 *     writes both.
 *
 *   - **Leaving the deflate guard out** did not fail the suite, it *took the
 *     suite down*: the page threw, the bare `await` threw with it, and the
 *     run ended in a stack trace with no FAIL line anywhere. A check whose
 *     whole subject is a page that used to throw has to catch. That one now
 *     does — and so does the one-encoder-at-a-time check beside it, which
 *     was written afterwards, made the identical mistake, and was caught by
 *     the identical breakage. Twice in one file is a pattern rather than a
 *     slip: a check written against a failure path has to survive the
 *     failure.
 *
 * And one thing nothing here covers on purpose: the container overhead
 * allowance, twelve bytes a block, can be set to anything from zero to about
 * forty without a check noticing, because the ladder underneath absorbs it.
 * It is a guard with a second guard behind it.
 *
 * What this suite cannot reach at all: the H.264 encode itself. The browser
 * on an iPhone is the reason the MP4 half exists, nothing in this container
 * runs it, and this Chromium has no H.264 encoder to stand in — so the
 * H.264 path is exercised as far as the `configure` call and stops there.
 * Everything before it is real; the encode is not covered, and no amount of
 * green here says otherwise.
 */
