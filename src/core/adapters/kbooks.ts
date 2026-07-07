import { httpFetch } from '../http.js';
import { norm } from '../keywords.js';
import type { Adapter, RawItem, SearchPage } from '../types.js';

const API = 'https://shop.api.groobee.com/products/search';
const SITE = 'https://ec1.k-books.co.jp';
const PER_PAGE = 100;

interface KbProduct {
  id: number;
  code: string;
  slug: string;
  price: number;
  name: string;
  imageUrl: string;
  isSoldOut: boolean;
  isAvailable: boolean;
}

async function query(keyword: string, page: number, perPage: number): Promise<{ products: KbProduct[]; total: number }> {
  const params = new URLSearchParams({
    keyword,
    is_sale: 'false',
    per_page: String(perPage),
    current_page: String(page),
  });
  const { status, text } = await httpFetch(`${API}?${params}`, {
    referer: SITE + '/',
    minInterval: 2500,
    throttleKey: 'kbooks',
    headers: {
      Accept: 'application/json',
      'x-bet-site-code': 'ec1k-books',
      authorization: 'Bearer',
      'x-requested-with': 'XMLHttpRequest',
    },
  });
  if (status !== 200) throw new Error(`kbooks: HTTP ${status}`);
  const data = JSON.parse(text);
  return { products: data?._embedded?.products ?? [], total: Number(data?.total ?? 0) };
}

function toRaw(p: KbProduct): RawItem {
  return {
    source: 'kbooks',
    sourceId: String(p.id),
    url: `${SITE}/products/${encodeURIComponent(p.slug)}`,
    title: p.name.replace(/\s+/g, ' ').trim(),
    price: typeof p.price === 'number' ? p.price : null,
    status: p.isSoldOut ? 'soldout' : 'instock',
    condition: '中古',
    image: p.imageUrl || null,
    jan: null,
    shopInfo: null,
    series: null,
    note: p.code || null,
    searchText: p.code,
  };
}

/**
 * K-Books 的搜尋只比對正式商品名開頭（商品名都以「BanG Dream!」起頭），
 * 搜「バンドリ」會 0 筆。策略：先用原關鍵字查，0 筆時 fallback 用
 * 「BanG Dream」查並以本地過濾。
 */
export const kbooks: Adapter = {
  source: 'kbooks',
  displayName: 'K-BOOKS 通販',
  minInterval: 2500,

  sweepKeywords() {
    return ['BanG Dream'];
  },

  async search(keyword: string, page: number): Promise<SearchPage> {
    let kw = keyword;
    let filter: string[] | null = null;
    let r = await query(kw, page, PER_PAGE);
    if (r.total === 0 && !/bang\s*dream/i.test(keyword)) {
      kw = 'BanG Dream';
      filter = norm(keyword).split(' ').filter(Boolean);
      r = await query(kw, page, PER_PAGE);
    }
    let items = r.products.map(toRaw);
    if (filter) {
      items = items.filter((it) => {
        const t = norm(it.title);
        return filter!.every((tok) => t.includes(tok));
      });
    }
    return { items, total: filter ? null : r.total, hasNext: page * PER_PAGE < r.total };
  },
};
