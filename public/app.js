/* Bandori Hunter frontend
 * 兩種資料模式：本機 `npm run serve` 走 /api（可寫入）；公開站讀 /snapshot 靜態快照（唯讀，願望清單存在瀏覽器）。 */
'use strict';

const SRC_COLORS = {
  mercari: 'var(--c-mercari)',
  lashinbang: 'var(--c-lashinbang)',
  surugaya: 'var(--c-surugaya)',
  kbooks: 'var(--c-kbooks)',
  bookoff: 'var(--c-bookoff)',
  hardoff: 'var(--c-hardoff)',
};
const SRC_SHORT = { surugaya: '駿河屋', lashinbang: 'らしんばん', hardoff: 'HARD OFF', bookoff: 'BOOKOFF', kbooks: 'K-BOOKS', mercari: 'メルカリ' };
const ALL_SOURCES = Object.keys(SRC_COLORS);
const GRID_TABS = new Set(['browse', 'new', 'drops', 'wish']);
const LOCAL_TABS = new Set(['watch', 'system']);
const PAGE_SIZE = 60;
const STATS_REFRESH_MS = 300000;
const IS_LOCALHOST = /^(localhost|127\.|\[?::1)/.test(location.hostname);
const SNAPSHOT_WANTED = !IS_LOCALHOST || new URLSearchParams(location.search).has('snapshot');
const BAND_TAGS = ["Poppin'Party", 'Roselia', 'Afterglow', 'Pastel*Palettes', 'ハロー、ハッピーワールド！', 'RAISE A SUILEN', 'Morfonica', 'MyGO!!!!!', 'Ave Mujica', 'CRYCHIC'];
const SEIYUU_TAGS = ['愛美', '大塚紗英', '西本りみ', '大橋彩香', '伊藤彩沙', '佐倉綾音', '三澤紗千香', '加藤英美里', '日笠陽子', '金元寿子', '前島亜美', '小澤亜李', '上坂すみれ', '中上育実', '秦佐和子', '相羽あいな', '工藤晴香', '中島由貴', '櫻川めぐ', '志崎樺音', '遠藤ゆりか', '明坂聡美', '伊藤美来', '田所あずさ', '吉田有里', '豊田萌絵', '黒沢ともよ', 'Raychell', '小原莉子', '夏芽', '紡木吏佐', '倉知玲鳳', '進藤あまね', '直田姫奈', '西尾夕香', 'mika', 'Ayasa', '羊宮妃那', '立石凛', '青木陽菜', '小日向美香', '林鼓子', '佐々木李子', '渡瀬結月', '米澤茜', '岡田夢以', '高尾奏音'];

/** 公開站（快照模式）= 唯讀；init 時確定 */
let PUBLIC = false;

const state = {
  tab: 'browse',
  q: '',
  sources: new Set(ALL_SOURCES),
  categories: new Set(),
  tag: null,
  instock: false,
  minPrice: null,
  maxPrice: null,
  sort: 'newest',
  offset: 0,
  total: 0,
  items: [],
  loading: false,
  done: false,
  facets: null,
  reqId: 0,
};

/* ---------------- utils ---------------- */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const yen = (p) => (p != null ? '¥' + Number(p).toLocaleString() : '—');
/** 圖片直接從各站 CDN 載（不帶 referer，見 index.html meta），失敗才改走 /img 代理：省下 Vercel 函式呼叫與流量 */
const imgSrc = (u) => (/^https:\/\//.test(u) ? u : '/img?u=' + encodeURIComponent(u));
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.proxied || img.src.includes('/img?u=') || !/^https:/.test(img.src)) return;
  img.dataset.proxied = '1';
  e.stopImmediatePropagation(); // 先別讓卡片的 onerror 把圖換成「無圖片」
  img.src = '/img?u=' + encodeURIComponent(img.src);
}, true);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const snapNorm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const isGridTab = (tab) => GRID_TABS.has(tab);
const parseTags = (it) => { try { return JSON.parse(it.tags || '[]'); } catch { return []; } };

function readStore(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 無痕模式等：不保存 */ }
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' 分鐘前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return fmtDate(iso);
}
const fmtDate = (iso) => new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });

function toastMsg(text) {
  const t = el('div', 'toastmsg', text);
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toastMsg(okMsg);
  } catch {
    prompt('複製這個連結：', text);
  }
}

/* ---------------- coupon ---------------- */

const coupon = Object.assign({ type: 'none', value: null, cap: null, min: null }, readStore('bh_coupon', {}));

/** メルカリ在售品的券後價；不適用回傳 null */
function effPrice(it) {
  if (coupon.type === 'none' || !coupon.value || it.source !== 'mercari' || it.status === 'soldout' || it.price == null) return null;
  if (coupon.min && it.price < coupon.min) return null;
  let off = coupon.type === 'pct' ? Math.floor((it.price * coupon.value) / 100) : coupon.value;
  if (coupon.cap) off = Math.min(off, coupon.cap);
  return Math.max(0, it.price - off);
}
const sortPrice = (it) => effPrice(it) ?? it.price;

/* ---------------- wishlist ---------------- */

const wish = {
  ids: new Set(readStore('bh_wish', [])),
  has(it) {
    return PUBLIC ? this.ids.has(Number(it.id)) : !!it.wished;
  },
  async set(it, on) {
    if (PUBLIC) {
      on ? this.ids.add(Number(it.id)) : this.ids.delete(Number(it.id));
      writeStore('bh_wish', [...this.ids]);
    } else {
      await (on ? post('/api/wishlist/' + it.id, {}) : del('/api/wishlist/' + it.id));
    }
    it.wished = on ? 1 : 0;
    toastMsg(on ? '已加入願望清單' : '已移出願望清單');
    if (PUBLIC) updateWishBadge();
  },
};
function updateWishBadge() {
  if (PUBLIC) $('wishBadge').textContent = wish.ids.size || '';
}

/* ---------------- data access ---------------- */

const post = (u, d) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
const del = (u) => api(u, { method: 'DELETE' });
async function api(path, opts) {
  if (PUBLIC) {
    const snap = await snapshotApi(path, opts);
    if (snap) return snap.data;
    throw new Error('公開版不支援這個操作');
  }
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'HTTP ' + res.status);
  return res.json();
}

/* ---- 靜態快照：在瀏覽器裡實作 /api 的讀取端 ---- */

const snapshot = { meta: null, chunks: new Map(), all: null, byId: null };

