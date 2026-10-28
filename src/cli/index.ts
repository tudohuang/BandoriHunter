import { Command } from 'commander';
import { crawl, liveSearch } from '../core/crawler.js';
import * as D from '../core/db.js';
import { toast } from '../core/notify.js';
import { SOURCE_NAMES, type Source } from '../core/types.js';

const program = new Command().name('bandori').description('BanG Dream! 中古情報聚合 CLI');
const yen = (p: number | null) => (p != null ? `¥${p.toLocaleString()}` : '—');
const sites = (s?: string) => (s ? (s.split(',') as Source[]) : undefined);
const done = async (code = 0) => process.exit(code);

function printTable(items: { source: string; price: number | null; status: string; title: string; url: string }[]) {
  for (const it of items) {
    const st = it.status === 'soldout' ? '✗售完' : it.status === 'instock' ? '✓有貨' : '?';
    console.log(`${(SOURCE_NAMES[it.source as Source] ?? it.source).padEnd(10)} ${yen(it.price).padStart(9)} ${st}  ${it.title.slice(0, 60)}\n  ${it.url}`);
  }
}

program
  .command('search')
  .argument('<keyword...>', '關鍵字')
  .option('-s, --site <sites>', '限定站點 (lashinbang,hardoff,bookoff,kbooks,mercari)')
  .option('-p, --pages <n>', '每站頁數', '1')
  .option('--local', '只查本地資料庫，不打網站')
  .option('--json', '輸出 JSON')
  .description('即時搜尋各站（結果同時寫入資料庫）')
  .action(async (kw: string[], o) => {
    const keyword = kw.join(' ');
    if (o.local) {
      const { items, total } = await D.queryItems({ q: keyword, source: sites(o.site), limit: 100 });
      if (o.json) console.log(JSON.stringify(items, null, 2));
      else (console.log(`資料庫命中 ${total} 件（顯示前 ${items.length}）\n`), printTable(items));
      return;
    }
    console.error(`即時搜尋「${keyword}」…（各站禮貌節流，約需 5~20 秒）`);
    const { items, errors } = await liveSearch(keyword, { sources: sites(o.site), pages: Number(o.pages) });
    items.sort((a, b) => (a.price ?? 1e18) - (b.price ?? 1e18));
    if (o.json) console.log(JSON.stringify(items, null, 2));
    else (console.log(`\n共 ${items.length} 件（價格由低到高）\n`), printTable(items));
    for (const e of errors) console.error(`⚠ ${SOURCE_NAMES[e.source]}: ${e.message}`);
    await done();
  });

program
  .command('crawl')
  .option('-f, --full', '完整掃站（翻到底），首次執行自動為完整模式')
  .option('-s, --site <sites>', '限定站點')
  .option('-k, --keywords <kws>', '自訂關鍵字（逗號分隔）')
  .option('-q, --quiet', '不發通知')
  .description('掃描各站建庫/更新，新品比對關注關鍵字後通知')
  .action(async (o) => {
    const report = await crawl({ full: o.full, quiet: o.quiet, sources: sites(o.site), keywords: o.keywords?.split(',') });
    console.log('\n=== 掃站結果 ===');
    for (const s of report.sites)
      console.log(
        `${SOURCE_NAMES[s.source].padEnd(12)} 相關 ${String(s.found).padStart(5)} 件 | 新增 ${String(s.added).padStart(4)} | 價變 ${String(s.priceChanged).padStart(4)}${s.errors.length ? ' | ⚠ ' + s.errors.join('; ') : ''}`,
      );
    if (report.baseline) console.log('\n首次建庫完成。之後的掃描會偵測新上架並通知。');
    await done();
  });

const watch = program.command('watch').description('管理關注關鍵字（新上架通知）');
watch.command('add').argument('<keyword...>').action(async (kw: string[]) => (await D.addWatch(kw.join(' ')), console.log(`✓ 已關注「${kw.join(' ')}」`)));
watch.command('ls').action(async () => (await D.listWatches()).forEach((w) => console.log(`#${w.id}  ${w.keyword}`)));
watch.command('rm').argument('<id>').action(async (id: string) => (await D.removeWatch(Number(id)), console.log('✓ 已移除')));

program.command('wish').description('列出願望清單').action(async () => printTable((await D.queryItems({ wished: true, limit: 200 })).items));

program
  .command('config')
  .argument('<key>', 'discord_webhook | crawl_interval_hours')
  .argument('[value]')
  .description('讀寫設定')
  .action(async (key: string, value?: string) => {
    if (value == null) console.log((await D.getMeta(key)) ?? '(未設定)');
    else (await D.setMeta(key, value), console.log('✓ 已設定'));
  });

program.command('stats').description('資料庫統計').action(async () => {
  const s = await D.stats();
  console.log(`總品項：${s.total}（願望清單 ${s.wished}）  上次掃站：${s.lastCrawl ?? '從未'}`);
  for (const [src, c] of Object.entries(s.bySource)) console.log(`  ${SOURCE_NAMES[src as Source]}: ${c}`);
});

program.command('notify-test').description('測試通知（toast + discord）').action(async () => {
  toast('Bandori Hunter', '通知測試 🎸');
  await (await import('../core/notify.js')).discord('通知測試 🎸');
  console.log('已送出。');
});

program
  .command('serve')
  .option('--port <n>', '埠號', '3777')
  .option('--no-schedule', '不啟用排程掃站')
  .description('啟動網頁介面')
  .action(async (o) => (await import('../server/index.js')).startServer({ port: Number(o.port), schedule: o.schedule }));

program.parseAsync();
