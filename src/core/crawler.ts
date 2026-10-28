import { getAdapters } from './adapters/index.js';
import { computeTagFacets, getItems, getMeta, listSubscriptions, listWatches, markUnseenSold, matchesKeyword, setMeta, upsertMany } from './db.js';
import { DEFAULT_SWEEP, isRelevant, norm } from './keywords.js';
import { notifyNewItems, notifySubscribers } from './notify.js';
import type { Adapter, CrawlReport, CrawlSiteReport, ItemRow, RawItem, Source } from './types.js';

export interface CrawlOptions {
  sources?: Source[];
  keywords?: string[];
  /** full = 首次建庫，翻到底；否則掃前幾頁抓新品 */
  full?: boolean;
  maxPages?: number;
  onLog?: (msg: string) => void;
  /** 掃完後不發通知（首次建庫自動不通知） */
  quiet?: boolean;
}

function relevantOnly(items: RawItem[]): RawItem[] {
  return items.filter((it) => isRelevant([it.title, it.series, it.searchText].filter(Boolean).join(' ')));
}

async function crawlSite(
  adapter: Adapter,
  keywords: string[],
  forceFull: boolean | undefined,
  maxPagesOpt: number | undefined,
  defaultKeywords: boolean,
  log: (msg: string) => void,
): Promise<{ report: CrawlSiteReport; newIds: number[]; baseline: boolean }> {
  // baseline 以「站」為單位：新加入的站第一次自動跑完整模式
  const baseline = (await getMeta(`baseline_${adapter.source}`)) !== '1';
  const full = forceFull ?? baseline;
  const maxPages = maxPagesOpt ?? (full ? (adapter.maxPages ?? 60) : 5);
  const report: CrawlSiteReport = { source: adapter.source, found: 0, added: 0, priceChanged: 0, errors: [] };
  const newIds: number[] = [];
  const kws = adapter.sweepKeywords ? adapter.sweepKeywords(keywords, full) : keywords;
  const sweepStart = new Date().toISOString();
  const seenIds = new Set<string>();

  for (const kw of kws) {
    let page = 1;
    let staleStreak = 0;
    while (page <= maxPages) {
      let result;
      try {
        result = await adapter.search(kw, page);
      } catch (e) {
        report.errors.push(`「${kw}」p${page}: ${(e as Error).message}`);
        break;
      }
      const fresh = relevantOnly(result.items).filter((it) => !seenIds.has(it.sourceId));
      for (const it of fresh) seenIds.add(it.sourceId);
      report.found += fresh.length;

      const results = await upsertMany(fresh, full);
      let pageNew = 0;
      for (const r of results) {
        if (r.isNew) {
          report.added++;
          pageNew++;
          newIds.push(r.id);
        } else if (r.priceChanged) {
          report.priceChanged++;
        }
      }
      log(`[${adapter.source}] 「${kw}」第 ${page} 頁：${fresh.length} 件相關（新 ${pageNew}）`);

      if (!result.hasNext || result.items.length === 0) break;
      // 增量掃描：連續兩頁沒有新品就換下一個關鍵字（結果通常按新著排序）
      if (!full) {
        staleStreak = pageNew === 0 ? staleStreak + 1 : 0;
        if (staleStreak >= 2) break;
      }
      if (full && page >= maxPages) {
        report.truncated = true;
        log(`[${adapter.source}] 「${kw}」翻到 ${maxPages} 頁上限仍有下一頁`);
      }
      page++;
    }
  }
  // 預設關鍵字的完整掃站若完整無誤，之前有貨、這次沒再出現的就是被刪除/下架了
  if (full && adapter.completeSweep && defaultKeywords && !report.truncated && !report.errors.length)
    report.delisted = await markUnseenSold(adapter.source, sweepStart);
  if (baseline) await setMeta(`baseline_${adapter.source}`, '1');
  return { report, newIds, baseline };
}

function watchMatches(watches: { keyword: string }[], items: ItemRow[]) {
  return watches
    .map((w) => ({
      keyword: w.keyword,
      items: items.filter((it) => matchesKeyword(it, w.keyword)),
    }))
    .filter((m) => m.items.length);
}

export async function crawl(opts: CrawlOptions = {}): Promise<CrawlReport> {
  const startedAt = new Date().toISOString();
  const log = opts.onLog ?? ((m: string) => console.log(m));
  const keywords = opts.keywords?.length ? opts.keywords : DEFAULT_SWEEP;
  const adapters = getAdapters(opts.sources);

  log(`開始掃站：${adapters.map((a) => a.source).join(', ')}`);
  const settled = await Promise.allSettled(
    adapters.map((a) => crawlSite(a, keywords, opts.full, opts.maxPages, !opts.keywords?.length, log)),
  );

  const sites: CrawlSiteReport[] = [];
  const allNewIds: number[] = [];
  const notifyIds: number[] = []; // 首次建庫的站不算「新上架」，不通知
  let baseline = false;
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      sites.push(s.value.report);
      allNewIds.push(...s.value.newIds);
      if (s.value.baseline) baseline = true;
      else notifyIds.push(...s.value.newIds);
    } else {
      sites.push({ source: adapters[i].source, found: 0, added: 0, priceChanged: 0, errors: [String(s.reason)] });
    }
  });

  // 完整掃站會翻到以前沒抓到的舊品，它們不是「新上架」：有上架時間的看 48 小時內，沒有的只在增量掃站通知
  const recent = Date.now() - 48 * 3600_000;
  const newItems = (await getItems(notifyIds)).filter((it) =>
    it.listed_at ? Date.parse(it.listed_at) >= recent : !opts.full,
  );

  // 通知：非首次、非 quiet，比對站長的關注關鍵字與使用者訂閱
  if (!opts.quiet && newItems.length) {
    const watches = await listWatches();
    await notifyNewItems(watchMatches(watches, newItems));
    const sent = await notifySubscribers(await listSubscriptions(), newItems);
    if (sent) log(`已通知 ${sent} 個訂閱`);
  }

  await setMeta('baseline_done', '1');
  await setMeta('last_crawl', new Date().toISOString());
  await computeTagFacets(); // 預計算標籤統計，網頁端讀 meta 不掃全表

  const allNew = await getItems(allNewIds);
  return { startedAt, finishedAt: new Date().toISOString(), sites, newItems: allNew, baseline };
}

/** 即時搜尋：各站同時查（每站最多 pages 頁），寫入 DB 並回傳結果 */
export async function liveSearch(
  keyword: string,
  opts: { sources?: Source[]; pages?: number } = {},
): Promise<{ items: ItemRow[]; errors: { source: Source; message: string }[] }> {
  const adapters = getAdapters(opts.sources);
  const pages = opts.pages ?? 1;
  const errors: { source: Source; message: string }[] = [];
  const ids: number[] = [];

  await Promise.allSettled(
    adapters.map(async (a) => {
      try {
        for (let p = 1; p <= pages; p++) {
          const r = await a.search(keyword, p);
          const rel = relevantOnly(r.items);
          for (const u of await upsertMany(rel)) ids.push(u.id);
          if (!r.hasNext) break;
        }
      } catch (e) {
        errors.push({ source: a.source, message: (e as Error).message });
      }
    }),
  );

  const items = await getItems(ids);
  // 依關鍵字過濾（各站搜尋寬鬆度不同，統一在本地把關）
  const toks = norm(keyword).split(' ').filter(Boolean);
  const filtered = items.filter((it) => toks.every((t) => it.title_norm.includes(t)));
  return { items: filtered.length ? filtered : items, errors };
}
