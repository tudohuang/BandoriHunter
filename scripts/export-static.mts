/**
 * 匯出公開站用的靜態快照（public/snapshot/）。GitHub Actions 每次掃完站跑一次再部署到 Vercel。
 * 瘦身原則：售完且超過 SOLD_KEEP_DAYS 沒再出現的品項不輸出（行情參考只留近期成交）；
 * null 欄位與 title_norm/wished 不輸出（前端自己算/存）；有變過價的品項附上精簡價格紀錄 h。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CATEGORIES } from '../src/core/categorize.js';
import { db, getMeta, ready, ROOT, stats } from '../src/core/db.js';
import { SOURCE_NAMES } from '../src/core/types.js';

/** 每個分塊涵蓋的 id 區間寬度 */
const CHUNK_SIZE = Number(process.env.STATIC_SNAPSHOT_CHUNK_SIZE ?? 4000);
const SOLD_KEEP_DAYS = Number(process.env.STATIC_SOLD_KEEP_DAYS ?? 90);
const HISTORY_MAX = 24;
const OUT_DIR = path.join(ROOT, 'public', 'snapshot');
const DROP_FIELDS = new Set(['title_norm', 'wished']);
const TIME_FIELDS = new Set(['first_seen', 'last_seen', 'listed_at']);

/** 可由 source_id 推回的網址不輸出（public/app.js 的 itemUrl 是同一份規則） */
const URL_RULES: Record<string, (id: string) => string> = {
  mercari: (id) => (id.startsWith('m') ? `https://jp.mercari.com/item/${id}` : `https://jp.mercari.com/shops/product/${id}`),
  lashinbang: (id) => `https://shop.lashinbang.com/products/detail/${id}`,
  surugaya: (id) => `https://store.shopping.yahoo.co.jp/suruga-ya/${id}.html`,
  bookoff: (id) => `https://shopping.bookoff.co.jp/used/${id}`,
  hardoff: (id) => `https://netmall.hardoff.co.jp/product/${id}/`,
};

function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || DROP_FIELDS.has(key)) continue;
    if (key === 'adult' && !value) continue;
    if (key === 'tags' && value === '[]') continue;
    if (key === 'url' && URL_RULES[String(row.source)]?.(String(row.source_id)) === value) continue;
    // ISO 字串 → unix 秒，前端載入時轉回；last_seen 取整到天，不然每次掃站每個分塊都會變、快取全失效
    if (TIME_FIELDS.has(key)) {
      const sec = Math.floor(Date.parse(String(value)) / 1000);
      out[key] = key === 'last_seen' ? sec - (sec % 86400) : sec;
    } else out[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return out;
}

await ready();
await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });

const soldCutoff = new Date(Date.now() - SOLD_KEEP_DAYS * 86400_000).toISOString();
const rows = (
  await db.execute({
    sql: "SELECT * FROM items WHERE status != 'soldout' OR last_seen >= ? ORDER BY id",
    args: [soldCutoff],
  })
).rows.map((row) => plainRow(row as Record<string, unknown>));

// 價格紀錄：只收「價格真的變過」的品項，壓成 [unix 秒, 價格] 陣列
const histories = new Map<number, [number, number][]>();
for (const r of (await db.execute('SELECT item_id, price, seen_at FROM price_history WHERE price IS NOT NULL ORDER BY item_id, seen_at')).rows) {
  const id = Number(r.item_id);
  const list = histories.get(id) ?? [];
  const price = Number(r.price);
  if (list.at(-1)?.[1] !== price) list.push([Math.floor(Date.parse(String(r.seen_at)) / 1000), price]);
  histories.set(id, list);
}
let withHistory = 0;
let dropsInstock = 0;
for (const row of rows) {
  const h = histories.get(Number(row.id));
  if (h && h.length > 1) {
    row.h = h.slice(-HISTORY_MAX);
    withHistory++;
    // 與前端 prepItem 同定義：上一個不同的價格高於現價
    const older = h.filter((x) => x[1] !== row.price);
    if (row.status === 'instock' && older.length && older.at(-1)![1] > Number(row.price)) dropsInstock++;
  }
}
// 分頁徽章直接放 meta，前端不用為了算數字下載全部分塊
const newCutoff = Date.now() / 1000 - 72 * 3600;
const new72 = rows.filter((r) => Number(r.first_seen) >= newCutoff).length;

// 分塊依 id 區間（id 只增不減，新品只會落在最後一塊），檔名帶內容 hash：
// 沒變的分塊檔名不變，瀏覽器與 CDN 快取可以一直沿用，增量掃站後回訪只需重抓變動的幾塊
const buckets = Map.groupBy(rows, (row) => Math.floor(Number(row.id) / CHUNK_SIZE));
const files: { f: string; n: number }[] = [];
for (const [bucket, list] of [...buckets].sort((a, b) => a[0] - b[0])) {
  const body = JSON.stringify(list);
  const f = `items-${bucket}-${crypto.createHash('sha1').update(body).digest('hex').slice(0, 10)}.json`;
  await fs.writeFile(path.join(OUT_DIR, f), body);
  files.push({ f, n: list.length });
}
const chunks = files.length;

// 篩選欄的數字要跟快照內容一致，所以從輸出的列重算，不用 DB 全表 facets
const count = (pick: (row: Record<string, unknown>) => string[]) => {
  const out: Record<string, number> = {};
  for (const row of rows) for (const k of pick(row)) out[k] = (out[k] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};
const snapshotFacets = {
  sources: count((r) => [String(r.source)]),
  categories: count((r) => [String(r.category)]),
  tags: count((r) => (r.tags ? JSON.parse(String(r.tags)) : [])),
};
const [snapshotStats, crawlIntervalHours] = await Promise.all([stats(), getMeta('crawl_interval_hours')]);
await fs.writeFile(
  path.join(OUT_DIR, 'meta.json'),
  JSON.stringify({
    version: 4,
    generatedAt: new Date().toISOString(),
    files, // id 由小到大
    total: rows.length,
    soldKeepDays: SOLD_KEEP_DAYS,
    stats: {
      ...snapshotStats,
      total: rows.length,
      bySource: snapshotFacets.sources,
      newItems72: new72,
      dropsInstock,
      sourceNames: SOURCE_NAMES,
      crawlIntervalHours: Number(crawlIntervalHours ?? 3),
      cloudMode: true,
    },
    facets: { ...snapshotFacets, allCategories: CATEGORIES },
  }),
);

const bytes = (await Promise.all((await fs.readdir(OUT_DIR)).map((f) => fs.stat(path.join(OUT_DIR, f))))).reduce((s, f) => s + f.size, 0);
console.log(
  `Exported ${rows.length.toLocaleString()} items (${withHistory} with price history) to ${path.relative(ROOT, OUT_DIR)} in ${chunks} chunks, ${(bytes / 1e6).toFixed(1)} MB.`,
);
process.exit(0);
