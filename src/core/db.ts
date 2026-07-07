import { createClient, type InStatement } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ItemRow, RawItem, Source, Stock } from './types.js';
import { categorize } from './categorize.js';
import { extractTags, isAdultText, norm } from './keywords.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 雲端（Turso）或本機檔案二擇一：設了 TURSO_DATABASE_URL 就走雲端 */
export const db = (() => {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  const client = createClient({ url: 'file:' + path.join(ROOT, 'data', 'bandori.db').replace(/\\/g, '/') });
  // serve 的排程掃站與手動 crawl 可能同時寫本機檔：等鎖而不是立刻 SQLITE_BUSY
  void client.execute('PRAGMA busy_timeout = 60000').catch(() => {});
  return client;
})();

const DDL = [
  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, source_id TEXT NOT NULL,
    url TEXT NOT NULL, title TEXT NOT NULL, title_norm TEXT NOT NULL, price INTEGER,
    status TEXT NOT NULL DEFAULT 'unknown', condition TEXT, image TEXT, jan TEXT, shop_info TEXT,
    series TEXT, note TEXT, category TEXT NOT NULL DEFAULT 'その他', tags TEXT NOT NULL DEFAULT '[]',
    adult INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
    wished INTEGER NOT NULL DEFAULT 0, UNIQUE(source, source_id))`,
  'CREATE INDEX IF NOT EXISTS idx_items_title_norm ON items(title_norm)',
  'CREATE INDEX IF NOT EXISTS idx_items_first_seen ON items(first_seen)',
  'CREATE INDEX IF NOT EXISTS idx_items_category ON items(category)',
  'CREATE INDEX IF NOT EXISTS idx_items_jan ON items(jan)',
  `CREATE TABLE IF NOT EXISTS price_history (id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id), price INTEGER, status TEXT, seen_at TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_ph_item ON price_history(item_id)',
  'CREATE TABLE IF NOT EXISTS watches (id INTEGER PRIMARY KEY AUTOINCREMENT, keyword TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)',
];

let readyP: Promise<unknown> | null = null;
export const ready = (): Promise<unknown> =>
  (readyP ??= db.batch(DDL, 'write').then(() =>
    db.execute('ALTER TABLE items ADD COLUMN adult INTEGER NOT NULL DEFAULT 0').catch(() => {}),
  ));

const now = () => new Date().toISOString();
const exec = async (sql: string, args: any[] = []) => (await ready(), db.execute({ sql, args }));
const all = async <T = any>(sql: string, args: any[] = []) => (await exec(sql, args)).rows as T[];
const one = async (sql: string, args: any[] = []) => (await exec(sql, args)).rows[0] as any;
const n = (v: unknown) => Number(v);

export const getMeta = async (key: string): Promise<string | null> =>
  (await one('SELECT value FROM meta WHERE key=?', [key]))?.value ?? null;
