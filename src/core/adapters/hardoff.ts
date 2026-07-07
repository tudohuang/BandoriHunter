import * as cheerio from 'cheerio';
import { httpGet } from '../http.js';
import type { Adapter, RawItem, SearchPage } from '../types.js';

const BASE = 'https://netmall.hardoff.co.jp';

export const hardoff: Adapter = {
  source: 'hardoff',
  displayName: 'ハードオフ・ホビーオフ ネットモール',
  minInterval: 3000,

  async search(keyword: string, page: number): Promise<SearchPage> {
    const url = `${BASE}/search/?q=${encodeURIComponent(keyword)}${page > 1 ? `&p=${page}` : ''}`;
    const { status, text } = await httpGet(url, { referer: BASE + '/', minInterval: this.minInterval });
    if (status !== 200) throw new Error(`hardoff: HTTP ${status}`);
    const $ = cheerio.load(text);

    const items: RawItem[] = [];
    $('.itemcolmn_item').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a[href*="/product/"]').first();
      const href = link.attr('href') ?? '';
      const m = href.match(/\/product\/(\d+)/);
      if (!m) return;
      const name = $el.find('.item-name').text().trim();
      const brand = $el.find('.item-brand-name').text().trim();
      const code = $el.find('.item-code').text().trim();
      const priceText = $el.find('.item-price-en').text().replace(/[^\d]/g, '');
      const img = $el.find('.item-img-square img').attr('src') ?? null;
      const rank = $el.find('.item-price-icon img').attr('alt')?.trim() || null;
      items.push({
        source: 'hardoff',
        sourceId: m[1],
        url: href.startsWith('http') ? href : BASE + href,
        title: name + (brand && brand !== '不明' ? ` [${brand}]` : ''),
        price: priceText ? Number(priceText) : null,
        status: 'instock', // NetMall removes sold items from listings
        condition: rank ? `ランク${rank.toUpperCase()}` : null,
        image: img && img.startsWith('http') ? img : img ? BASE + img : null,
        jan: null,
        shopInfo: null,
        series: null,
        note: code || null,
        searchText: [brand, code].filter(Boolean).join(' '),
      });
    });

    const hasNext = $(`a[href*="p=${page + 1}"]`).length > 0;
    return { items, total: null, hasNext };
  },
};
