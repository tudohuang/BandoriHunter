import { chromium } from 'playwright';
const S = 'C:/Users/Tudo/AppData/Local/Temp/claude/C--Users-Tudo-Downloads-secondHand/e89fbf7a-4b18-4242-96b3-0796ce1e1f91/scratchpad';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://localhost:3777/', { waitUntil: 'networkidle' });
// compare tab
await p.click('[data-tab="compare"]');
await p.fill('#compareInput', 'Roselia 法被');
await p.press('#compareInput', 'Enter');
await p.waitForTimeout(2000);
await p.screenshot({ path: S + '/ui3_compare.png' });
// danmaku on browse tab
await p.click('[data-tab="browse"]');
await p.check('#danmakuToggle');
await p.waitForTimeout(6500);
await p.screenshot({ path: S + '/ui3_danmaku.png' });
console.log('pageerrors:', errors.length ? errors : 'none');
await b.close();