async function snapshotMeta() {
  snapshot.meta ??= fetch('/snapshot/meta.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return snapshot.meta;
}

/**
 * 「降價中」：現價是近 DROP_DAYS 天內才降下來的，且低於最早記錄的價格（漲回原價不算）。
 * h = [[unix 秒, 價格], ...]（連續同價已合併）；與 scripts/export-static.mts、src/core/db.ts 同定義。
 */
const DROP_DAYS = 30;
function recentDropFrom(h, price) {
  if (h.length < 2 || price == null) return null;
  const last = h[h.length - 1];
  if (last[1] !== price || last[0] < Date.now() / 1000 - DROP_DAYS * 86400) return null;
  const prev = h[h.length - 2][1];
  return prev > price && h[0][1] > price ? prev : null;
}

/** 與 scripts/export-static.mts 的 URL_RULES 相同：可推回的網址快照不存 */
const URL_RULES = {
  mercari: (id) => (id.startsWith('m') ? `https://jp.mercari.com/item/${id}` : `https://jp.mercari.com/shops/product/${id}`),
  lashinbang: (id) => `https://shop.lashinbang.com/products/detail/${id}`,
  surugaya: (id) => `https://store.shopping.yahoo.co.jp/suruga-ya/${id}.html`,
  bookoff: (id) => `https://shopping.bookoff.co.jp/used/${id}`,
  hardoff: (id) => `https://netmall.hardoff.co.jp/product/${id}/`,
};

/** 快照省略了 null 欄位、title_norm、可推回的 url，時間存 unix 秒；載入時補回並預算搜尋字串與上一個價格 */
function prepItem(it) {
  for (const k of ['price', 'image', 'condition', 'jan', 'shop_info', 'series', 'note', 'listed_at']) it[k] ??= null;
  for (const k of ['first_seen', 'last_seen', 'listed_at']) if (typeof it[k] === 'number') it[k] = new Date(it[k] * 1000).toISOString();
  it.url ??= URL_RULES[it.source]?.(String(it.source_id)) ?? '#';
  it.tags ??= '[]';
  it.adult ??= 0;
  it._n = snapNorm(it.title + ' ' + (it.series || ''));
  it._t = snapNorm(parseTags(it).join(' '));
  it.prev_price = recentDropFrom(it.h || [], it.price);
  return it;
}

/** 分塊檔名帶內容 hash（meta.files，依 id 由小到大），沒變的分塊直接吃瀏覽器/CDN 快取 */
async function snapshotChunk(index) {
  if (!snapshot.chunks.has(index)) {
    const meta = await snapshotMeta();
    const url = `/snapshot/${meta.files[index].f}`;
    snapshot.chunks.set(index, fetch(url).then((res) => (res.ok ? res.json() : [])).catch(() => []).then((rows) => rows.map(prepItem)));
  }
  return snapshot.chunks.get(index);
}

async function snapshotAllItems() {
  snapshot.all ??= (async () => {
    const meta = await snapshotMeta();
    const parts = await Promise.all(meta.files.map((_, i) => snapshotChunk(i)));
    const items = parts.flat();
    snapshot.byId = new Map(items.map((it) => [Number(it.id), it]));
    return items;
  })();
  return snapshot.all;
}

function parseQuery(q) {
  const toks = snapNorm(q).split(' ').filter(Boolean);
  return { include: toks.filter((t) => !t.startsWith('-')), exclude: toks.filter((t) => t.startsWith('-') && t.length > 1).map((t) => t.slice(1)) };
}

function snapshotFilterItems(items, params) {
  const { include, exclude } = parseQuery(params.get('q'));
  const sources = params.get('source')?.split(',').filter(Boolean);
  const categories = params.get('category')?.split(',').filter(Boolean);
  const tag = params.get('tag') ? JSON.stringify(params.get('tag')).slice(1, -1) : null;
  const status = params.get('status');
  const minPrice = params.get('minPrice') ? Number(params.get('minPrice')) : null;
  const maxPrice = params.get('maxPrice') ? Number(params.get('maxPrice')) : null;
  const since = params.get('sinceHours') ? Date.now() - Number(params.get('sinceHours')) * 3600_000 : null;
  const wished = params.get('wished') === '1';
  const drops = params.get('drops') === '1';
  return items.filter((it) => {
    if (include.length && !include.every((t) => it._n.includes(t) || it._t.includes(t))) return false;
    if (exclude.some((t) => it._n.includes(t))) return false;
    if (sources && !sources.includes(it.source)) return false;
    if (categories && !categories.includes(it.category)) return false;
    if (tag && !it.tags.includes(tag)) return false;
    if (status && it.status !== status) return false;
    if (minPrice != null && !(it.price >= minPrice)) return false;
    if (maxPrice != null && !(it.price <= maxPrice)) return false;
    if (since != null && Date.parse(it.first_seen) < since) return false;
    if (wished && !wish.ids.has(Number(it.id))) return false;
    if (drops && !(it.prev_price > it.price)) return false;
    return true;
  });
}

function snapshotSort(items, sort) {
  const out = items.slice();
  const timeDesc = (field) => (a, b) => Date.parse(b[field] || 0) - Date.parse(a[field] || 0) || b.id - a.id;
  const rank = (it) => sortPrice(it) ?? Number.POSITIVE_INFINITY;
  if (sort === 'updated') return out.sort(timeDesc('last_seen'));
  if (sort === 'price_asc') return out.sort((a, b) => rank(a) - rank(b));
  if (sort === 'price_desc') return out.sort((a, b) => (sortPrice(b) ?? -1) - (sortPrice(a) ?? -1));
  if (sort === 'drop') return out.sort((a, b) => dropRatio(b) - dropRatio(a) || b.id - a.id);
  return out.sort(timeDesc('first_seen'));
}

const dropRatio = (it) => (it.prev_price > it.price ? (it.prev_price - it.price) / it.prev_price : 0);
const isDefaultListing = (p) =>
  ['q', 'source', 'category', 'tag', 'status', 'minPrice', 'maxPrice', 'sinceHours', 'drops'].every((k) => !p.get(k)) &&
  p.get('wished') !== '1' && (p.get('sort') || 'newest') === 'newest';

async function snapshotItems(params) {
  const meta = await snapshotMeta();
  const limit = Math.min(Number(params.get('limit')) || PAGE_SIZE, 200);
  const offset = Number(params.get('offset')) || 0;
  // 預設列表（最新收錄、無條件）：id 越大越新，從最後一塊往前讀到夠用即可，不必下載全部
  if (isDefaultListing(params) && !snapshot.byId) {
    const out = [];
    for (let i = meta.files.length - 1; i >= 0 && out.length < offset + limit; i--)
      out.push(...(await snapshotChunk(i)).slice().sort((a, b) => b.id - a.id));
    return { items: out.slice(offset, offset + limit), total: meta.total };
  }
  const items = snapshotSort(snapshotFilterItems(await snapshotAllItems(), params), params.get('sort') || 'newest');
  return { items: items.slice(offset, offset + limit), total: items.length };
}

/** 與 src/core/db.ts marketFrom 同一套算法 */
function marketFrom(rows) {
  const q = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null);
  const live = rows.filter((r) => r.price != null && r.status !== 'soldout').map((r) => r.price).sort((a, b) => a - b);
  const sold = rows.filter((r) => r.price != null && r.status === 'soldout').map((r) => r.price).sort((a, b) => a - b);
  return {
    instock: { count: live.length, min: live[0] ?? null, median: q(live, 0.5) },
    sold: { count: sold.length, p25: q(sold, 0.25), median: q(sold, 0.5), p75: q(sold, 0.75) },
    points: rows.filter((r) => r.price != null).slice(0, 2000).map((r) => [r.price, r.status === 'soldout' ? 1 : 0]),
  };
}

function bigrams(s) {
  const t = snapNorm(s).replace(/[^\p{L}\p{N}]/gu, '');
  return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
}

function snapshotSimilar(item, items) {
  const a = bigrams(item._n);
  return items
    .filter((it) => it.id !== item.id && (it.category === item.category || (item.jan && it.jan === item.jan)))
    .map((it) => {
      if (item.jan && it.jan === item.jan) return { ...it, score: 1 };
      const b = bigrams(it._n);
      const inter = [...a].filter((g) => b.has(g)).length;
      return { ...it, score: (2 * inter) / (a.size + b.size || 1) };
    })
    .filter((it) => it.score >= 0.45)
    .sort((x, y) => y.score - x.score)
    .slice(0, 12);
}

