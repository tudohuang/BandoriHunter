import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { crawl, liveSearch } from '../core/crawler.js';
import * as D from '../core/db.js';
import { CATEGORIES } from '../core/categorize.js';
import { SOURCE_NAMES, type CrawlReport, type Source, type Stock } from '../core/types.js';
import { UA } from '../core/http.js';

export const CLOUD = !!process.env.VERCEL;

const crawlState = { running: false, startedAt: null as string | null, log: [] as string[], lastReport: null as CrawlReport | null };

export async function runCrawl(opts: { full?: boolean } = {}): Promise<void> {
  if (crawlState.running) return;
  Object.assign(crawlState, { running: true, startedAt: new Date().toISOString(), log: [] });
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
  'static.mercdn.net': 'https://jp.mercari.com/',
  'assets.mercari-shops-static.com': 'https://jp.mercari.com/',
};
const imgCache = new Map<string, { type: string; body: Buffer }>();

async function serveImage(u: string, res: Response): Promise<void> {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return void res.status(400).end();
  }
  const referer = IMG_REFERERS[url.host] ?? (url.host.endsWith('.imageflux.jp') ? 'https://netmall.hardoff.co.jp/' : null);
  if (!referer || url.protocol !== 'https:') return void res.status(403).end();
  const key = crypto.createHash('sha1').update(u).digest('hex');
  let img = imgCache.get(key);
  if (!img) {
    const r = await fetch(u, {
      headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return void res.status(502).end();
    img = { type: r.headers.get('content-type') ?? 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) };
    if (imgCache.size >= 300) imgCache.delete(imgCache.keys().next().value!);
    imgCache.set(key, img);
  }
  res.setHeader('Content-Type', img.type);
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
  res.end(img.body);
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const list = (v: unknown) => str(v)?.split(',');

function cachePublic(res: Response, browserSeconds: number, edgeSeconds = browserSeconds, staleSeconds = edgeSeconds): void {
  res.setHeader('Cache-Control', `public, max-age=${browserSeconds}, s-maxage=${edgeSeconds}, stale-while-revalidate=${staleSeconds}`);
}

function errorStatus(message: string): number {
  return /reads?\s+blocked|read\s+limit|overages/i.test(message) ? 429 : 500;
}

const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    const message = (e as Error).message ?? String(e);
    const status = errorStatus(message);
    if (status === 429) res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({
      error:
        status === 429
          ? 'Database reads are blocked by the Turso quota. Enable overages, upgrade the plan, or wait for the monthly reset.'
          : message,
    });
  });

function itemQueryFrom(q: Request['query']): D.QueryOptions {
  return {
    q: str(q.q),
    source: list(q.source) as Source[] | undefined,
    category: list(q.category),
    tag: str(q.tag),
    status: q.status as Stock | undefined,
    minPrice: q.minPrice ? Number(q.minPrice) : undefined,
    maxPrice: q.maxPrice ? Number(q.maxPrice) : undefined,
    sinceHours: q.sinceHours ? Number(q.sinceHours) : undefined,
    wished: q.wished === '1',
    sort: (str(q.sort) as D.QueryOptions['sort']) ?? 'newest',
    limit: Math.min(Number(q.limit) || 60, 200),
    offset: Number(q.offset) || 0,
  };
}

