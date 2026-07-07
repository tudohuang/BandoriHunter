import { execFile } from 'node:child_process';
import { getMeta } from './db.js';
import type { ItemRow } from './types.js';
import { SOURCE_NAMES } from './types.js';

const SOURCE_COLORS: Record<string, number> = {  lashinbang: 0xe94f8a,
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

export async function discord(content: string, items: ItemRow[] = []): Promise<void> {
  const webhook = await getMeta('discord_webhook');
  if (!webhook) return;
  const embeds = items.slice(0, 10).map((it) => ({
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