async function snapshotApi(path, opts) {
  if (opts && opts.method && opts.method !== 'GET') return null;
  const meta = await snapshotMeta();
  if (!meta) return null;
  const url = new URL(path, location.origin);
  const p = url.searchParams;
  if (url.pathname === '/api/stats') return { data: meta.stats };
  if (url.pathname === '/api/facets') return { data: meta.facets };
  if (url.pathname === '/api/items') return { data: await snapshotItems(p) };
  if (url.pathname === '/api/market') {
    p.delete('status');
    return { data: marketFrom(snapshotFilterItems(await snapshotAllItems(), p)) };
  }
  if (url.pathname === '/api/compare') {
    const rows = snapshotSort(snapshotFilterItems(await snapshotAllItems(), new URLSearchParams({ q: p.get('q') || '', status: p.get('instock') === '1' ? 'instock' : '' })), 'price_asc');
    const summary = Object.fromEntries(ALL_SOURCES.map((src) => {
      const list = rows.filter((it) => it.source === src);
      return [src, { count: list.length, cheapest: list[0] ?? null }];
    }));
    return { data: { summary, items: rows.slice(0, 150), total: rows.length } };
  }
  const m = url.pathname.match(/^\/api\/item\/(\d+)$/);
  if (m) {
    const items = await snapshotAllItems();
    const item = snapshot.byId.get(Number(m[1]));
    if (!item) throw new Error('這件商品已不在快照中（可能售完很久了）');
    const history = (item.h || []).map(([t, price]) => ({ price, seen_at: new Date(t * 1000).toISOString() }));
    return { data: { item, history, similar: snapshotSimilar(item, items) } };
  }
  return null;
}

/* ---------------- URL state（可分享連結） ---------------- */

function readUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get('tab') && (GRID_TABS.has(p.get('tab')) || p.get('tab') === 'compare' || p.get('tab') === 'notify')) state.tab = p.get('tab');
  state.q = p.get('q') || '';
  if (p.get('src')) state.sources = new Set(p.get('src').split(',').filter((s) => ALL_SOURCES.includes(s)));
  if (!state.sources.size) state.sources = new Set(ALL_SOURCES);
  if (p.get('cat')) state.categories = new Set(p.get('cat').split(','));
  state.tag = p.get('tag');
  state.instock = p.get('stock') === '1';
  state.minPrice = p.get('min') ? Number(p.get('min')) : null;
  state.maxPrice = p.get('max') ? Number(p.get('max')) : null;
  if (p.get('sort')) state.sort = p.get('sort');
  return p.get('item');
}

function syncUrl(itemId) {
  const p = new URLSearchParams();
  if (new URLSearchParams(location.search).has('snapshot')) p.set('snapshot', '');
  if (state.tab !== 'browse') p.set('tab', state.tab);
  if (state.q) p.set('q', state.q);
  if (state.sources.size < ALL_SOURCES.length) p.set('src', [...state.sources].join(','));
  if (state.categories.size) p.set('cat', [...state.categories].join(','));
  if (state.tag) p.set('tag', state.tag);
  if (state.instock) p.set('stock', '1');
  if (state.minPrice != null) p.set('min', state.minPrice);
  if (state.maxPrice != null) p.set('max', state.maxPrice);
  if (state.sort !== 'newest' && state.sort !== 'drop') p.set('sort', state.sort);
  if (itemId) p.set('item', itemId);
  const qs = p.toString().replace(/^snapshot=(&|$)/, 'snapshot$1');
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

/* ---------------- filters / query ---------------- */

function resetItems() {
  state.offset = 0;
  state.items = [];
  state.done = false;
}

function filterParams() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.sources.size < ALL_SOURCES.length) p.set('source', [...state.sources].join(','));
  if (state.categories.size) p.set('category', [...state.categories].join(','));
  if (state.tag) p.set('tag', state.tag);
  if (state.minPrice != null) p.set('minPrice', state.minPrice);
  if (state.maxPrice != null) p.set('maxPrice', state.maxPrice);
  if (state.tab === 'new') p.set('sinceHours', '72');
  if (state.tab === 'wish') p.set('wished', '1');
  if (state.tab === 'drops') p.set('drops', '1');
  return p;
}

function buildQuery() {
  const p = filterParams();
  if (state.instock) p.set('status', 'instock');
  p.set('sort', state.tab === 'new' ? 'newest' : state.sort);
  p.set('limit', String(PAGE_SIZE));
  p.set('offset', state.offset);
  return p;
}

async function loadItems(reset) {
  if (reset) {
    resetItems();
    syncUrl();
    loadMarket();
  } else if (state.loading) return;
  const req = ++state.reqId;
  state.loading = true;
  if (reset) renderSkeleton();
  const data = await api('/api/items?' + buildQuery()).catch((e) => (toastMsg('讀取失敗：' + e.message), { items: [], total: 0 }));
  if (req !== state.reqId) return; // 期間條件又變了，丟掉舊結果
  state.total = data.total;
  state.items = state.offset === 0 ? data.items : state.items.concat(data.items);
  state.offset += data.items.length;
  if (data.items.length < PAGE_SIZE) state.done = true;
  state.loading = false;
  render();
}

/* ---------------- rendering ---------------- */

