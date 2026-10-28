import { execFile } from 'node:child_process';
import { getMeta, markSubFailed, markSubSent, matchesKeyword, type Subscription } from './db.js';
import { postDiscord } from './subs.js';
import type { ItemRow } from './types.js';
import { SOURCE_NAMES } from './types.js';

const SOURCE_COLORS: Record<string, number> = {
  surugaya: 0x1971c2,
  lashinbang: 0xe94f8a,
  hardoff: 0x1db34f,
  bookoff: 0xf5a623,
  kbooks: 0x8e44ad,
  mercari: 0xff2d55,
};

/** Windows 原生 toast（WinRT via PowerShell），非 Windows 靜默略過 */
export function toast(title: string, message: string): void {
  if (process.platform !== 'win32') return;
  const esc = (s: string) =>
    s.replace(/[&<>"'`$]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '', "'": '’', '`': '', $: '' }[c] ?? '')).slice(0, 180);
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml("<toast><visual><binding template='ToastGeneric'><text>${esc(title)}</text><text>${esc(message)}</text></binding></visual></toast>")
$appid = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appid).Show((New-Object Windows.UI.Notifications.ToastNotification $x))`;
  try {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => {});
  } catch {
    // toast is best-effort
  }
}

const embedsOf = (items: ItemRow[]) =>
  items.slice(0, 10).map((it) => ({
    title: it.title.slice(0, 240),
    url: it.url,
    color: SOURCE_COLORS[it.source] ?? 0x999999,
    thumbnail: it.image ? { url: it.image } : undefined,
    fields: [
      { name: '價格', value: it.price != null ? `¥${it.price.toLocaleString()}` : '—', inline: true },
      { name: '來源', value: SOURCE_NAMES[it.source], inline: true },
      { name: '分類', value: it.category, inline: true },
    ],
  }));

export async function discord(content: string, items: ItemRow[] = []): Promise<void> {
  // GitHub Actions 用 secret DISCORD_WEBHOOK_URL；本機用 `config discord_webhook` 存在 DB
  const webhook = process.env.DISCORD_WEBHOOK_URL || (await getMeta('discord_webhook'));
  if (!webhook) return;
  const embeds = embedsOf(items);
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900), embeds }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error('[notify] discord webhook failed:', (e as Error).message);
  }
}

/** 新品命中通知（toast + discord） */
export async function notifyNewItems(matched: { keyword: string; items: ItemRow[] }[]): Promise<void> {
  for (const { keyword, items } of matched) {
    if (!items.length) continue;
    const head = items[0];
    const more = items.length > 1 ? ` 等 ${items.length} 件` : '';
    toast(
      `🎸 新上架：${keyword}`,
      `${SOURCE_NAMES[head.source]} ¥${head.price?.toLocaleString() ?? '?'} ${head.title.slice(0, 60)}${more}`,
    );
    await discord(`🎸 **關注「${keyword}」有 ${items.length} 件新上架**`, items);
  }
}

export const SITE_URL = process.env.SITE_URL ?? 'https://bandori-hunter.bangdreamapp947.workers.dev';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 使用者訂閱（網站上自己填的 webhook）：每個訂閱一次掃站最多一則訊息，列出各關鍵字命中數、附最多 10 張商品卡。
 * Discord 限流（429）照 retry_after 等；webhook 已刪除（401/404）累計失敗，3 次後移除訂閱。
 */
export async function notifySubscribers(subs: Subscription[], items: ItemRow[]): Promise<number> {
  let sent = 0;
  for (const sub of subs) {
    const hits = sub.keywords.map((k) => ({ k, items: items.filter((it) => matchesKeyword(it, k)) })).filter((h) => h.items.length);
    if (!hits.length) continue;
    const matched = [...new Map(hits.flatMap((h) => h.items).map((it) => [it.id, it])).values()];
    const content =
      `🎸 **有 ${matched.length} 件新上架符合你的關注**：${hits.map((h) => `「${h.k}」${h.items.length} 件`).join('、')}
` +
      `看全部：${SITE_URL}/?tab=new&q=${encodeURIComponent(hits[0].k)}　管理通知：${SITE_URL}/?tab=notify`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await postDiscord(sub.webhook, { content: content.slice(0, 1900), embeds: embedsOf(matched) }).catch(() => null);
      if (res?.status === 429) {
        const wait = Number((await res.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 2);
        await sleep(Math.min(30, wait) * 1000);
        continue;
      }
      if (res?.ok) {
        await markSubSent(sub.id);
        sent++;
      } else if (res && (res.status === 401 || res.status === 404)) await markSubFailed(sub.id);
      break;
    }
    await sleep(400); // 對 Discord 客氣一點
  }
  return sent;
}
