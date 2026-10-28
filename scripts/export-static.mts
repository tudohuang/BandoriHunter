import fs from 'node:fs/promises';
import path from 'node:path';
import { CATEGORIES } from '../src/core/categorize.js';
import { db, facets, getMeta, ready, ROOT, stats } from '../src/core/db.js';
import { SOURCE_NAMES } from '../src/core/types.js';

const CHUNK_SIZE = Number(process.env.STATIC_SNAPSHOT_CHUNK_SIZE ?? 2000);
const OUT_DIR = path.join(ROOT, 'public', 'snapshot');

function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]));
}

function chunkName(index: number): string {
  return `items-${String(index).padStart(3, '0')}.json`;
}

await ready();
await fs.mkdir(OUT_DIR, { recursive: true });

const rows = (await db.execute('SELECT * FROM items ORDER BY first_seen DESC, id DESC')).rows.map((row) =>
  plainRow(row as Record<string, unknown>),
);

const chunks = Math.ceil(rows.length / CHUNK_SIZE);
for (let i = 0; i < chunks; i++) {
  const file = path.join(OUT_DIR, chunkName(i));
  await fs.writeFile(file, JSON.stringify(rows.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)));
}

const [snapshotStats, snapshotFacets, crawlIntervalHours, discordWebhook, baselineDone] = await Promise.all([
  stats(),
  facets(),
  getMeta('crawl_interval_hours'),
  getMeta('discord_webhook'),
  getMeta('baseline_done'),
]);
await fs.writeFile(
  path.join(OUT_DIR, 'meta.json'),
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    chunkSize: CHUNK_SIZE,
    chunks,
    total: rows.length,
    stats: {
      ...snapshotStats,
      sourceNames: SOURCE_NAMES,
      crawlIntervalHours: Number(crawlIntervalHours ?? 3),
      discordWebhookSet: !!discordWebhook,
      baselineDone: baselineDone === '1',
      cloudMode: true,
    },
    facets: { ...snapshotFacets, allCategories: CATEGORIES },
  }),
);

console.log(`Exported ${rows.length.toLocaleString()} items to ${path.relative(ROOT, OUT_DIR)} in ${chunks} chunks.`);
