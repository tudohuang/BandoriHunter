/**
 * 清除同名撞車雜訊（Bandolino 鞋、LV バンドリエール包、自行車 Raychell、別的夏芽…）。
 * 先用雜訊字樣縮小範圍，再用現行 isRelevant 重判，不相關才刪。
 *
 * 本機：npx tsx scripts/clean-noise.mts
 * 雲端：設好 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 再跑同一行。
 */
import { isRelevant } from '../src/core/keywords.js';
import { computeTagFacets, db, ready } from '../src/core/db.js';

await ready();

const NOISE_SQL = [
  '自転車', '輪行', 'サイクリング', 'クロスバイク', 'マウンテンバイク',
  'london rag', 'ロンドンラグ', 'ブーティ', 'パンプス', 'レインブーツ', 'サンダル',
  '夏芽すず', '夏芽みのり', 'バニー夏芽', 'イコモチ',
  'バンドリーノ', 'バンドリール', 'バンドリーダー', 'バンドリエ',
  'シューズ', 'スニーカー', 'ヒール', 'ヴィトン', 'vuitton', 'キーポル', 'モノグラム', 'スピーディ',
];
const where = NOISE_SQL.map(() => 'title_norm LIKE ?').join(' OR ');
const rows = (await db.execute({ sql: `SELECT id, title_norm, series, title FROM items WHERE ${where}`, args: NOISE_SQL.map((w) => `%${w}%`) })).rows;

const toDelete: number[] = [];
for (const r of rows) {
  const text = [r.title_norm, r.series].filter(Boolean).join(' ');
  if (!isRelevant(String(text))) toDelete.push(Number(r.id));
}
console.log(`掃到 ${rows.length} 筆可疑，重判後要刪 ${toDelete.length} 筆`);
for (const r of rows.filter((x) => toDelete.includes(Number(x.id))).slice(0, 10)) console.log('  DEL', String(r.title).slice(0, 65));

for (let i = 0; i < toDelete.length; i += 500) {
  const ids = toDelete.slice(i, i + 500).join(',');
  await db.execute(`DELETE FROM price_history WHERE item_id IN (${ids})`);
  await db.execute(`DELETE FROM items WHERE id IN (${ids})`);
}
if (toDelete.length) {
  await computeTagFacets();
  console.log('✓ 已刪除並重算標籤統計。');
}
process.exit(0);
