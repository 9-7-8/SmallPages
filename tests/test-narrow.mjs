import { chromium, CHROMIUM_BIN, WORK } from './lib/env.mjs';
const browser = await chromium.launch({ executablePath: CHROMIUM_BIN });

for (const locale of ['en-US', 'de-DE', 'ja-JP']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 1400 }, locale });
  await page.goto('http://127.0.0.1:8099/combat-health-tracker.html');
  await page.fill('#hp', '17'); await page.locator('#hp').press('Tab');
  const r = await page.evaluate(() => {
    const e = document.querySelector('.entry');
    const at = e.querySelector('.at');
    return { text: at.textContent, lines: Math.round(at.getBoundingClientRect().height / parseFloat(getComputedStyle(at).lineHeight)) };
  });
  console.log(locale, JSON.stringify(r.text), 'chars', r.text.length, 'lines', r.lines);
  if (locale === 'en-US') await page.screenshot({ path: WORK + '/cht-narrow2.png', clip: { x: 0, y: 870, width: 390, height: 220 } });
  await page.close();
}
await browser.close();