export const setMeta = (key: string, value: string) =>
  exec('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);

export interface UpsertResult {
  id: number;
  isNew: boolean;
  priceChanged: boolean;
  oldPrice: number | null;
}

const INSERT_SQL = `INSERT INTO items (source, source_id, url, title, title_norm, price, status, condition,
  image, jan, shop_info, series, note, category, tags, adult, first_seen, last_seen) VALUES (${'?,'.repeat(17)}?)`;
const UPDATE_SQL = `UPDATE items SET url=?, title=?, title_norm=?, price=?, status=?, condition=?, image=?,
  jan=COALESCE(?, jan), shop_info=?, series=?, note=?, category=?, tags=?, adult=?, last_seen=? WHERE id=?`;
const HISTORY_SQL = 'INSERT INTO price_history(item_id, price, status, seen_at) VALUES (?,?,?,?)';

/** 批次 upsert：每批 = 1 次查既有 + 1~2 次 batch 寫入（Turso 遠端時把往返次數壓到最低） */
export async function upsertMany(raws: RawItem[]): Promise<UpsertResult[]> {
  await ready();
  if (!raws.length) return [];
  const ts = now();
  const items = raws.map((r) => {
    const matchText = [r.title, r.series, r.searchText].filter(Boolean).join(' ');
    return {
      r,
      tn: norm(matchText),
      cat: categorize(r.title, r.series),
      tags: JSON.stringify(extractTags(matchText)),
      adult: r.adult || isAdultText(matchText) ? 1 : 0,
    };
  });

  // 查既有（依 source 分組、IN 分塊）
  const existing = new Map<string, { id: number; price: number | null; status: Stock }>();
  const bySource = Map.groupBy(items, (e) => e.r.source);
  for (const [source, list] of bySource) {
    const ids = [...new Set(list.map((e) => e.r.sourceId))];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      for (const row of await all(
        `SELECT id, source_id, price, status FROM items WHERE source=? AND source_id IN (${chunk.map(() => '?').join(',')})`,
        [source, ...chunk],
      ))
        existing.set(source + ' ' + row.source_id, { id: n(row.id), price: row.price, status: row.status });
    }
  }

  const stmts: InStatement[] = [];
  const metas: ({ kind: 'i'; e: (typeof items)[0] } | { kind: 'u'; e: (typeof items)[0]; ex: { id: number; price: number | null } } | { kind: 'h' })[] = [];
  for (const e of items) {
    const { r } = e;
    const ex = existing.get(r.source + ' ' + r.sourceId);
    if (!ex) {
      stmts.push({ sql: INSERT_SQL, args: [r.source, r.sourceId, r.url, r.title, e.tn, r.price, r.status, r.condition, r.image, r.jan, r.shopInfo, r.series, r.note, e.cat, e.tags, e.adult, ts, ts] });
      metas.push({ kind: 'i', e });
    } else {
      stmts.push({ sql: UPDATE_SQL, args: [r.url, r.title, e.tn, r.price, r.status, r.condition, r.image, r.jan, r.shopInfo, r.series, r.note, e.cat, e.tags, e.adult, ts, ex.id] });
      metas.push({ kind: 'u', e, ex });
      if (ex.price !== r.price || ex.status !== r.status) {
        stmts.push({ sql: HISTORY_SQL, args: [ex.id, r.price, r.status, ts] });
        metas.push({ kind: 'h' });
      }
    }
  }
  const batch = await db.batch(stmts, 'write');

  const results: UpsertResult[] = [];
  const histories: InStatement[] = [];
  batch.forEach((br, i) => {
    const m = metas[i];
    if (m.kind === 'i') {
      const id = n(br.lastInsertRowid);
      histories.push({ sql: HISTORY_SQL, args: [id, m.e.r.price, m.e.r.status, ts] });
      results.push({ id, isNew: true, priceChanged: false, oldPrice: null });
    } else if (m.kind === 'u') {
      results.push({ id: m.ex.id, isNew: false, priceChanged: m.ex.price !== m.e.r.price, oldPrice: m.ex.price });
    }
  });
  if (histories.length) await db.batch(histories, 'write');
  return results;
}

export const upsertItem = async (raw: RawItem): Promise<UpsertResult> => (await upsertMany([raw]))[0];
export const getItem = (id: number): Promise<ItemRow | undefined> => one('SELECT * FROM items WHERE id=?', [id]);

export interface QueryOptions {
  q?: string;
  source?: Source[];
  category?: string[];
  tag?: string;
  status?: Stock;
  minPrice?: number;
  maxPrice?: number;
  sinceHours?: number;
  wished?: boolean;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'updated';
  limit?: number;
  offset?: number;
}

export async function queryItems(o: QueryOptions): Promise<{ items: ItemRow[]; total: number }> {
  const conds: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, ...a: unknown[]) => (conds.push(sql), args.push(...a));
  for (const t of o.q ? norm(o.q).split(' ').filter(Boolean) : []) add('title_norm LIKE ?', `%${t}%`);
  if (o.source?.length) add(`source IN (${o.source.map(() => '?').join(',')})`, ...o.source);
  if (o.category?.length) add(`category IN (${o.category.map(() => '?').join(',')})`, ...o.category);
  if (o.tag) add('tags LIKE ?', `%${JSON.stringify(o.tag).slice(1, -1)}%`);
  if (o.status) add('status = ?', o.status);
  if (o.minPrice != null) add('price >= ?', o.minPrice);
  if (o.maxPrice != null) add('price <= ?', o.maxPrice);
  if (o.sinceHours != null) add('first_seen >= ?', new Date(Date.now() - o.sinceHours * 3600_000).toISOString());
  if (o.wished) conds.push('wished = 1');
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const order = {
    newest: 'ORDER BY first_seen DESC, id DESC',
    updated: 'ORDER BY last_seen DESC, id DESC',
    price_asc: 'ORDER BY price IS NULL, price ASC',
    price_desc: 'ORDER BY price IS NULL, price DESC',
  }[o.sort ?? 'newest'];
  const [total, items] = await Promise.all([
    one(`SELECT COUNT(*) c FROM items ${where}`, args),
    all<ItemRow>(`SELECT * FROM items ${where} ${order} LIMIT ? OFFSET ?`, [...args, o.limit ?? 60, o.offset ?? 0]),
  ]);
  return { items, total: n(total.c) };
}

