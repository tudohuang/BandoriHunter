import type { Adapter, Source } from '../types.js';
import { bookoff } from './bookoff.js';
import { hardoff } from './hardoff.js';
import { kbooks } from './kbooks.js';
import { lashinbang } from './lashinbang.js';
import { mercari } from './mercari.js';

export const adapters: Adapter[] = [lashinbang, kbooks, hardoff, bookoff, mercari];

/**
 * 駿河屋需要 Playwright（有頭瀏覽器 + 人工驗證），只在本機環境動態載入；
 * 雲端（Vercel / NO_SURUGAYA=1）永遠不 import playwright。
 */
let surugayaTried = false;
export async function withSurugaya(): Promise<void> {
  if (process.env.VERCEL || process.env.NO_SURUGAYA) return;
  if (surugayaTried) return;
  surugayaTried = true;
  try {
    const m = await import('./surugaya.js');
    adapters.push(m.surugaya);
  } catch {
    // playwright 未安裝等情況：跳過駿河屋
  }
}

export async function closeSurugaya(): Promise<void> {
  if (process.env.VERCEL || process.env.NO_SURUGAYA) return;
  try {
    const m = await import('./surugaya.js');
    await m.closeSurugaya();
  } catch {
    /* not loaded */
  }
}

export function getAdapters(sources?: Source[]): Adapter[] {
  if (!sources?.length) return adapters;
  return adapters.filter((a) => sources.includes(a.source));
}

export { NeedsAuthError } from './errors.js';
