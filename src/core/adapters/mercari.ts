import crypto from 'node:crypto';
import { httpFetch } from '../http.js';
import type { Adapter, RawItem, SearchPage } from '../types.js';

const API = 'https://api.mercari.jp/v2/entities:search';
const PAGE_SIZE = 120;

/** Mercari Web API 需要 DPoP proof（自產 P-256 金鑰簽 JWT，免登入） */
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' }) as { crv: string; kty: string; x: string; y: string };

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function dpopToken(method: string, url: string): string {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    htu: url,
    htm: method,
    uuid: crypto.randomUUID(),
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return signingInput + '.' + b64url(sig);
}

interface MercariItem {
  id: string;
  name: string;
  price: string | number;
  status: string; // ITEM_STATUS_ON_SALE | ITEM_STATUS_SOLD_OUT | ITEM_STATUS_TRADING
  thumbnails: string[];
  itemType: string; // ITEM_TYPE_MERCARI | ITEM_TYPE_BEYOND (Mercari Shops)
  created: string; // unix 秒
  updated: string;
  itemConditionId?: string;
  shippingPayerId?: string; // 1=着払い 2=送料込み
  shopName?: string;
}

const CONDITIONS: Record<string, string> = {
  '1': '新品、未使用',
  '2': '未使用に近い',
  '3': '目立った傷や汚れなし',
  '4': 'やや傷や汚れあり',
  '5': '傷や汚れあり',
  '6': '全体的に状態が悪い',
};

const MIN_INTERVAL = 2500;

/**
 * メルカリ單一搜尋最多翻到 15000 件（125 頁）。完整掃站時把每個關鍵字切成價格帶各自翻，
 * 熱門詞（MyGO、Ave Mujica 都超過上限）才抓得完。價格帶寫在關鍵字尾端，例：「MyGO〔¥1000-1999〕」。
 */
const PRICE_BANDS: [number, number | null][] = [[0, 999], [1000, 1999], [2000, 3499], [3500, 5999], [6000, 11999], [12000, null]];
const BAND_RX = /〔¥(\d+)-(\d*)〕$/;
const bandKeyword = (kw: string, [lo, hi]: [number, number | null]) => `${kw}〔¥${lo}-${hi ?? ''}〕`;

function parseKeyword(raw: string): { keyword: string; priceMin?: number; priceMax?: number } {
  const m = raw.match(BAND_RX);
  if (!m) return { keyword: raw };
  return {
    keyword: raw.slice(0, m.index).trim(),
    ...(Number(m[1]) ? { priceMin: Number(m[1]) } : {}),
    ...(m[2] ? { priceMax: Number(m[2]) } : {}),
  };
}

async function searchApi(rawKeyword: string, pageToken: string): Promise<{ items: MercariItem[]; nextPageToken: string; numFound: number }> {
  const body = {
    userId: '',
    pageSize: PAGE_SIZE,
    pageToken,
    searchSessionId: crypto.randomBytes(16).toString('hex'),
    searchCondition: { ...parseKeyword(rawKeyword), sort: 'SORT_CREATED_TIME', order: 'ORDER_DESC' },
    defaultDatasets: ['DATASET_TYPE_MERCARI', 'DATASET_TYPE_BEYOND'],
    serviceFrom: 'suruga',
  };

  const { status, text } = await httpFetch(API, {
    method: 'POST',
    body: JSON.stringify(body),
    referer: 'https://jp.mercari.com/',
    minInterval: MIN_INTERVAL,
    throttleKey: 'mercari',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Platform': 'web',
      DPoP: dpopToken('POST', API),
      Origin: 'https://jp.mercari.com',
    },
  });
  if (status !== 200) throw new Error(`mercari: HTTP ${status} ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as any;
  return {
    items: data.items ?? [],
    nextPageToken: data.meta?.nextPageToken ?? '',
    numFound: Number(data.meta?.numFound ?? 0),
  };
}

function toRaw(it: MercariItem): RawItem {
  const isShop = it.itemType === 'ITEM_TYPE_BEYOND';
  return {
    source: 'mercari',
    sourceId: it.id,
    url: isShop ? `https://jp.mercari.com/shops/product/${it.id}` : `https://jp.mercari.com/item/${it.id}`,
    title: (it.name ?? '').replace(/\s+/g, ' ').trim(),
    price: it.price != null ? Number(it.price) : null,
    status: it.status === 'ITEM_STATUS_ON_SALE' ? 'instock' : 'soldout',
    condition: CONDITIONS[it.itemConditionId ?? ''] ?? '中古',
    image: it.thumbnails?.[0] ?? null,
    jan: null,
    shopInfo: isShop ? `Mercari Shops${it.shopName ? '・' + it.shopName : ''}` : null,
    series: null,
    note: it.shippingPayerId === '1' ? '着払い（送料買家付）' : it.shippingPayerId === '2' ? '送料込み' : null,
    listedAt: Number(it.created) ? new Date(Number(it.created) * 1000).toISOString() : null,
  };
}

export const mercari: Adapter = {
  source: 'mercari',
  displayName: 'メルカリ',
  minInterval: MIN_INTERVAL,
  maxPages: 125,
  completeSweep: true,

  sweepKeywords(defaults: string[], full: boolean): string[] {
    // 增量掃描只看最新幾頁，不需要切價格帶
    return full ? defaults.flatMap((kw) => PRICE_BANDS.map((b) => bandKeyword(kw, b))) : defaults;
  },

  async search(keyword: string, page: number): Promise<SearchPage> {
    // pageToken 格式 "v1:<page-1>"；第 1 頁用空字串
    const token = page <= 1 ? '' : `v1:${page - 1}`;
    const r = await searchApi(keyword, token);
    const items = r.items.map(toRaw).filter((it) => it.title);
    return { items, total: r.numFound, hasNext: !!r.nextPageToken && items.length > 0 };
  },
};
