/**
 * 把本機 data/bandori.db 的資料整批推上 Turso（首次雲端部署用）。
 *
 * 用法（PowerShell）：
 *   $env:TURSO_DATABASE_URL="libsql://xxx.turso.io"
 *   $env:TURSO_AUTH_TOKEN="eyJ..."
 *   npx tsx scripts/push-to-turso.mts
 */
import { createClient, type InStatement } from '@libsql/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.TURSO_DATABASE_URL;
if (!url || !url.startsWith('libsql')) {
  console.error('請先設定 TURSO_DATABASE_URL（libsql://…）與 TURSO_AUTH_TOKEN');
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = createClient({ url: 'file:' + path.join(ROOT, 'data', 'bandori.db').replace(/\\/g, '/') });

// 建表（db.ts 會讀 TURSO_DATABASE_URL 連上遠端）
const { ready, db: remote, computeTagFacets } = await import('../src/core/db.js');
await ready();

/** 跨海連線會偶發 ECONNRESET；INSERT OR REPLACE 冪等，直接重試整個 batch */
async function batchWithRetry(stmts: InStatement[], retries = 5): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await remote.batch(stmts, 'write');
      return;
    } catch (e) {
      if (attempt >= retries) throw e;
      const wait = 2000 * (attempt + 1);
      process.stdout.write(`\r  ⚠ ${(e as Error).message.slice(0, 40)}，${wait / 1000}s 後重試（${attempt + 1}/${retries}）…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function pushTable(table: string, columns: string[]): Promise<void> {
  const r = await local.execute(`SELECT ${columns.join(',')} FROM ${table}`);
  const rows = r.rows as any[];
  console.log(`${table}: ${rows.length} rows`);
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const stmts: InStatement[] = rows.slice(i, i + BATCH).map((row) => ({ sql, args: columns.map((c) => row[c]) }));
    await batchWithRetry(stmts);
    process.stdout.write(`\r  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log();
}

// 完整鏡像：先清空遠端（price_history 有 FK 指向 items，REPLACE 刪舊列會撞 FK；
// 也順便洗掉雲端自己爬進去的雜訊）。watches/meta 保留 REPLACE 合併。
console.log('清空遠端 price_history / items（以本機為準完整鏡像）…');
await remote.execute('DELETE FROM price_history');
await remote.execute('DELETE FROM items');

await pushTable('items', [
  'id', 'source', 'source_id', 'url', 'title', 'title_norm', 'price', 'status', 'condition', 'image',
  'jan', 'shop_info', 'series', 'note', 'category', 'tags', 'adult', 'first_seen', 'last_seen', 'wished',
]);
await pushTable('price_history', ['id', 'item_id', 'price', 'status', 'seen_at']);
await pushTable('watches', ['id', 'keyword', 'created_at']);
await pushTable('meta', ['key', 'value']);

await computeTagFacets();
console.log('✓ 完成。Turso 上的資料已就緒。');
