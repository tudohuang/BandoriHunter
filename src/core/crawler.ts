import { getAdapters, NeedsAuthError, withSurugaya } from './adapters/index.js';
import { computeTagFacets, getItem, getMeta, listWatches, setMeta, upsertMany } from './db.js';
import { DEFAULT_SWEEP, isRelevant, norm } from './keywords.js';
import { notifyNewItems } from './notify.js';
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
  log: (msg: string) => void,
): Promise<{ report: CrawlSiteReport; newIds: number[]; baseline: boolean }> {
  // baseline 以「站」為單位：駿河屋可能晚點才通過驗證，屆時它自己跑完整模式
  const baseline = (await getMeta(`baseline_${adapter.source}`)) !== '1';
  const full = forceFull ?? baseline;
  const maxPages = maxPagesOpt ?? (full ? 60 : 5);
  const report: CrawlSiteReport = { source: adapter.source, found: 0, added: 0, priceChanged: 0, errors: [] };
  const newIds: number[] = [];
  const kws = adapter.sweepKeywords ? adapter.sweepKeywords(keywords) : keywords;
  const seenIds = new Set<string>();
  let authFailed = false;

  for (const kw of kws) {
    if (authFailed) break;
    let page = 1;
    let staleStreak = 0;
    while (page <= maxPages) {
      let result;
      try {
        result = await adapter.search(kw, page);
      } catch (e) {
        if (e instanceof NeedsAuthError) {
          report.errors.push(e.message);
          authFailed = true;
          break; // 整站放棄，等使用者驗證（不標記 baseline 完成）
        }
        report.errors.push(`「${kw}」p${page}: ${(e as Error).message}`);
        break;
      }
      const fresh = relevantOnly(result.items).filter((it) => !seenIds.has(it.sourceId));
      for (const it of fresh) seenIds.add(it.sourceId);
      report.found += fresh.length;

      const results = await upsertMany(fresh);
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
      page++;
    }
  }
  if (!authFailed && baseline) await setMeta(`baseline_${adapter.source}`, '1');
  return { report, newIds, baseline: baseline && !authFailed };
}

export async function crawl(opts: CrawlOptions = {}): Promise<CrawlReport> {
  const startedAt = new Date().toISOString();
  const log = opts.onLog ?? ((m: string) => console.log(m));
  const keywords = opts.keywords?.length ? opts.keywords : DEFAULT_SWEEP;
  await withSurugaya();
  const adapters = getAdapters(opts.sources);

  log(`開始掃站：${adapters.map((a) => a.source).join(', ')}`);
  const settled = await Promise.allSettled(
    adapters.map((a) => crawlSite(a, keywords, opts.full, opts.maxPages, log)),
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

  const newItems = (await Promise.all(notifyIds.map((id) => getItem(id)))).filter(Boolean) as ItemRow[];

  // 通知：非首次、非 quiet，比對關注關鍵字
  if (!opts.quiet && newItems.length) {
    const watches = await listWatches();
    const matched = watches
      .map((w) => ({
        keyword: w.keyword,
        items: newItems.filter((it) => {
          const toks = norm(w.keyword).split(' ').filter(Boolean);
          return toks.every((t) => it.title_norm.includes(t) || it.tags.includes(t));
        }),
      }))
      .filter((m) => m.items.length);
    await notifyNewItems(matched);
  }

  await setMeta('baseline_done', '1');
  await setMeta('last_crawl', new Date().toISOString());
  await computeTagFacets(); // 預計算標籤統計，網頁端讀 meta 不掃全表

  const allNew = (await Promise.all(allNewIds.map((id) => getItem(id)))).filter(Boolean) as ItemRow[];
  return { startedAt, finishedAt: new Date().toISOString(), sites, newItems: allNew, baseline };
}

/** 即時搜尋：各站同時查（每站最多 pages 頁），寫入 DB 並回傳結果 */
export async function liveSearch(
  keyword: string,
  opts: { sources?: Source[]; pages?: number } = {},
): Promise<{ items: ItemRow[]; errors: { source: Source; message: string }[] }> {
  await withSurugaya();
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

  const items = (await Promise.all(ids.map((id) => getItem(id)))).filter(Boolean) as ItemRow[];
  // 依關鍵字過濾（各站搜尋寬鬆度不同，統一在本地把關）
  const toks = norm(keyword).split(' ').filter(Boolean);
  const filtered = items.filter((it) => toks.every((t) => it.title_norm.includes(t)));
  return { items: filtered.length ? filtered : items, errors };
}
