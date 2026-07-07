import { httpFetch } from '../http.js';
import type { Adapter, RawItem, SearchPage } from '../types.js';

const API = 'https://lashinbang-f-s.snva.jp/';
const LIMIT = 100;

interface LsbItem {
  itemid: string;
  title: string;
  url: string;
  desc: string; // 状態: 未開封 / A / B ...
  image: string;
  path: string; // グッズ:フィギュア:...
  price: number;
  narrow1: string; // 未成年者向けアイテムフラグ（'1' = 18+）
  narrow2: string; // maker
  narrow3: string; // series (tab separated)
  narrow13: string; // note
  narrow18: string; // barcode/instore code
  keyword9: string; // 出品店舗
  number6: number; // stock
}

function parseJsonp(text: string): any {
  const m = text.match(/^\s*callback\((.*)\);?\s*$/s);
  if (!m) throw new Error('lashinbang: unexpected JSONP response');
  return JSON.parse(m[1]);
}

export const lashinbang: Adapter = {
  source: 'lashinbang',
  displayName: 'らしんばん通販',
  minInterval: 2500,

  async search(keyword: string, page: number): Promise<SearchPage> {
    const params = new URLSearchParams({
      q: keyword,
      s6o: '1',
      pl: '1',
      sort: 'Number18,Score', // 新着順
      limit: String(LIMIT),
      o: String((page - 1) * LIMIT),
      n6l: '0', // include out-of-stock so we can track sold-out state
      callback: 'callback',
      controller: 'lashinbang_front',
    });
    const { status, text } = await httpFetch(`${API}?${params}`, {
      referer: 'https://shop.lashinbang.com/',
      minInterval: this.minInterval,
    });
    if (status !== 200) throw new Error(`lashinbang: HTTP ${status}`);
    const data = parseJsonp(text);
    const result = data?.kotohaco?.result;
    const info = result?.info ?? {};
    const rawItems: LsbItem[] = result?.items ?? [];

    const items: RawItem[] = rawItems.map((it) => {
      let image: string | null = it.image || null;
      if (image && !/^https?:\/\//.test(image)) image = 'https://img.lashinbang.com/' + image;
      if (image && !/\.[^./]+$/.test(image)) image = null;
      const series = (it.narrow3 ?? '').split('\t').filter(Boolean).join(' / ') || null;
      return {
        source: 'lashinbang',
        sourceId: String(it.itemid),
        url: it.url || `https://shop.lashinbang.com/products/detail/${it.itemid}`,
        title: it.title ?? '',
        price: typeof it.price === 'number' ? it.price : null,
        status: (it.number6 ?? 0) >= 1 ? 'instock' : 'soldout',
        condition: it.desc || null,
        image,
        jan: /^4\d{12}$/.test(it.narrow18 ?? '') ? it.narrow18 : null,
        shopInfo: it.keyword9 || null,
        series: [series, it.path].filter(Boolean).join(' | ') || null,
        note: it.narrow13 || null,
        searchText: [it.narrow2, it.path].filter(Boolean).join(' '),
        adult: it.narrow1 === '1', // らしんばん官方的未成年者向けアイテムフラグ
      };
    });
    const hitnum = Number(info.hitnum ?? 0);
    return { items, total: hitnum, hasNext: page * LIMIT < Math.min(hitnum, 10000) };
  },
};