const countBy = async (col: string) =>
  Object.fromEntries((await all(`SELECT ${col} k, COUNT(*) c FROM items GROUP BY ${col} ORDER BY c DESC`)).map((r) => [r.k, n(r.c)]));

export async function facets() {
  const [sources, categories, tagsMeta] = await Promise.all([countBy('source'), countBy('category'), getMeta('facet_tags')]);
  return { sources, categories, tags: tagsMeta ? JSON.parse(tagsMeta) : await computeTagFacets() };
}

/** tags 需要全表掃描，由爬蟲跑完時預計算存進 meta（雲端才不會每次載入都掃 6 萬列） */
export async function computeTagFacets(): Promise<Record<string, number>> {
  const tags: Record<string, number> = {};
  for (const row of await all("SELECT tags FROM items WHERE tags != '[]'"))
    for (const t of JSON.parse(row.tags)) tags[t] = (tags[t] ?? 0) + 1;
  await setMeta('facet_tags', JSON.stringify(tags));
  return tags;
}

/** 跨站相似商品：同 JAN 優先，其餘同分類做字元 bigram 相似度（SQL 先用長 token 縮小候選） */
export async function similarItems(id: number, limit = 12): Promise<(ItemRow & { score: number })[]> {
  const item = await getItem(id);
  if (!item) return [];
  const out = new Map<number, ItemRow & { score: number }>();
  if (item.jan)
    for (const r of await all<ItemRow>('SELECT * FROM items WHERE jan=? AND id!=?', [item.jan, id])) out.set(r.id, { ...r, score: 1 });
  const bigrams = (s: string) => {
    const t = s.replace(/[^\p{L}\p{N}]/gu, '');
    return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
  };
  const a = bigrams(norm(item.title));
  const toks = item.title_norm.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2).sort((x, y) => y.length - x.length).slice(0, 3);
  const cands = await all<ItemRow>(
    `SELECT * FROM items WHERE id != ? AND category = ? ${toks.length ? `AND (${toks.map(() => 'title_norm LIKE ?').join(' OR ')})` : ''} LIMIT 600`,
    [id, item.category, ...toks.map((t) => `%${t}%`)],
  );
  for (const c of cands) {
    if (out.has(c.id)) continue;
    const b = bigrams(c.title_norm);
    const inter = [...a].filter((g) => b.has(g)).length;
    const score = (2 * inter) / (a.size + b.size || 1);
    if (score >= 0.45) out.set(c.id, { ...c, score });
  }
  return [...out.values()].sort((x, y) => y.score - x.score).slice(0, limit);
}

export const priceHistory = (itemId: number) =>
  all<{ price: number | null; status: string; seen_at: string }>('SELECT price, status, seen_at FROM price_history WHERE item_id=? ORDER BY seen_at', [itemId]);
export const setWished = (id: number, wished: boolean) => exec('UPDATE items SET wished=? WHERE id=?', [wished ? 1 : 0, id]);
export const listWatches = () => all<{ id: number; keyword: string; created_at: string }>('SELECT * FROM watches ORDER BY id');
export const addWatch = (keyword: string) => exec('INSERT OR IGNORE INTO watches(keyword, created_at) VALUES(?,?)', [keyword, now()]);
export const removeWatch = (id: number) => exec('DELETE FROM watches WHERE id=?', [id]);

export async function stats() {
  const [total, wished, bySource, lastCrawl] = await Promise.all([
    one('SELECT COUNT(*) c FROM items'),
    one('SELECT COUNT(*) c FROM items WHERE wished=1'),
    countBy('source'),
    getMeta('last_crawl'),
  ]);
  return { total: n(total.c), lastCrawl, bySource, wished: n(wished.c) };
}