function cardNode(it) {
  const sold = it.status === 'soldout';
  const card = el('article', 'card' + (sold ? ' sold' : ''));
  card.tabIndex = 0;
  const thumb = el('div', 'thumb');
  if (it.image) {
    const img = el('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = imgSrc(it.image);
    img.onerror = () => { img.remove(); thumb.prepend(el('span', 'noimg', '無圖片')); };
    thumb.appendChild(img);
  } else thumb.appendChild(el('span', 'noimg', '無圖片'));
  if (it.adult) {
    thumb.classList.add('r18');
    const cover = el('button', 'r18cover');
    cover.appendChild(el('b', null, 'R18'));
    cover.appendChild(el('span', null, '點擊顯示'));
    cover.onclick = (ev) => {
      ev.stopPropagation();
      thumb.classList.add('revealed');
      cover.remove();
    };
    thumb.appendChild(cover);
  }
  const badge = el('span', 'srcbadge', SRC_SHORT[it.source] || it.source);
  badge.style.setProperty('--src', SRC_COLORS[it.source] || '#666');
  thumb.appendChild(badge);
  if (sold) thumb.appendChild(el('span', 'soldbadge', '售完'));
  else if (it.prev_price > it.price) thumb.appendChild(el('span', 'dropbadge', '↓' + Math.round(dropRatio(it) * 100) + '%'));
  thumb.appendChild(heartBtn(it));
  card.appendChild(thumb);

  const body = el('div', 'cardbody');
  body.appendChild(el('h3', 'cardtitle', it.title));
  const priceline = el('div', 'priceline');
  priceline.appendChild(el('span', 'price' + (it.price == null ? ' free' : ''), yen(it.price)));
  if (it.prev_price > it.price) priceline.appendChild(el('s', 'was', yen(it.prev_price)));
  const eff = effPrice(it);
  if (eff != null) priceline.appendChild(el('span', 'eff', '券後 ' + yen(eff)));
  body.appendChild(priceline);
  const meta = el('div', 'cardmeta');
  if (it.condition) meta.appendChild(el('span', 'cond', it.condition));
  if (it.note === '送料込み') meta.appendChild(el('span', 'ship', '含運'));
  meta.appendChild(el('span', 'when', timeAgo(it.listed_at || it.first_seen)));
  body.appendChild(meta);
  const tags = el('div', 'cardtags');
  tags.appendChild(el('span', 'mtag', it.category));
  for (const t of parseTags(it).slice(0, 2)) tags.appendChild(el('span', 'mtag band', t));
  body.appendChild(tags);
  card.appendChild(body);
  card.onclick = () => openModal(it.id);
  card.onkeydown = (e) => e.key === 'Enter' && openModal(it.id);
  return card;
}

function heartBtn(it) {
  const on = wish.has(it);
  const heart = el('button', 'heart' + (on ? ' on' : ''));
  heart.type = 'button';
  heart.setAttribute('aria-label', on ? '移出願望清單' : '加入願望清單');
  heart.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17s-6.5-4-6.5-8.6A3.6 3.6 0 0110 6a3.6 3.6 0 016.5 2.4C16.5 13 10 17 10 17z"/></svg>';
  heart.onclick = async (ev) => {
    ev.stopPropagation();
    const next = !heart.classList.contains('on');
    try {
      await wish.set(it, next);
      heart.classList.toggle('on', next);
    } catch (e) {
      toastMsg(e.message);
    }
  };
  return heart;
}

function renderSkeleton() {
  $('grid').replaceChildren(...Array.from({ length: 12 }, () => {
    const c = el('div', 'card skel');
    c.innerHTML = '<div class="thumb"></div><div class="cardbody"><i></i><i></i><i class="short"></i></div>';
    return c;
  }));
  $('emptyState').hidden = true;
}

function render() {
  $('grid').replaceChildren(...state.items.map(cardNode));
  const label = { browse: '件商品', new: '件 72 小時內新收錄', drops: '件降價中', wish: '件在願望清單' }[state.tab] || '件';
  $('resultCount').innerHTML = `<b>${state.total.toLocaleString()}</b> ${label}`;
  $('emptyState').hidden = state.items.length > 0;
  renderActiveFilters();
}

function renderActiveFilters() {
  const box = $('activeFilters');
  box.replaceChildren();
  const pill = (text, clear) => {
    const b = el('button', 'afpill');
    b.type = 'button';
    b.innerHTML = `${esc(text)}<span aria-hidden="true">×</span>`;
    b.title = '移除條件';
    b.onclick = () => { clear(); refreshFilterUi(); loadItems(true); };
    box.appendChild(b);
  };
  $('notifyBtn').hidden = !state.q.trim() || state.tab === 'wish';
  if (state.q) pill('「' + state.q + '」', () => { state.q = ''; $('searchInput').value = ''; });
  if (state.tag) pill(state.tag, () => (state.tag = null));
  for (const c of state.categories) pill(c, () => state.categories.delete(c));
  if (state.sources.size < ALL_SOURCES.length) pill([...state.sources].map((s) => SRC_SHORT[s]).join('・'), () => (state.sources = new Set(ALL_SOURCES)));
  if (state.instock) pill('可購買', () => (state.instock = false));
  if (state.minPrice != null || state.maxPrice != null)
    pill(`${state.minPrice != null ? yen(state.minPrice) : ''}–${state.maxPrice != null ? yen(state.maxPrice) : ''}`, () => (state.minPrice = state.maxPrice = null));
}

/* ---------------- market（行情） ---------------- */

async function loadMarket() {
  const bar = $('marketBar');
  if (!isGridTab(state.tab) || state.tab === 'wish' || !(state.q || state.tag)) {
    bar.hidden = true;
    return;
  }
  const req = state.reqId + 1; // loadItems 會在之後 ++reqId
  const m = await api('/api/market?' + filterParams()).catch(() => null);
  if (req !== state.reqId || !m) return;
  bar.replaceChildren(marketNode(m, state.q || state.tag));
  bar.hidden = false;
}

function marketNode(m, label) {
  const box = el('div', 'mk');
  // 成交樣本太少時不下結論，免得 2 件售完就喊「便宜 80%」
  const verdict = m.instock.min != null && m.sold.median != null && m.sold.count >= 5
    ? (() => {
        const d = (m.instock.min - m.sold.median) / m.sold.median;
        if (d <= -0.1) return `<span class="good">在售最低比成交中位便宜 ${Math.round(-d * 100)}%</span>`;
        if (d >= 0.15) return `<span class="warn">在售最低比成交中位貴 ${Math.round(d * 100)}%，可以再等等</span>`;
        return '<span>在售最低價接近行情</span>';
      })()
    : '';
  box.innerHTML = `
    <div class="mk-head"><span class="mk-title">「${esc(label)}」行情</span>${verdict}</div>
    <div class="mk-stats">
      <div class="mk-stat"><span>在售</span><b>${m.instock.count.toLocaleString()} 件</b><small>最低 ${yen(m.instock.min)} ・ 中位 ${yen(m.instock.median)}</small></div>
      <div class="mk-stat"><span>近期售完（成交參考）</span><b>${m.sold.count ? yen(m.sold.median) : '—'}</b><small>${m.sold.count ? `中間 50%：${yen(m.sold.p25)}–${yen(m.sold.p75)} ・ ${m.sold.count.toLocaleString()} 件` : '沒有售完紀錄'}</small></div>
    </div>
    ${histogramSvg(m.points)}`;
  return box;
}

/** 價格分布直方圖：可購買 vs 售完 疊加；範圍裁掉頭尾 3% 且上限不超過中位數 5 倍，避免極端值把圖壓扁 */
function histogramSvg(points) {
  if (points.length < 4) return '';
  const prices = points.map((p) => p[0]).sort((a, b) => a - b);
  const lo = prices[Math.floor(prices.length * 0.03)];
  const hi = Math.min(prices[Math.min(prices.length - 1, Math.floor(prices.length * 0.97))], prices[Math.floor(prices.length / 2)] * 5);
  if (hi <= lo) return '';
  const BINS = 28;
  const w = (hi - lo) / BINS;
  const bins = Array.from({ length: BINS }, () => [0, 0]);
  for (const [price, sold] of points) {
    if (price < lo || price > hi) continue;
    bins[Math.min(BINS - 1, Math.floor((price - lo) / w))][sold]++;
  }
  const max = Math.max(...bins.map((b) => b[0] + b[1]));
  const W = 560, H = 72, bw = W / BINS;
  const bars = bins.map(([live, sold], i) => {
    const hs = (sold / max) * H, hl = (live / max) * H;
    const x = i * bw + 1;
    return `<rect class="h-sold" x="${x}" y="${H - hs}" width="${bw - 2}" height="${hs}"><title>${yen(Math.round(lo + i * w))}〜 售完 ${sold}</title></rect>` +
      `<rect class="h-live" x="${x}" y="${H - hs - hl}" width="${bw - 2}" height="${hl}"><title>${yen(Math.round(lo + i * w))}〜 可購買 ${live}</title></rect>`;
  }).join('');
  return `<div class="mk-hist">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="價格分布">${bars}</svg>
    <div class="mk-axis"><span>${yen(lo)}</span><span class="mk-legend"><i class="l-live"></i>可購買<i class="l-sold"></i>售完</span><span>${yen(hi)}</span></div>
  </div>`;
}

/* ---------------- facets / sidebar ---------------- */

function activeFilterCount() {
  return (ALL_SOURCES.length - state.sources.size) + state.categories.size + (state.tag ? 1 : 0) +
    (state.instock ? 1 : 0) + (state.minPrice != null ? 1 : 0) + (state.maxPrice != null ? 1 : 0);
}

function updateFilterButton() {
  const count = activeFilterCount();
  const badge = $('filterCount');
  badge.textContent = count;
  badge.hidden = count === 0;
}

function setFiltersOpen(open) {
  document.body.classList.toggle('filters-open', open);
  $('filterToggle').setAttribute('aria-expanded', String(open));
  if (open && window.innerWidth <= 900) $('filterClose').focus();
}

/** 狀態 → 側欄控制項（從網址或 pill 移除條件後同步） */
function refreshFilterUi() {
  $('instockOnly').checked = state.instock;
  $('minPrice').value = state.minPrice ?? '';
  $('maxPrice').value = state.maxPrice ?? '';
  $('sortSel').value = state.sort;
  document.querySelectorAll('#sourceFilters .srcrow').forEach((r) => r.classList.toggle('off', !state.sources.has(r.dataset.src)));
  document.querySelectorAll('#categoryChips .chip').forEach((c) => c.classList.toggle('on', state.categories.has(c.dataset.key)));
  document.querySelectorAll('#tagChips .chip, #seiyuuChips .chip').forEach((c) => c.classList.toggle('on', state.tag === c.dataset.key));
  updateFilterButton();
}

async function loadFacets() {
  state.facets = await api('/api/facets');
  const sf = $('sourceFilters');
  sf.replaceChildren();
  for (const src of ALL_SOURCES) {
    const row = el('button', 'srcrow');
    row.type = 'button';
    row.dataset.src = src;
    const dot = el('span', 'srcdot');
    dot.style.background = SRC_COLORS[src];
    row.append(dot, el('span', 'srcname', SRC_SHORT[src]), el('span', 'srccount', (state.facets.sources[src] || 0).toLocaleString()));
    row.onclick = () => {
      if (state.sources.has(src) && state.sources.size === 1) return;
      state.sources.has(src) ? state.sources.delete(src) : state.sources.add(src);
      refreshFilterUi();
      loadItems(true);
    };
    sf.appendChild(row);
  }
  const chip = (container, key, n, onclick) => {
    const c = el('button', 'chip');
    c.type = 'button';
    c.dataset.key = key;
    c.innerHTML = `${esc(key)}<small>${n.toLocaleString()}</small>`;
    c.onclick = () => { onclick(); refreshFilterUi(); loadItems(true); };
    container.appendChild(c);
  };
  const cc = $('categoryChips');
  cc.replaceChildren();
  for (const [cat, n] of Object.entries(state.facets.categories).filter(([, n]) => n > 0))
    chip(cc, cat, n, () => (state.categories.has(cat) ? state.categories.delete(cat) : state.categories.add(cat)));
  const tc = $('tagChips');
  const sc = $('seiyuuChips');
  tc.replaceChildren();
  sc.replaceChildren();
  const tags = Object.entries(state.facets.tags).sort((a, b) => b[1] - a[1]);
  const toggleTag = (tag) => () => (state.tag = state.tag === tag ? null : tag);
  const bands = tags.filter(([t]) => BAND_TAGS.includes(t));
  const chars = tags.filter(([t]) => !BAND_TAGS.includes(t) && !SEIYUU_TAGS.includes(t)).slice(0, 24);
  for (const [tag, n] of [...bands, ...chars]) chip(tc, tag, n, toggleTag(tag));
  for (const [tag, n] of tags.filter(([t]) => SEIYUU_TAGS.includes(t)).slice(0, 18)) chip(sc, tag, n, toggleTag(tag));
  refreshFilterUi();
}

async function loadStats() {
  const s = await api('/api/stats');
  const pill = $('freshPill');
  const ageH = s.lastCrawl ? (Date.now() - Date.parse(s.lastCrawl)) / 3600_000 : Infinity;
  pill.className = 'fresh ' + (ageH < 6 ? 'ok' : ageH < 48 ? 'warn' : 'stale');
  pill.querySelector('span').textContent = s.lastCrawl ? `${timeAgo(s.lastCrawl)}更新` : '尚未更新';
  pill.title = `收錄 ${s.total.toLocaleString()} 件` + (s.lastCrawl ? `｜最後掃站 ${new Date(s.lastCrawl).toLocaleString('zh-TW')}` : '');
  $('footMeta').textContent = `收錄 ${s.total.toLocaleString()} 件` + (s.lastCrawl ? `・資料更新於 ${new Date(s.lastCrawl).toLocaleString('zh-TW')}` : '') +
    (PUBLIC ? `・售完商品保留近 ${(await snapshotMeta()).soldKeepDays ?? 90} 天作為行情參考` : '');
  if (!PUBLIC) {
    const newTotal = Number(s.newItems72 ?? 0);
    $('newBadge').textContent = newTotal > 0 ? (newTotal > 999 ? '999+' : newTotal) : '';
  }
  return s;
}

/** 分頁徽章：新上架/降價數（快照模式要等全部分塊載完，所以延後背景算） */
async function loadBadges() {
  const fmt = (n) => (n > 999 ? '999+' : n || '');
  if (PUBLIC) {
    const s = (await snapshotMeta()).stats;
    $('newBadge').textContent = fmt(s.newItems72);
    $('dropBadge').textContent = fmt(s.dropsInstock);
    return;
  }
  const [fresh, drops] = await Promise.all([null, api('/api/items?drops=1&status=instock&limit=1')]).catch(() => [null, null]);
  if (fresh) $('newBadge').textContent = fmt(fresh.total);
  if (drops) $('dropBadge').textContent = fmt(drops.total);
}

/* ---------------- modal ---------------- */

async function openModal(id) {
  let data;
  try {
    data = await api('/api/item/' + id);
  } catch (e) {
    return toastMsg(e.message);
  }
  const { item, history, similar } = data;
  const m = $('modalCard');
  const tags = parseTags(item);
  const eff = effPrice(item);
  const statusLabel = item.status === 'soldout' ? '售完' : item.status === 'instock' ? '可購買' : '';
  m.innerHTML = `
    <button class="mclose icon-btn" id="mclose" aria-label="關閉">×</button>
    <div class="mhead">
      <div class="mimg${item.adult ? ' r18' : ''}">${item.image ? `<img src="${esc(imgSrc(item.image))}" alt="">` : '<span class="noimg">無圖片</span>'}${item.adult ? '<button class="r18cover"><b>R18</b><span>點擊顯示</span></button>' : ''}</div>
      <div class="minfo">
        <div class="mmeta">
          <span class="srcbadge inline" style="--src:${SRC_COLORS[item.source]}">${SRC_SHORT[item.source]}</span>
          <span class="mtag">${esc(item.category)}</span>
          ${tags.map((t) => `<span class="mtag band">${esc(t)}</span>`).join('')}
        </div>
        <h2>${esc(item.title)}</h2>
        <div class="mprice">
          <span class="price">${yen(item.price)}</span>
          ${item.prev_price > item.price ? `<s class="was">${yen(item.prev_price)}</s><span class="dropbadge inline">↓${Math.round(dropRatio(item) * 100)}%</span>` : ''}
          ${statusLabel ? `<span class="status ${item.status}">${statusLabel}</span>` : ''}
        </div>
        ${eff != null ? `<div class="meff">套用你的メルカリ優惠券後約 <b>${yen(eff)}</b></div>` : ''}
        <dl class="mrows">
          ${item.condition ? `<dt>狀態</dt><dd>${esc(item.condition)}</dd>` : ''}
          ${item.note ? `<dt>備註</dt><dd>${esc(item.note)}</dd>` : ''}
          ${item.shop_info ? `<dt>店舖</dt><dd>${esc(item.shop_info)}</dd>` : ''}
          ${item.series ? `<dt>分類</dt><dd>${esc(item.series)}</dd>` : ''}
          ${item.jan ? `<dt>JAN</dt><dd>${esc(item.jan)}</dd>` : ''}
          ${item.listed_at ? `<dt>上架</dt><dd>${fmtDate(item.listed_at)}（${timeAgo(item.listed_at)}）</dd>` : ''}
          <dt>收錄</dt><dd>${timeAgo(item.first_seen)}・最後確認 ${timeAgo(item.last_seen)}</dd>
        </dl>
        <div class="mactions">
          <a class="btn btn-primary" href="${esc(item.url)}" target="_blank" rel="noopener">前往 ${SRC_SHORT[item.source]} →</a>
          <span id="mHeart"></span>
          <button class="btn" id="mShare" type="button">複製連結</button>
        </div>
      </div>
    </div>
    ${history.filter((h) => h.price != null).length > 1 ? `<section class="msec"><h4>價格紀錄</h4>${histSvg(history)}</section>` : ''}
    <section class="msec"><h4>跨站比價・相似商品</h4>
      <div class="similar" id="simList">${similar.length ? '' : '<p class="hint">其他站沒有找到相似商品。</p>'}</div>
    </section>`;
  const heart = heartBtn(item);
  heart.classList.add('heart-lg');
  m.querySelector('#mHeart').replaceWith(heart);
  m.querySelector('#mShare').onclick = () => {
    syncUrl(item.id);
    copyText(location.href, '已複製商品連結');
  };
  const sim = m.querySelector('#simList');
  for (const s of similar) {
    const row = el('button', 'simrow' + (s.status === 'soldout' ? ' sold' : ''));
    row.type = 'button';
    row.innerHTML = `
      ${s.image ? `<img src="${esc(imgSrc(s.image))}" loading="lazy" alt=""${s.adult ? ' class="blur-sm"' : ''}>` : '<span class="img-ph"></span>'}
      <span class="srcbadge inline" style="--src:${SRC_COLORS[s.source]}">${SRC_SHORT[s.source]}</span>
      <span class="t">${esc(s.title)}</span>
      ${s.status === 'soldout' ? '<span class="mtag">售完</span>' : ''}
      <span class="p">${yen(s.price)}</span>`;
    row.onclick = () => openModal(s.id);
    sim.appendChild(row);
  }
  const mcover = m.querySelector('.mimg .r18cover');
  if (mcover) mcover.onclick = () => { mcover.closest('.mimg').classList.add('revealed'); mcover.remove(); };
  m.querySelector('#mclose').onclick = closeModal;
  $('modal').hidden = false;
  document.body.classList.add('modal-open');
  m.scrollTop = 0;
}
function closeModal() {
  $('modal').hidden = true;
  document.body.classList.remove('modal-open');
  syncUrl();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    setFiltersOpen(false);
  } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    $('searchInput').focus();
  }
});

