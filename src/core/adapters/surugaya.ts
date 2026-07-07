import * as cheerio from 'cheerio';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { ROOT } from '../db.js';
import { toast } from '../notify.js';
import type { Adapter, RawItem, SearchPage } from '../types.js';
import { NeedsAuthError } from './errors.js';

export { NeedsAuthError };

const BASE = 'https://www.suruga-ya.jp';
const PROFILE_DIR = path.join(ROOT, 'data', 'ff-profile');

/**
 * 駿河屋策略：Cloudflare 對自動化瀏覽器每個新 session 都會出互動挑戰，
 * cookie 無法跨 session 重用。因此改為「活 session」：
 * 開一個「有頭」Firefox 視窗常駐（可縮小），第一次由使用者手點通過，
 * 同一個 session 內之後的所有請求都靜默通過。視窗關掉 = session 重來。
 */
let ctx: BrowserContext | null = null;
let sessionVerified = false;
let lastRequest = 0;
let authFailedUntil = 0;
const MIN_INTERVAL = 4000;
const AUTH_COOLDOWN = 10 * 60_000;
const CLICK_WAIT_MS = 120_000;

async function getContext(): Promise<BrowserContext> {
  if (ctx) {
    try {
      ctx.pages(); // throws if browser was closed by user
    } catch {
      ctx = null;
      sessionVerified = false;
    }
  }
  if (!ctx) {
    const { firefox } = await import('playwright');
    ctx = await firefox.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      locale: 'ja-JP',
      viewport: { width: 1100, height: 800 },
    });
    sessionVerified = false;
    ctx.on('close', () => {
      ctx = null;
      sessionVerified = false;
    });
  }
  return ctx;
}

export async function closeSurugaya(): Promise<void> {
  if (ctx) await ctx.close().catch(() => {});
  ctx = null;
  sessionVerified = false;
}

function isChallenge(title: string): boolean {
  return /しばらくお待ちください|just a moment|セキュリティ検証/i.test(title);
}

async function waitForPass(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.isClosed()) return false;
    if (!isChallenge(await page.title().catch(() => ''))) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function fetchHtml(url: string, retry = 1): Promise<string> {
  if (!sessionVerified && Date.now() < authFailedUntil) throw new NeedsAuthError();
  const wait = lastRequest + MIN_INTERVAL - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  const context = await getContext();
  try {
    return await fetchWithPage(context, url);
  } catch (e) {
    // 視窗被使用者關掉 → 重開一次再試
    if (retry > 0 && /closed/i.test((e as Error).message)) {
      ctx = null;
      sessionVerified = false;
      return fetchHtml(url, retry - 1);
    }
    throw e;
  }
}

async function fetchWithPage(context: BrowserContext, url: string): Promise<string> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (isChallenge(await page.title())) {
      if (sessionVerified) {
        // session 中途被重新挑戰：短暫等待自動通過
        if (!(await waitForPass(page, 15000))) {
          sessionVerified = false;
          throw new NeedsAuthError();
        }
      } else {
        // 請使用者到視窗點一下
        toast('駿河屋人機驗證', '請到 Firefox 視窗點「私はロボットではありません」（等你 2 分鐘）');
        await page.bringToFront().catch(() => {});
        console.error('[surugaya] 等待人工驗證中… 請到 Firefox 視窗點勾選框（最多 2 分鐘）');
        if (!(await waitForPass(page, CLICK_WAIT_MS))) {
          authFailedUntil = Date.now() + AUTH_COOLDOWN;
          throw new NeedsAuthError();
        }
      }
    }
    sessionVerified = true;
    authFailedUntil = 0;
    await page.waitForTimeout(600);
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

/** 開視窗建立 session 並讓使用者通過驗證；session 保持開啟（供同進程後續爬取） */
export async function authSurugaya(): Promise<boolean> {
  try {
    await fetchHtml(`${BASE}/search?search_word=${encodeURIComponent('バンドリ')}`);
    return true;
  } catch (e) {
    if (e instanceof NeedsAuthError) return false;
    throw e;
  }
}

export function parseSearchHtml(html: string): SearchPage {
  const $ = cheerio.load(html);
  const items: RawItem[] = [];
  const seen = new Set<string>();

  $('a[href*="/product/detail/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') ?? '';
    const m = href.match(/\/product\/detail\/([A-Za-z0-9]+)/);
    if (!m) return;
    const id = m[1];
    const title = $a.text().replace(/\s+/g, ' ').trim() || $a.attr('title')?.trim() || '';
    if (!title || title.length < 3) return; // image-only links etc.
    if (seen.has(id)) return;
    seen.add(id);

    // find enclosing card: nearest ancestor whose text contains a price marker
    let $card = $a.parent();
    for (let depth = 0; depth < 6; depth++) {
      const t = $card.text();
      if (/[￥¥][\d,]+|品切れ/.test(t) && $card.find('a[href*="/product/detail/"]').length <= 3) break;
      if (!$card.parent().length) break;
      $card = $card.parent();
    }
    const cardText = $card.text().replace(/\s+/g, ' ');

    let price: number | null = null;
    let condition: string | null = null;
    const used = cardText.match(/中古[：:]?\s*[￥¥]([\d,]+)/);
    const brandNew = cardText.match(/新品[：:]?\s*[￥¥]([\d,]+)/);
    const any = cardText.match(/[￥¥]([\d,]+)/);
    if (used) {
      price = Number(used[1].replace(/,/g, ''));
      condition = '中古';
    } else if (brandNew) {
      price = Number(brandNew[1].replace(/,/g, ''));
      condition = '新品';
    } else if (any) {
      price = Number(any[1].replace(/,/g, ''));
    }
    const soldout = /品切れ/.test(cardText) && price == null;

    let image = $card.find('img').first().attr('src') ?? $card.find('img').first().attr('data-src') ?? null;
    if (image && image.startsWith('/')) image = BASE + image;

    items.push({
      source: 'surugaya',
      sourceId: id,
      url: `${BASE}/product/detail/${id}`,
      title,
      price,
      status: soldout ? 'soldout' : price != null ? 'instock' : 'unknown',
      condition,
      image,
      jan: /^\d{13}$/.test(id) && id.startsWith('4') ? id : null,
      shopInfo: null,
      series: null,
      note: null,
    });
  });

  const totalM = $('body').text().match(/([\d,]+)\s*件\s*(中|が見つかりました|の商品)/);
  const total = totalM ? Number(totalM[1].replace(/,/g, '')) : null;
  const hasNext = $('a[href*="page="]').filter((_, a) => /次|>|next/i.test($(a).text())).length > 0
    || items.length >= 24;
  return { items, total, hasNext };
}

export const surugaya: Adapter = {
  source: 'surugaya',
  displayName: '駿河屋',
  minInterval: MIN_INTERVAL,

  async search(keyword: string, page: number): Promise<SearchPage> {
    const url = `${BASE}/search?search_word=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`;
    const html = await fetchHtml(url);
    return parseSearchHtml(html);
  },
};
