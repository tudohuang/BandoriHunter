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
  updated: string;
}

const MIN_INTERVAL = 2500;

async function searchApi(keyword: string, pageToken: string): Promise<{ items: MercariItem[]; nextPageToken: string; numFound: number }> {
  const body = {
    userId: '',
    pageSize: PAGE_SIZE,
    pageToken,
    searchSessionId: crypto.randomBytes(16).toString('hex'),
    searchCondition: { keyword, sort: 'SORT_CREATED_TIME', order: 'ORDER_DESC' },
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
    condition: '中古',
    image: it.thumbnails?.[0] ?? null,
    jan: null,
    shopInfo: isShop ? 'Mercari Shops' : null,
    series: null,
    note: null,
  };
}

export const mercari: Adapter = {
  source: 'mercari',
  displayName: 'メルカリ',
  minInterval: MIN_INTERVAL,

  async search(keyword: string, page: number): Promise<SearchPage> {
    // pageToken 格式 "v1:<page-1>"；第 1 頁用空字串
    const token = page <= 1 ? '' : `v1:${page - 1}`;
    const r = await searchApi(keyword, token);
    const items = r.items.map(toRaw).filter((it) => it.title);
    return { items, total: r.numFound, hasNext: !!r.nextPageToken && items.length > 0 };
  },
};
