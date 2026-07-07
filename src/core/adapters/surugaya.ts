import { httpFetch } from '../http.js';
import type { Adapter, RawItem, SearchPage } from '../types.js';

/**
 * 駿河屋 —— 經由「駿河屋Yahoo!店」(store.shopping.yahoo.co.jp/suruga-ya，A-Too 官方分店) 抓取。
 *
 * 本站 suruga-ya.jp（含全球站 .com）整站由 Cloudflare Turnstile 把守，挑戰結果綁
 * TLS/JS 指紋、cookie 無法跨 session 重用；先前的「有頭 Firefox 活 session」方案
 * 需要人工點驗證、已被捨棄。Yahoo 店無人機驗證、伺服器端渲染，商品碼與本站相同，
 * 且附 janCode 可跨站比價。代價：品名截斷約 50 字、只涵蓋上架到 Yahoo 的庫存。
 *
 * 頁面結構：__NEXT_DATA__ JSON，商品在 props.initialState.bff.searchResults.items
 * （鍵=頁碼，內層 '0'=分頁資訊、'1'=商品清單）。新着順=X=99，分頁=b=<1-based offset>。
 */

const STORE = 'https://store.shopping.yahoo.co.jp/suruga-ya';
const PER_PAGE = 30;

interface YItem {
  itemId: string; // "suruga-ya_630029037000"（後半=駿河屋本站商品碼）
  url: string;
  name: string;
  price: number;
  janCode?: string;
  image?: { imageUrl?: string };
}

function extract(html: string): { items: YItem[]; total: number | null; totalPage: number } {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('surugaya: __NEXT_DATA__ 不在頁面裡（版面改了？）');
  const data = JSON.parse(m[1]);
  const groups = data?.props?.initialState?.bff?.searchResults?.items ?? {};
  let items: YItem[] = [];
  let total: number | null = null;
  let totalPage = 0;
  for (const group of Object.values(groups) as Record<string, { content?: Record<string, unknown> }>[]) {
    for (const section of Object.values(group)) {
      const c = section?.content as { items?: YItem[]; total?: number; totalPage?: number } | undefined;
      if (!c) continue;
      if (Array.isArray(c.items)) items = c.items;
      if (typeof c.totalPage === 'number') {
        total = c.total ?? null;
        totalPage = c.totalPage;
      }
    }
  }
  return { items, total, totalPage };
}

function toRaw(it: YItem): RawItem | null {
  const code = it.itemId?.split('_')[1];
  if (!code || !it.name) return null;
  // 品名格式：「{新品|中古}{カテゴリ語} 題名…」（同駿河屋本站慣例）
  const cond = it.name.match(/^(新品|中古)/);
  const head = it.name.match(/^(?:新品|中古)(\S{0,20})\s/);
  return {
    source: 'surugaya',
    sourceId: code,
    url: `${STORE}/${code}.html`,
    title: it.name,
    price: typeof it.price === 'number' ? it.price : null,
    status: 'instock', // 店內搜尋只列可購買品
    condition: cond ? cond[1] : null,
    image: it.image?.imageUrl ?? null,
    jan: it.janCode || null,
    shopInfo: null,
    series: head?.[1] || null,
    note: null,
  };
}

export const surugaya: Adapter = {
  source: 'surugaya',
  displayName: '駿河屋（Yahoo!店）',
  // 實測 2s 間隔連打 ~330 頁後會被 Yahoo 斷線幾分鐘，3.5s + 多重試比較穩
  minInterval: 3500,

  async search(keyword: string, page: number): Promise<SearchPage> {
    const b = (page - 1) * PER_PAGE + 1;
    const url = `${STORE}/search.html?p=${encodeURIComponent(keyword)}&X=99${page > 1 ? `&b=${b}` : ''}`;
    const { status, text } = await httpFetch(url, { referer: STORE + '/', minInterval: this.minInterval, retries: 4 });
    if (status !== 200) throw new Error(`surugaya: HTTP ${status}`);
    const { items, total, totalPage } = extract(text);
    return {
      items: items.map(toRaw).filter((x): x is RawItem => x !== null),
      total,
      hasNext: page < totalPage,
    };
  },
};