/** 價格紀錄：階梯線（價格在兩次觀測之間不變）＋ 頭尾日期與最高最低 */
function histSvg(history) {
  const pts = history.filter((h) => h.price != null).map((h) => ({ t: Date.parse(h.seen_at), p: h.price }));
  pts.push({ t: Date.now(), p: pts[pts.length - 1].p });
  const W = 720, H = 140, L = 64, R = 12, T = 12, B = 24;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const min = Math.min(...pts.map((x) => x.p)), max = Math.max(...pts.map((x) => x.p));
  const span = max - min || 1;
  const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const Y = (p) => T + (1 - (p - min) / span) * (H - T - B);
  let d = `M${X(pts[0].t)},${Y(pts[0].p)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i].t)} V${Y(pts[i].p)}`;
  const dots = pts.slice(0, -1).map((x) => `<circle cx="${X(x.t)}" cy="${Y(x.p)}" r="3.5"><title>${fmtDate(new Date(x.t).toISOString())} ${yen(x.p)}</title></circle>`).join('');
  return `<svg class="histchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="價格紀錄">
    <line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(max)}" y2="${Y(max)}"/><line class="grid-l" x1="${L}" x2="${W - R}" y1="${Y(min)}" y2="${Y(min)}"/>
    <text x="${L - 8}" y="${Y(max) + 4}" text-anchor="end">${yen(max)}</text>
    <text x="${L - 8}" y="${Y(min) + 4}" text-anchor="end">${yen(min)}</text>
    <path d="${d}"/>${dots}
    <text x="${L}" y="${H - 6}">${fmtDate(new Date(t0).toISOString())}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end">今天</text>
  </svg>`;
}