async function compareItems(q: string, status?: Stock) {
  const sources = Object.keys(SOURCE_NAMES) as Source[];
  const per = await Promise.all(sources.map((src) => D.queryItems({ q, source: [src], status, sort: 'price_asc', limit: 1 })));
  const summary = Object.fromEntries(sources.map((src, i) => [src, { count: per[i].total, cheapest: per[i].items[0] ?? null }]));
  return { summary, ...(await D.queryItems({ q, status, sort: 'price_asc', limit: 120 })) };
}

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  if (!CLOUD) app.use(express.static(path.join(D.ROOT, 'public')));

  app.get('/img', h((req, res) => serveImage(String(req.query.u ?? ''), res)));

  app.get('/api/items', h(async (req, res) => {
    const data = await D.queryItems(itemQueryFrom(req.query));
    cachePublic(res, 30, 300, 600);
    res.json(data);
  }));

  app.get('/api/facets', h(async (_req, res) => {
    const data = { ...(await D.facets()), allCategories: CATEGORIES };
    cachePublic(res, 600, 1800, 3600);
    res.json(data);
  }));

  app.get('/api/compare', h(async (req, res) => {
    const q = str(req.query.q)?.trim();
    if (!q) return res.status(400).json({ error: 'q required' });
    const status = req.query.instock === '1' ? ('instock' as const) : undefined;
    const data = await compareItems(q, status);
    cachePublic(res, 120, 300, 600);
    res.json(data);
  }));

  app.get('/api/stats', h(async (_req, res) => {
    const data = {
      ...(await D.stats()),
      sourceNames: SOURCE_NAMES,
      crawlIntervalHours: Number((await D.getMeta('crawl_interval_hours')) ?? 3),
      discordWebhookSet: !!(await D.getMeta('discord_webhook')),
      baselineDone: (await D.getMeta('baseline_done')) === '1',
      cloudMode: CLOUD,
    };
    cachePublic(res, 60, 300, 600);
    res.json(data);
  }));

  app.get('/api/item/:id', h(async (req, res) => {
    const item = await D.getItem(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'not found' });
    const data = { item, history: await D.priceHistory(item.id), similar: await D.similarItems(item.id) };
    cachePublic(res, 120, 600, 1200);
    res.json(data);
  }));

  app.post('/api/wishlist/:id', h(async (req, res) => res.json(await D.setWished(Number(req.params.id), true).then(() => ({ ok: true })))));
  app.delete('/api/wishlist/:id', h(async (req, res) => res.json(await D.setWished(Number(req.params.id), false).then(() => ({ ok: true })))));

  app.get('/api/watches', h(async (_req, res) => res.json(await D.listWatches())));
  app.post('/api/watches', h(async (req, res) => {
    const kw = String(req.body?.keyword ?? '').trim();
    if (!kw) return res.status(400).json({ error: 'keyword required' });
    await D.addWatch(kw);
    res.json({ ok: true });
  }));
  app.delete('/api/watches/:id', h(async (req, res) => res.json(await D.removeWatch(Number(req.params.id)).then(() => ({ ok: true })))));

  app.post('/api/live', h(async (req, res) => {
    const kw = String(req.body?.keyword ?? '').trim();
    if (!kw) return res.status(400).json({ error: 'keyword required' });
    res.json(await liveSearch(kw, { sources: req.body?.sources, pages: Number(req.body?.pages) || 1 }));
  }));

  app.post('/api/crawl', h((req, res) => {
    if (CLOUD) return res.status(501).json({ error: '雲端版由 GitHub Actions 每小時自動更新，無法手動掃站' });
    if (crawlState.running) return res.status(409).json({ error: '掃站進行中' });
    void runCrawl({ full: !!req.body?.full });
    res.json({ ok: true });
  }));
  app.get('/api/crawl/status', (_req, res) => res.json(crawlState));

  app.post('/api/config', h(async (req, res) => {
    for (const key of ['discord_webhook', 'crawl_interval_hours'])
      if (req.body?.[key] != null) await D.setMeta(key, String(req.body[key]));
    res.json({ ok: true });
  }));

  return app;
}

export function startServer(opts: { port: number; schedule: boolean }): void {
  buildApp().listen(opts.port, async () => {
    console.log(`\n🎸 Bandori Hunter 已啟動 → http://localhost:${opts.port}\n`);
    if (!opts.schedule) return;
    const hours = Number((await D.getMeta('crawl_interval_hours')) ?? 3);
    console.log(`排程掃站：每 ${hours} 小時（可在「資料與設定」分頁調整）`);
    setInterval(() => void runCrawl(), hours * 3600_000);
    // 開機後若超過間隔沒掃過，5 秒後自動補掃一次
    const last = await D.getMeta('last_crawl');
    if ((await D.getMeta('baseline_done')) === '1' && (!last || Date.now() - Date.parse(last) > hours * 3600_000))
      setTimeout(() => void runCrawl(), 5000);
  });
}
