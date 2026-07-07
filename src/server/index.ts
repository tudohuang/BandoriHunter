import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { crawl, liveSearch } from '../core/crawler.js';
import {
  facets,
  getItem,
  getMeta,
  listWatches,
  addWatch,
  removeWatch,
  priceHistory,
  queryItems,
  ROOT,
  setMeta,
  setWished,
  similarItems,
  stats,
} from '../core/db.js';
import { CATEGORIES } from '../core/categorize.js';
import type { CrawlReport, Source, Stock } from '../core/types.js';
import { SOURCE_NAMES } from '../core/types.js';
import { UA } from '../core/http.js';

export const CLOUD = !!process.env.VERCEL;

interface CrawlState {
  running: boolean;
  startedAt: string | null;
  log: string[];
  lastReport: CrawlReport | null;
}
const crawlState: CrawlState = { running: false, startedAt: null, log: [], lastReport: null };

export async function runCrawl(opts: { full?: boolean } = {}): Promise<void> {
  if (crawlState.running) return;
  crawlState.running = true;
  crawlState.startedAt = new Date().toISOString();
  crawlState.log = [];
  try {
    crawlState.lastReport = await crawl({
      ...opts,
      onLog: (m) => {
        crawlState.log.push(m);
        if (crawlState.log.length > 400) crawlState.log.shift();
        console.log(m);
      },
    });
  } catch (e) {
    crawlState.log.push('掃站失敗：' + (e as Error).message);
  } finally {
    crawlState.running = false;
  }
}

/** 圖片代理：各站防外連（referer 檢查），由後端帶正確 referer 抓；記憶體快取 + CDN cache header */
const IMG_REFERERS: Record<string, string> = {
  'content.bookoff.co.jp': 'https://shopping.bookoff.co.jp/',
  'img.lashinbang.com': 'https://shop.lashinbang.com/',
  'images.groobee.com': 'https://ec1.k-books.co.jp/',
  'www.suruga-ya.jp': 'https://www.suruga-ya.jp/',
  'static.mercdn.net': 'https://jp.mercari.com/',
  'assets.mercari-shops-static.com': 'https://jp.mercari.com/',
};
function imgReferer(host: string): string | null {
  if (IMG_REFERERS[host]) return IMG_REFERERS[host];
  if (host.endsWith('.imageflux.jp')) return 'https://netmall.hardoff.co.jp/';
  return null;
}
const imgCache = new Map<string, { type: string; body: Buffer }>();
const IMG_CACHE_MAX = 300;

async function serveImage(u: string, res: express.Response): Promise<void> {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    res.status(400).end();
    return;
  }
  const referer = imgReferer(url.host);
  if (!referer || url.protocol !== 'https:') {
    res.status(403).end();
    return;
  }
  const key = crypto.createHash('sha1').update(u).digest('hex');
  const cached = imgCache.get(key);
  if (cached) {
    res.setHeader('Content-Type', cached.type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    res.end(cached.body);
    return;
  }
  try {
    const r = await fetch(u, {
      headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      res.status(502).end();
      return;
    }
    const body = Buffer.from(await r.arrayBuffer());
    const type = r.headers.get('content-type') ?? 'image/jpeg';
    if (imgCache.size >= IMG_CACHE_MAX) imgCache.delete(imgCache.keys().next().value!);
    imgCache.set(key, { type, body });
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    res.end(body);
  } catch {
    res.status(502).end();
  }
}

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  if (!CLOUD) app.use(express.static(path.join(ROOT, 'public')));

  app.get('/img', (req, res) => {
    void serveImage(String(req.query.u ?? ''), res);
  });

  app.get('/api/items', async (req, res) => {
    const q = req.query;
    const list = (v: unknown): string[] | undefined =>
      typeof v === 'string' && v.length ? v.split(',') : undefined;
    res.json(
      await queryItems({
        q: typeof q.q === 'string' ? q.q : undefined,
        source: list(q.source) as Source[] | undefined,
        category: list(q.category),
        tag: typeof q.tag === 'string' && q.tag ? q.tag : undefined,
        status: (q.status as Stock) || undefined,
        minPrice: q.minPrice ? Number(q.minPrice) : undefined,
        maxPrice: q.maxPrice ? Number(q.maxPrice) : undefined,
        sinceHours: q.sinceHours ? Number(q.sinceHours) : undefined,
        wished: q.wished === '1',
        sort: (q.sort as any) || 'newest',
        limit: Math.min(Number(q.limit) || 60, 200),
        offset: Number(q.offset) || 0,
      }),
    );
  });

  app.get('/api/facets', async (_req, res) => res.json({ ...(await facets()), allCategories: CATEGORIES }));

  app.get('/api/compare', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'q required' });
    const status = req.query.instock === '1' ? ('instock' as const) : undefined;
    const sources = Object.keys(SOURCE_NAMES) as Source[];
    const perSource = await Promise.all(
      sources.map((src) => queryItems({ q, source: [src], status, sort: 'price_asc', limit: 1 })),
    );
    const summary: Record<string, { count: number; cheapest: unknown }> = {};
    sources.forEach((src, i) => {
      summary[src] = { count: perSource[i].total, cheapest: perSource[i].items[0] ?? null };
    });
    const { items, total } = await queryItems({ q, status, sort: 'price_asc', limit: 120 });
    res.json({ summary, items, total });
  });

  app.get('/api/stats', async (_req, res) =>
    res.json({
      ...(await stats()),
      sourceNames: SOURCE_NAMES,
      crawlIntervalHours: Number((await getMeta('crawl_interval_hours')) ?? 3),
      discordWebhookSet: !!(await getMeta('discord_webhook')),
      baselineDone: (await getMeta('baseline_done')) === '1',
      cloudMode: CLOUD,
    }),
  );

  app.get('/api/item/:id', async (req, res) => {
    const item = await getItem(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json({ item, history: await priceHistory(item.id), similar: await similarItems(item.id) });
  });

  app.post('/api/wishlist/:id', async (req, res) => {
    await setWished(Number(req.params.id), true);
    res.json({ ok: true });
  });
  app.delete('/api/wishlist/:id', async (req, res) => {
    await setWished(Number(req.params.id), false);
    res.json({ ok: true });
  });

  app.get('/api/watches', async (_req, res) => res.json(await listWatches()));
  app.post('/api/watches', async (req, res) => {
    const kw = String(req.body?.keyword ?? '').trim();
    if (!kw) return res.status(400).json({ error: 'keyword required' });
    await addWatch(kw);
    res.json({ ok: true });
  });
  app.delete('/api/watches/:id', async (req, res) => {
    await removeWatch(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post('/api/live', async (req, res) => {
    const kw = String(req.body?.keyword ?? '').trim();
    if (!kw) return res.status(400).json({ error: 'keyword required' });
    const sources = req.body?.sources as Source[] | undefined;
    const result = await liveSearch(kw, { sources, pages: Number(req.body?.pages) || 1 });
    res.json(result);
  });

  app.post('/api/crawl', (req, res) => {
    if (CLOUD) return res.status(501).json({ error: '雲端版由 GitHub Actions 每小時自動更新，無法手動掃站' });
    if (crawlState.running) return res.status(409).json({ error: '掃站進行中' });
    void runCrawl({ full: !!req.body?.full });
    res.json({ ok: true });
  });
  app.get('/api/crawl/status', (_req, res) => res.json(crawlState));

  app.post('/api/config', async (req, res) => {
    for (const key of ['discord_webhook', 'crawl_interval_hours']) {
      if (req.body?.[key] != null) await setMeta(key, String(req.body[key]));
    }
    res.json({ ok: true });
  });

  return app;
}

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
