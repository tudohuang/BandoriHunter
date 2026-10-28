/**
 * 使用者自訂的 Discord 新品通知訂閱：/api/subs 的處理邏輯。
 * 只用 Web 標準 API（fetch、crypto.subtle、Request/Response），Cloudflare Worker 與本機 Express 共用；
 * 資料存在同一個 libSQL（Turso）的 subscriptions 表，掃站端（crawler.ts）讀出來比對新品後發送。
 *
 * 安全模型：
 * - 註冊時先對 webhook 發一則確認訊息，發得出去才收（webhook 網址本身就是秘密，能拿到的人才有權限）
 * - 回傳一次性的管理 token，DB 只存 SHA-256；之後讀取/修改/刪除都要帶 `Authorization: Bearer <token>`
 * - 同一個 webhook 重新註冊會覆蓋舊的（遺失 token 時的補救），每個 IP 每天限建數量、總數有上限
 */

export interface SqlClient {
  execute(stmt: { sql: string; args?: unknown[] } | string): Promise<{ rows: Record<string, unknown>[]; rowsAffected: number }>;
}

export const SUBS_DDL = `CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, webhook TEXT NOT NULL UNIQUE, keywords TEXT NOT NULL,
  ip_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_sent_at TEXT, fail_count INTEGER NOT NULL DEFAULT 0)`;

export const WEBHOOK_RX = /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,100}$/;
export const MAX_KEYWORDS = 10;
const MAX_KEYWORD_LEN = 40;
const MAX_SUBS = 2000;
const MAX_PER_IP_PER_DAY = 5;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const fail = (status: number, error: string) => json({ error }, status);

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** webhook 只露出頭尾，給使用者確認是哪一個 */
export const maskWebhook = (w: string) => w.replace(/(\/webhooks\/\d{3})\d+\/(.{4}).*(.{4})$/, '$1…/$2…$3');

