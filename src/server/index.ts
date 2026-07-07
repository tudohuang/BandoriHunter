import { getMeta } from '../core/db.js';
import { buildApp, runCrawl } from './app.js';

export function startServer(opts: { port: number; schedule: boolean }): void {
  const app = buildApp();
  app.listen(opts.port, async () => {
    console.log(`\n🎸 Bandori Hunter 已啟動 → http://localhost:${opts.port}\n`);
    if (opts.schedule) {
      const hours = Number((await getMeta('crawl_interval_hours')) ?? 3);
      console.log(`排程掃站：每 ${hours} 小時（可在「資料與設定」分頁調整）`);
      setInterval(() => void runCrawl(), hours * 3600_000);
      // 開機後若超過間隔沒掃過，5 秒後自動補掃一次
      const last = await getMeta('last_crawl');
      if ((await getMeta('baseline_done')) === '1' && (!last || Date.now() - Date.parse(last) > hours * 3600_000)) {
        setTimeout(() => void runCrawl(), 5000);
      }
    }
  });
}