/* ---------------- tabs ---------------- */

function switchTab(tab) {
  if (LOCAL_TABS.has(tab) && PUBLIC) tab = 'browse';
  setFiltersOpen(false);
  if (tab === 'drops' && state.sort === 'newest') state.sort = 'drop';
  if (tab !== 'drops' && state.sort === 'drop') state.sort = 'newest';
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  const isGrid = isGridTab(tab);
  document.body.dataset.tab = tab;
  $('sortSel').querySelector('option[value="drop"]')?.remove();
  if (tab === 'drops') $('sortSel').prepend(new Option('降幅最大', 'drop'));
  $('sortSel').value = state.sort;
  $('sortSel').disabled = tab === 'new';
  const main = document.querySelector('.main');
  main.querySelector('.panel')?.remove();
  $('emptyState').hidden = true;
  if (isGrid) {
    loadItems(true);
    return;
  }
  $('marketBar').hidden = true;
  const tpl = { compare: 'compareTpl', notify: 'notifyTpl', watch: 'watchTpl', system: 'systemTpl' }[tab];
  main.appendChild($(tpl).content.cloneNode(true).firstElementChild);
  ({ compare: initComparePanel, notify: initNotifyPanel, watch: initWatchPanel, system: initSystemPanel })[tab]();
  syncUrl();
}