/** 正規化關鍵字清單：去空白、去重、限制數量與長度；回傳錯誤訊息或清單 */
export function cleanKeywords(input: unknown): string[] | string {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,，、]/) : [];
  const out = [...new Set(raw.map((k) => String(k).replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!out.length) return '至少要一個關鍵字';
  if (out.length > MAX_KEYWORDS) return `關鍵字最多 ${MAX_KEYWORDS} 個`;
  if (out.some((k) => k.length > MAX_KEYWORD_LEN)) return `每個關鍵字最多 ${MAX_KEYWORD_LEN} 字`;
  if (out.some((k) => !k.split(' ').some((t) => t && !t.startsWith('-')))) return '關鍵字不能只有排除詞';
  return out;
}

export async function postDiscord(webhook: string, body: unknown): Promise<Response> {
  return fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}

let ready: Promise<unknown> | null = null;

async function authed(db: SqlClient, id: string, req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const row = (await db.execute({ sql: 'SELECT * FROM subscriptions WHERE id=?', args: [id] })).rows[0];
  if (!row || row.token_hash !== (await sha256(token))) return null;
  return row;
}

const view = (row: Record<string, unknown>) => ({
  id: row.id,
  webhook: maskWebhook(String(row.webhook)),
  keywords: JSON.parse(String(row.keywords)),
  createdAt: row.created_at,
  lastSentAt: row.last_sent_at ?? null,
});

/**
 * 路由：POST /api/subs（建立/覆蓋）、GET|PUT|DELETE /api/subs/:id、POST /api/subs/:id/test
 * siteUrl 用在確認訊息裡的管理連結。
 */
export async function handleSubs(req: Request, db: SqlClient, ip: string, siteUrl: string): Promise<Response> {
  ready ??= db.execute(SUBS_DDL);
  await ready;
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/subs(?:\/([\w-]{8,64}))?(\/test)?\/?$/);
  if (!m) return fail(404, 'not found');
  const [, id, test] = m;
  const now = new Date().toISOString();
  const body = req.method === 'POST' || req.method === 'PUT' ? await req.json().catch(() => ({})) : {};

  if (!id && req.method === 'POST') {
    const webhook = String((body as any).webhook ?? '').trim();
    if (!WEBHOOK_RX.test(webhook)) return fail(400, 'Webhook 網址格式不對，應該像 https://discord.com/api/webhooks/123…/abc…');
    const keywords = cleanKeywords((body as any).keywords);
    if (typeof keywords === 'string') return fail(400, keywords);

    const existing = (await db.execute({ sql: 'SELECT id FROM subscriptions WHERE webhook=?', args: [webhook] })).rows[0];
    if (!existing) {
      const ipHash = await sha256(ip + now.slice(0, 10));
      const [{ c: total }] = (await db.execute('SELECT COUNT(*) c FROM subscriptions')).rows as { c: number }[];
      if (Number(total) >= MAX_SUBS) return fail(503, '訂閱人數已達上限，請稍後再試');
      const dayAgo = new Date(Date.now() - 86400_000).toISOString();
      const [{ c: mine }] = (await db.execute({ sql: 'SELECT COUNT(*) c FROM subscriptions WHERE ip_hash=? AND created_at>=?', args: [ipHash, dayAgo] })).rows as { c: number }[];
      if (Number(mine) >= MAX_PER_IP_PER_DAY) return fail(429, '今天建立太多訂閱了，明天再試');
    }

    // 先確認 webhook 真的能用（同時證明呼叫者持有它）
    const res = await postDiscord(webhook, {
      content: `✅ **Bandori Hunter 通知已設定**\n之後有新品上架符合這些關鍵字時會通知這個頻道：${keywords.map((k) => `「${k}」`).join('、')}\n管理或取消：${siteUrl}/?tab=notify`,
    }).catch(() => null);
    if (!res || !res.ok) return fail(400, `Discord 沒有接受這個 webhook（${res ? 'HTTP ' + res.status : '連線失敗'}），請確認網址正確、webhook 沒被刪除`);

    const newId = existing ? String(existing.id) : crypto.randomUUID();
    const token = randomHex(24);
    const tokenHash = await sha256(token);
    if (existing)
      await db.execute({ sql: 'UPDATE subscriptions SET token_hash=?, keywords=?, updated_at=?, fail_count=0 WHERE id=?', args: [tokenHash, JSON.stringify(keywords), now, newId] });
    else
      await db.execute({
        sql: 'INSERT INTO subscriptions (id, token_hash, webhook, keywords, ip_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        args: [newId, tokenHash, webhook, JSON.stringify(keywords), await sha256(ip + now.slice(0, 10)), now, now],
      });
    return json({ id: newId, token, keywords, webhook: maskWebhook(webhook), replaced: !!existing }, existing ? 200 : 201);
  }

  if (!id) return fail(405, 'method not allowed');
  const row = await authed(db, id, req);
  if (!row) return fail(404, '找不到這個訂閱，或管理 token 不對（可以用同一個 webhook 重新設定）');

  if (test && req.method === 'POST') {
    const res = await postDiscord(String(row.webhook), { content: '🔔 Bandori Hunter 測試通知：設定正常。' }).catch(() => null);
    return res?.ok ? json({ ok: true }) : fail(400, `Discord 回應 ${res ? 'HTTP ' + res.status : '連線失敗'}，webhook 可能已被刪除`);
  }
  if (req.method === 'GET') return json(view(row));
  if (req.method === 'PUT') {
    const keywords = cleanKeywords((body as any).keywords);
    if (typeof keywords === 'string') return fail(400, keywords);
    await db.execute({ sql: 'UPDATE subscriptions SET keywords=?, updated_at=? WHERE id=?', args: [JSON.stringify(keywords), now, id] });
    return json(view({ ...row, keywords: JSON.stringify(keywords) }));
  }
  if (req.method === 'DELETE') {
    await db.execute({ sql: 'DELETE FROM subscriptions WHERE id=?', args: [id] });
    return json({ ok: true });
  }
  return fail(405, 'method not allowed');
}
