import * as cheerio from 'cheerio';
import { httpFetch } from '../http.js';
import type { Adapter, RawItem, SearchPage } from '../types.js';

const BASE = 'https://shopping.bookoff.co.jp';

export const bookoff: Adapter = {
  source: 'bookoff',
  displayName: 'ブックオフ公式オンラインストア',
  minInterval: 2500,

  async search(keyword: string, page: number): Promise<SearchPage> {
    const url = `${BASE}/search/keyword/${encodeURIComponent(keyword)}${page > 1 ? `?p=${page}` : ''}`;
    const { status, text } = await httpFetch(url, { referer: BASE + '/', minInterval: this.minInterval });
    if (status !== 200) throw new Error(`bookoff: HTTP ${status}`);
    const $ = cheerio.load(text);

    const items: RawItem[] = [];
    $('.productItem').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a.productItem__link, a.productItem__image').first();
      const href = link.attr('href') ?? '';
      const m = href.match(/\/(used|new)\/(\d+)/);
      if (!m) return;
      const title = $el.find('.productItem__title').text().trim();
      if (!title) return;
      const author = $el.find('.productItem__author').text().trim();
      const genre = $el
        .find('.productItem__genreItem')
        .map((_, g) => $(g).text().trim())
        .get()
        .join(' ');
      const priceText = $el.find('.productItem__price').first().text().replace(/,/g, '').match(/([\d]+)円?/);
      const stockText = $el.find('.productItem__stock').text();
      const tags = $el
        .find('.tagList .tag')
        .map((_, t) => $(t).text().trim())
        .get();
      const img = $el.find('img').first().attr('src') ?? null;
      items.push({
        source: 'bookoff',
        sourceId: m[2],
        url: href.startsWith('http') ? href : BASE + href,
        title,
        price: priceText ? Number(priceText[1]) : null,
        status: /在庫なし|品切/.test(stockText) ? 'soldout' : /在庫あり/.test(stockText) ? 'instock' : 'unknown',
        condition: tags.includes('新品') ? '新品' : tags.includes('中古') ? '中古' : m[1] === 'used' ? '中古' : null,
        image: img,
        jan: null,
        shopInfo: null,
        series: genre || null,
        note: author || null,
        searchText: author,
      });
    });

    const hasNext = $('.pagination a').filter((_, a) => $(a).text().trim() === String(page + 1)).length > 0
      || $('.pagination__next:not(.-disabled)').length > 0;
    const totalM = $('body').text().match(/([\d,]+)件中/);
    return { items, total: totalM ? Number(totalM[1].replace(/,/g, '')) : null, hasNext };
  },
};
