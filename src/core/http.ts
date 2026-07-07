/** Polite HTTP client: per-host throttling, retry with backoff, browser-like headers. */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const lastRequest = new Map<string, number>();
const queues = new Map<string, Promise<void>>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** serialize + throttle requests per key (host) */
async function throttle(key: string, minInterval: number): Promise<void> {
  const prev = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  queues.set(key, prev.then(() => next));
  await prev;
  const wait = (lastRequest.get(key) ?? 0) + minInterval - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest.set(key, Date.now());
  release();
}

export interface GetOptions {
  referer?: string;
  headers?: Record<string, string>;
  minInterval?: number;
  retries?: number;
  throttleKey?: string;
}

export async function httpGet(url: string, opts: GetOptions = {}): Promise<{ status: number; text: string }> {
  const u = new URL(url);
  const key = opts.throttleKey ?? u.host;
  const minInterval = opts.minInterval ?? 2500;
  const retries = opts.retries ?? 2;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(key, minInterval);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja-JP,ja;q=0.9',
          ...(opts.referer ? { Referer: opts.referer } : {}),
          ...(opts.headers ?? {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(45000),
      });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${u.host}`);
        await sleep(3000 * (attempt + 1));
        continue;
      }
      return { status: res.status, text };
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