async function initWatchPanel() {
  const listEl = $('watchList');
  const refresh = async () => {
    const ws = await api('/api/watches');
    listEl.replaceChildren();
    if (!ws.length) listEl.appendChild(el('li', 'hint', '目前沒有關注中的關鍵字。'));
    for (const w of ws) {
      const li = el('li');
      li.appendChild(el('span', 'kw', w.keyword));
      const rmBtn = el('button', 'icon-btn', '×');
      rmBtn.setAttribute('aria-label', '移除');
      rmBtn.onclick = async () => { await del('/api/watches/' + w.id); refresh(); };
      li.appendChild(rmBtn);
      listEl.appendChild(li);
    }
  };
  $('watchAdd').onclick = async () => {
    const kw = $('watchInput').value.trim();
    if (!kw) return;
    await post('/api/watches', { keyword: kw });
    $('watchInput').value = '';
    toastMsg('已加入關注');
    refresh();
  };
  $('watchInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('watchAdd').click());
  refresh();
}

let crawlPoll = null;
async function initSystemPanel() {
  const logEl = $('crawlLog');
  const poll = async () => {
    const st = await api('/api/crawl/status');
    logEl.textContent = st.log.join('\n') || '（尚無紀錄）';
    logEl.scrollTop = logEl.scrollHeight;
    $('crawlBtn').disabled = st.running;
    $('crawlFullBtn').disabled = st.running;
    $('crawlBtn').innerHTML = st.running ? '<span class="spin"></span> 更新中…' : '立即更新（增量掃站）';
    if (!st.running && crawlPoll) { clearInterval(crawlPoll); crawlPoll = null; loadStats(); loadFacets(); }
  };
  const trigger = async (full) => {
    await post('/api/crawl', { full }).catch((e) => toastMsg(e.message));
    if (!crawlPoll) crawlPoll = setInterval(poll, 1500);
    poll();
  };
  $('crawlBtn').onclick = () => trigger(false);
  $('crawlFullBtn').onclick = () => trigger(true);
  $('webhookSave').onclick = async () => {
    await post('/api/config', { discord_webhook: $('webhookInput').value.trim() });
    toastMsg('已儲存 webhook 設定');
  };
  $('intervalSave').onclick = async () => {
    await post('/api/config', { crawl_interval_hours: Number($('intervalInput').value) || 3 });
    toastMsg('已儲存（重啟服務後生效）');
  };
  $('intervalInput').value = (await loadStats()).crawlIntervalHours;
  const st = await api('/api/crawl/status');
  if (st.running && !crawlPoll) crawlPoll = setInterval(poll, 1500);
  poll();
}

/* ---------------- 通知訂閱 ---------------- */

/** 訂閱 API 一律直接打伺服器（公開站是 Cloudflare Worker），不走快照 */
async function subApi(method, path, body) {
  const sub = readStore('bh_sub', null);
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(sub?.token ? { Authorization: 'Bearer ' + sub.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { status: res.status });
  return data;
}
const kwLines = () => $('subKeywords').value.split('\n').map((s) => s.trim()).filter(Boolean);
let notifyPrefill = null;

function updateNotifyBadge() {
  $('notifyBadge').textContent = readStore('bh_sub', null) ? '開' : '';
}

async function initNotifyPanel() {
  const show = (sub) => {
    const active = !!sub;
    $('subActive').hidden = !active;
    $('subForm').hidden = active;
    $('subTest').hidden = $('subDelete').hidden = !active;
    $('subSave').textContent = active ? '儲存關鍵字' : '啟用通知';
    if (active) {
      $('subWebhook').textContent = sub.webhook;
      $('subMeta').textContent = `建立於 ${fmtDate(sub.createdAt)}` + (sub.lastSentAt ? `・上次通知 ${timeAgo(sub.lastSentAt)}` : '・還沒有符合的新品');
      $('subKeywords').value = sub.keywords.join('\n');
    }
    if (notifyPrefill && !kwLines().includes(notifyPrefill)) $('subKeywords').value = [...kwLines(), notifyPrefill].join('\n');
    notifyPrefill = null;
    const q = state.q.trim();
    $('subAddQ').hidden = !q || kwLines().includes(q);
    $('subAddQ').textContent = `加入目前搜尋「${q}」`;
    updateNotifyBadge();
  };
  $('subAddQ').onclick = () => {
    $('subKeywords').value = [...kwLines(), state.q.trim()].join('\n');
    $('subAddQ').hidden = true;
  };
  const busy = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } catch (e) { toastMsg(e.message); } finally { btn.disabled = false; }
  };
  $('subSave').onclick = () => busy($('subSave'), async () => {
    const saved = readStore('bh_sub', null);
    if (saved && $('subForm').hidden) {
      show(await subApi('PUT', '/api/subs/' + saved.id, { keywords: kwLines() }));
      toastMsg('已更新關鍵字');
      return;
    }
    const r = await subApi('POST', '/api/subs', { webhook: $('subWebhookInput').value.trim(), keywords: kwLines() });
    writeStore('bh_sub', { id: r.id, token: r.token });
    show({ ...r, createdAt: new Date().toISOString(), lastSentAt: null });
    toastMsg(r.replaced ? '已更新這個 Webhook 的設定，Discord 應該收到一則確認訊息' : '已啟用！Discord 應該收到一則確認訊息');
  });
  $('subTest').onclick = () => busy($('subTest'), async () => {
    await subApi('POST', `/api/subs/${readStore('bh_sub', {}).id}/test`, {});
    toastMsg('已送出測試通知');
  });
  $('subDelete').onclick = () => busy($('subDelete'), async () => {
    await subApi('DELETE', '/api/subs/' + readStore('bh_sub', {}).id).catch((e) => { if (e.status !== 404) throw e; });
    writeStore('bh_sub', null);
    $('subKeywords').value = '';
    show(null);
    toastMsg('已取消通知');
  });
  const saved = readStore('bh_sub', null);
  if (!saved) return show(null);
  try {
    show(await subApi('GET', '/api/subs/' + saved.id));
  } catch (e) {
    if (e.status === 404) writeStore('bh_sub', null); // 已失效（webhook 被刪、或在別處取消）
    else toastMsg('讀取通知設定失敗：' + e.message);
    show(null);
  }
}

/* ---------------- 比價・行情 ---------------- */

async function initComparePanel() {
  const input = $('compareInput');
  input.value = state.q || $('searchInput').value.trim();
  const run = async () => {
    const q = input.value.trim();
    if (!q) return toastMsg('請輸入關鍵字');
    $('compareGo').disabled = true;
    $('cmpList').innerHTML = '<p class="hint"><span class="spin"></span> 比價中…</p>';
    try {
      const [r, m] = await Promise.all([
        api('/api/compare?q=' + encodeURIComponent(q) + ($('compareInstock').checked ? '&instock=1' : '')),
        api('/api/market?q=' + encodeURIComponent(q)),
      ]);
      $('cmpMarket').replaceChildren(marketNode(m, q));
      renderCompare(r);
    } catch (e) {
      toastMsg('比價失敗：' + e.message);
    }
    $('compareGo').disabled = false;
  };
  $('compareGo').onclick = run;
  $('compareInstock').addEventListener('change', run);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && run());
  if (input.value) run();
}

function renderCompare(r) {
  const sum = $('cmpSummary');
  sum.replaceChildren();
  const prices = Object.values(r.summary).map((s) => s.cheapest && sortPrice(s.cheapest)).filter((p) => p != null);
  const best = prices.length ? Math.min(...prices) : null;
  for (const [src, s] of Object.entries(r.summary)) {
    const p = s.cheapest ? sortPrice(s.cheapest) : null;
    const d = el('button', 'cmp-src' + (p != null && p === best ? ' best' : ''));
    d.type = 'button';
    d.disabled = !s.cheapest;
    const name = el('div', 'name');
    const dot = el('span', 'srcdot');
    dot.style.background = SRC_COLORS[src];
    name.append(dot, document.createTextNode(SRC_SHORT[src]));
    d.appendChild(name);
    if (p != null) {
      d.appendChild(el('div', 'min', yen(p)));
      d.appendChild(el('div', 'cnt', `${s.count.toLocaleString()} 件${effPrice(s.cheapest) != null ? '・券後' : ''}`));
      d.onclick = () => openModal(s.cheapest.id);
    } else {
      d.appendChild(el('div', 'nores', '無符合商品'));
    }
    sum.appendChild(d);
  }
  const list = $('cmpList');
  list.replaceChildren();
  if (!r.items.length) {
    list.appendChild(el('p', 'hint', '沒有符合的商品，試試換關鍵字或取消「清單只列可購買」。'));
    return;
  }
  const items = r.items.slice().sort((a, b) => (sortPrice(a) ?? Infinity) - (sortPrice(b) ?? Infinity));
  for (const it of items) {
    const row = el('button', 'cmp-row' + (it.status === 'soldout' ? ' sold' : ''));
    row.type = 'button';
    const img = el('img');
    img.alt = '';
    if (it.image) {
      img.loading = 'lazy';
      img.src = imgSrc(it.image);
      if (it.adult) img.classList.add('blur-sm');
    }
    row.appendChild(img);
    const b = el('span', 'srcbadge inline', SRC_SHORT[it.source]);
    b.style.setProperty('--src', SRC_COLORS[it.source]);
    row.appendChild(b);
    row.appendChild(el('span', 't', it.title));
    if (it.condition) row.appendChild(el('span', 'cond-sm', it.condition + (it.status === 'soldout' ? '・售完' : '')));
    const pr = el('span', 'p', yen(it.price));
    const eff = effPrice(it);
    if (eff != null) pr.appendChild(el('small', 'eff', '券後 ' + yen(eff)));
    row.appendChild(pr);
    row.onclick = () => openModal(it.id);
    list.appendChild(row);
  }
}

