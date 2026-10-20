import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });
const page = await browser.newPage({ viewport: { width: 1250, height: 1400 } });
const ok = (n, c, x='') => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  <<< ' + x));
await page.goto('http://127.0.0.1:8099/captions-to-transcript.html');

const trail = () => page.$$eval('#trail li', ls => ls.map(l => ({
  via: l.querySelector('.via').textContent, said: l.querySelector('.said').textContent, state: l.className })));
const run = async (relay) => {
  await page.fill('#relayIn', relay);
  await page.fill('#linkIn', 'https://www.youtube.com/watch?v=TEST');
  await page.click('#fetchBtn');
  await page.waitForFunction(() => !document.getElementById('fetchBtn').disabled
    && !/Trying each route|checking whether/.test(document.getElementById('status').textContent),
    null, { timeout: 300000 });
  return { status: await page.textContent('#status'), steps: await trail() };
};

// A host that answers only after the probe has given up must not be called dead.
let r = await run('http://127.0.0.1:8098/slow?url={url}');
const slow = r.steps.find(s => /your relay/.test(s.via));
ok('a slow host is not reported as unreachable', !/could not be reached/.test(slow.said), JSON.stringify(slow));
ok('it is reported as too slow to tell', /too slow to say which/.test(slow.said), JSON.stringify(slow));

// The three diagnoses must be three distinct strings.
const seen = {};
for (const [name, relay] of [['cors','http://127.0.0.1:8098/nocors?url={url}'],
                             ['dead','http://127.0.0.1:9/x?url={url}']]) {
  const q = await run(relay);
  seen[name] = q.steps.find(s => /your relay/.test(s.via)).said;
}
seen.slow = slow.said;
ok('refused, unreachable and slow are three different messages',
   new Set(Object.values(seen)).size === 3, JSON.stringify(seen, null, 1));
for (const [k, v] of Object.entries(seen)) console.log(`        ${k.padEnd(5)} → ${v}`);

// The hint must follow the diagnosis, not the bare fact of failure.
r = await run('http://127.0.0.1:9/x?url={url}');
ok('all-unreachable blames this end', /something at this end is blocking/.test(r.status), r.status.slice(-150));
r = await run('http://127.0.0.1:8098/nocors?url={url}');
ok('a refusing relay is blamed on rate limiting instead',
   /rate-limiting you rather than broken/.test(r.status) && !/this end is blocking/.test(r.status), r.status.slice(-170));

// And the working case is untouched.
r = await run('http://127.0.0.1:8098/relay?url={url}');
ok('a good relay still gets through', /captions read/.test(r.status), r.status);
ok('with no hint attached', !/rate-limiting|this end is blocking/.test(r.status), r.status);
await browser.close();
