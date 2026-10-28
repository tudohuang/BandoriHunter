/**
 * Cloudflare Worker：public/ 的靜態檔由 assets 直接回（不經過這支程式、不算請求額度），
 * 這裡只處理：
 * - /img 圖片代理（前端直連各站 CDN 失敗時的後備；規則與 src/server/index.ts 的 serveImage 相同）
 * - /api/subs 使用者的 Discord 通知訂閱（src/core/subs.ts，存在 Turso；secrets 由 GitHub Actions 設定）
 */
import { createClient } from '@libsql/client/web';
import { handleSubs } from '../src/core/subs.ts';

let db = null;
const IMG_REFERERS = {
  'content.bookoff.co.jp': 'https://shopping.bookoff.co.jp/',
  'img.lashinbang.com': 'https://shop.lashinbang.com/',
  'images.groobee.com': 'https://ec1.k-books.co.jp/',
  'static.mercdn.net': 'https://jp.mercari.com/',
  'assets.mercari-shops-static.com': 'https://jp.mercari.com/',
  'item-shopping.c.yimg.jp': 'https://store.shopping.yahoo.co.jp/',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function serveImage(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return new Response(null, { status: 400 });
  }
  const referer = IMG_REFERERS[url.host] ?? (url.host.endsWith('.imageflux.jp') ? 'https://netmall.hardoff.co.jp/' : null);
  if (!referer || url.protocol !== 'https:') return new Response(null, { status: 403 });
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/*,*/*;q=0.8' },
    cf: { cacheEverything: true, cacheTtl: 604800 },
  });
  if (!r.ok) return new Response(null, { status: 502 });
  return new Response(r.body, {
    headers: {
      'Content-Type': r.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/img') return serveImage(url.searchParams.get('u') ?? '');
    if (url.pathname === '/api/subs' || url.pathname.startsWith('/api/subs/')) {
      if (!env.TURSO_DATABASE_URL) return Response.json({ error: '通知功能尚未設定' }, { status: 503 });
      db ??= createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
      const ip = request.headers.get('cf-connecting-ip') ?? '';
      return handleSubs(request, db, ip, url.origin);
    }
    if (url.pathname.startsWith('/api/'))
      return Response.json({ error: '公開版為唯讀，資料讀 /snapshot；完整功能請在本機 npm run serve 使用' }, { status: 404 });
    return new Response('Not found', { status: 404 });
  },
};