/* ---------------- danmaku ---------------- */

const danmaku = { queue: [], idx: 0, timer: null, lanes: 7 };

async function danmakuStart() {
  try {
    let r = await api('/api/items?sinceHours=336&sort=newest&limit=200');
    let items = r.items.filter((i) => i.image && !i.adult);
    if (items.length < 20) {
      r = await api('/api/items?sort=newest&limit=200');
      items = r.items.filter((i) => i.image && !i.adult);
    }
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    danmaku.queue = items;
    danmaku.idx = 0;
    $('danmaku').hidden = false;
    if (!danmaku.timer) danmaku.timer = setInterval(spawnBullet, 1500);
    spawnBullet();
  } catch (e) {
    toastMsg('彈幕載入失敗：' + e.message);
  }
}

function danmakuStop() {
  clearInterval(danmaku.timer);
  danmaku.timer = null;
  const d = $('danmaku');
  d.hidden = true;
  d.replaceChildren();
}

function spawnBullet() {
  if (document.hidden || !danmaku.queue.length) return;
  const it = danmaku.queue[danmaku.idx % danmaku.queue.length];
  danmaku.idx++;
  const b = el('div', 'bullet');
  b.style.borderLeftColor = SRC_COLORS[it.source] || 'var(--accent)';
  const img = el('img');
  img.src = imgSrc(it.image);
  img.alt = '';
  b.appendChild(img);
  b.appendChild(el('span', 'bp', yen(it.price)));
  b.appendChild(el('span', 'bt', it.title));
  const lane = Math.floor(Math.random() * danmaku.lanes);
  b.style.top = 180 + lane * 48 + 'px'; // 從工具列下方開始，不遮擋排序/篩選控制
  b.style.animationDuration = 11 + Math.random() * 9 + 's';
  b.onclick = () => openModal(it.id);
  b.addEventListener('animationend', () => b.remove());
  $('danmaku').appendChild(b);
}

$('danmakuToggle').addEventListener('change', (e) => {
  writeStore('danmaku', e.target.checked);
  if (e.target.checked) danmakuStart();
  else danmakuStop();
});

/* ---------------- live search（本機） ---------------- */

async function liveSearch() {
  const kw = $('searchInput').value.trim();
  if (!kw) return toastMsg('請先輸入關鍵字');
  const btn = $('liveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 查詢中…';
  $('liveStatus').textContent = '正在查詢各網站的最新結果…';
  try {
    const r = await post('/api/live', { keyword: kw });
    toastMsg(`同步完成：找到 ${r.items.length} 件`);
    for (const e of r.errors) toastMsg(`${SRC_SHORT[e.source]}：${e.message}`);
    state.q = kw;
    switchTab('browse');
    loadFacets();
    loadStats();
  } catch (e) {
    toastMsg('同步失敗：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '即時同步';
    $('liveStatus').textContent = '';
  }
}

/* ---------------- theme ---------------- */

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme(readStore('bh_theme', null));
$('themeBtn').onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  writeStore('bh_theme', next);
};

/* ---------------- init ---------------- */

function initCoupon() {
  $('couponType').value = coupon.type;
  $('couponValue').value = coupon.value ?? '';
  $('couponCap').value = coupon.cap ?? '';
  $('couponMin').value = coupon.min ?? '';
  const sync = () => {
    $('couponExtra').hidden = coupon.type === 'none';
    $('couponValue').disabled = coupon.type === 'none';
    $('couponValue').placeholder = coupon.type === 'yen' ? '折抵 ¥' : '%';
    $('couponCap').hidden = coupon.type !== 'pct';
  };
  sync();
  const num = (id) => ($(id).value ? Number($(id).value) : null);
  const onChange = () => {
    Object.assign(coupon, { type: $('couponType').value, value: num('couponValue'), cap: num('couponCap'), min: num('couponMin') });
    writeStore('bh_coupon', coupon);
    sync();
    if (isGridTab(state.tab)) loadItems(true);
  };
  for (const id of ['couponType', 'couponValue', 'couponCap', 'couponMin']) $(id).addEventListener('change', onChange);
}

function bindControls() {
  let searchTimer = null;
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = $('searchInput').value.trim();
      if (isGridTab(state.tab)) loadItems(true);
    }, 300);
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!PUBLIC && (e.ctrlKey || e.metaKey)) return liveSearch();
    clearTimeout(searchTimer);
    state.q = $('searchInput').value.trim();
    if (!isGridTab(state.tab) && state.tab !== 'compare') switchTab('browse');
    else if (isGridTab(state.tab)) loadItems(true);
    else initComparePanel();
    $('searchInput').blur();
  });
  $('liveBtn').onclick = liveSearch;
  for (const inp of ['minPrice', 'maxPrice']) {
    $(inp).addEventListener('change', () => {
      state.minPrice = $('minPrice').value ? Number($('minPrice').value) : null;
      state.maxPrice = $('maxPrice').value ? Number($('maxPrice').value) : null;
      refreshFilterUi();
      loadItems(true);
    });
  }
  $('instockOnly').addEventListener('change', (e) => { state.instock = e.target.checked; refreshFilterUi(); loadItems(true); });
  $('sortSel').addEventListener('change', (e) => { state.sort = e.target.value; loadItems(true); });
  $('clearFilters').onclick = () => {
    Object.assign(state, { sources: new Set(ALL_SOURCES), tag: null, instock: false, minPrice: null, maxPrice: null });
    state.categories.clear();
    refreshFilterUi();
    loadItems(true);
  };
  $('shareBtn').onclick = () => { syncUrl(); copyText(location.href, '已複製目前搜尋的連結'); };
  $('notifyBtn').onclick = () => { notifyPrefill = state.q.trim(); switchTab('notify'); };
  $('filterToggle').onclick = () => setFiltersOpen(true);
  $('filterClose').onclick = () => setFiltersOpen(false);
  $('filterDone').onclick = () => setFiltersOpen(false);
  $('sidebarBackdrop').onclick = () => setFiltersOpen(false);
  window.addEventListener('resize', () => window.innerWidth > 900 && setFiltersOpen(false));
  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) switchTab(t.dataset.tab);
  });
  $('modal').querySelector('.modal-backdrop').onclick = closeModal;
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !state.loading && !state.done && isGridTab(state.tab)) loadItems(false);
  }, { rootMargin: '600px' }).observe($('sentinel'));
}

(async function init() {
  PUBLIC = SNAPSHOT_WANTED && !!(await snapshotMeta());
  document.body.classList.toggle('public', PUBLIC);
  document.querySelectorAll('.local-only').forEach((e) => (e.hidden = PUBLIC));
  const deepItem = readUrl();
  $('searchInput').value = state.q;
  updateWishBadge();
  updateNotifyBadge();
  initCoupon();
  bindControls();
  await loadFacets().catch((e) => toastMsg('讀取失敗：' + e.message));
  switchTab(state.tab);
  loadStats().catch(() => {});
  if (deepItem) openModal(deepItem);
  loadBadges();
  setInterval(() => loadStats().catch(() => {}), STATS_REFRESH_MS);
  if (readStore('danmaku', false) === true || readStore('danmaku', false) === 1) {
    $('danmakuToggle').checked = true;
    danmakuStart();
  }
})();
