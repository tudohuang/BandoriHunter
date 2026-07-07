/**
 * 把本機 data/bandori.db 的資料整批推上 Turso（首次雲端部署用）。
 *
 * 用法（PowerShell）：
 *   $env:TURSO_DATABASE_URL="libsql://xxx.turso.io"
 *   $env:TURSO_AUTH_TOKEN="eyJ..."
 *   npx tsx scripts/push-to-turso.mts
 */
import Database from 'better-sqlite3';
import { createClient, type InStatement } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !url.startsWith('libsql')) {
  console.error('請先設定 TURSO_DATABASE_URL（libsql://…）與 TURSO_AUTH_TOKEN');
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = new Database(path.join(ROOT, 'data', 'bandori.db'), { readonly: true });
const remote = createClient({ url, authToken });

// 建表（沿用 core/db.ts 的 schema）
process.env.TURSO_DATABASE_URL = url;
const { ready } = await import('../src/core/db.js');
await ready();

async function pushTable(table: string, columns: string[]): Promise<void> {
  const rows = local.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all() as any[];
  console.log(`${table}: ${rows.length} rows`);
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const stmts: InStatement[] = rows.slice(i, i + BATCH).map((r) => ({ sql, args: columns.map((c) => r[c]) }));
    await remote.batch(stmts, 'write');
    process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log();
}

await pushTable('items', [
  'id', 'source', 'source_id', 'url', 'title', 'title_norm', 'price', 'status', 'condition', 'image',
  'jan', 'shop_info', 'series', 'note', 'category', 'tags', 'adult', 'first_seen', 'last_seen', 'wished',
]);
await pushTable('price_history', ['id', 'item_id', 'price', 'status', 'seen_at']);
await pushTable('watches', ['id', 'keyword', 'created_at']);
await pushTable('meta', ['key', 'value']);

const { computeTagFacets } = await import('../src/core/db.js');
await computeTagFacets();
console.log('✓ 完成。Turso 上的資料已就緒。');
