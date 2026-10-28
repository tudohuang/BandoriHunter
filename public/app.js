/* Bandori Hunter frontend */
'use strict';

const SRC_COLORS = {
  surugaya: 'var(--c-surugaya)',
  lashinbang: 'var(--c-lashinbang)',
  hardoff: 'var(--c-hardoff)',
  bookoff: 'var(--c-bookoff)',
  kbooks: 'var(--c-kbooks)',
  mercari: 'var(--c-mercari)',
};
const SRC_SHORT = { surugaya: '駿河屋', lashinbang: 'らしんばん', hardoff: 'HARD OFF', bookoff: 'BOOKOFF', kbooks: 'K-BOOKS', mercari: 'メルカリ' };
const ALL_SOURCES = Object.keys(SRC_COLORS);
const GRID_TABS = new Set(['browse', 'new', 'wish']);
const PAGE_SIZE = 60;
const STATS_REFRESH_MS = 300000;
const SNAPSHOT_ENABLED = !/^(localhost|127\.|\[?::1)/.test(location.hostname) || new URLSearchParams(location.search).has('snapshot');
const BAND_TAGS = ["Poppin'Party", 'Roselia', 'Afterglow', 'Pastel*Palettes', 'ハロー、ハッピーワールド！', 'RAISE A SUILEN', 'Morfonica', 'MyGO!!!!!', 'Ave Mujica'];
const SEIYUU_TAGS = ['愛美', '大塚紗英', '西本りみ', '大橋彩香', '伊藤彩沙', '佐倉綾音', '三澤紗千香', '加藤英美里', '日笠陽子', '金元寿子', '前島亜美', '小澤亜李', '上坂すみれ', '中上育実', '秦佐和子', '相羽あいな', '工藤晴香', '中島由貴', '櫻川めぐ', '志崎樺音', '遠藤ゆりか', '明坂聡美', '伊藤美来', '田所あずさ', '吉田有里', '豊田萌絵', '黒沢ともよ', 'Raychell', '小原莉子', '夏芽', '紡木吏佐', '倉知玲鳳', '進藤あまね', '直田姫奈', '西尾夕香', 'mika', 'Ayasa', '羊宮妃那', '立石凛', '青木陽菜', '小日向美香', '林鼓子', '佐々木李子', '渡瀬結月', '米澤茜', '岡田夢以', '高尾奏音'];

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
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const yen = (p) => (p != null ? '¥' + p.toLocaleString() : '—');
const imgSrc = (u) => '/img?u=' + encodeURIComponent(u);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isGridTab = (tab) => GRID_TABS.has(tab);

function timeAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' 分鐘前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小時前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return new Date(iso).toLocaleDateString();
}

function toastMsg(text) {
  const t = el('div', 'toastmsg', text);
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

const post = (u, d) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
const del = (u) => api(u, { method: 'DELETE' });
async function api(path, opts) {
  const snap = await snapshotApi(path, opts);
  if (snap) return snap.data;
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'HTTP ' + res.status);
  return res.json();
}

const snapshot = { meta: null, chunks: new Map(), all: null };
const snapshotChunkName = (index) => `/snapshot/items-${String(index).padStart(3, '0')}.json`;
const snapNorm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

async function snapshotMeta() {
  if (!snapshot.meta) {
    snapshot.meta = fetch('/snapshot/meta.json', { cache: 'force-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return snapshot.meta;
}

async function snapshotChunk(index) {
  if (!snapshot.chunks.has(index)) {
    snapshot.chunks.set(
      index,
      fetch(snapshotChunkName(index), { cache: 'force-cache' })
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []),
    );
  }
  return snapshot.chunks.get(index);
}

async function snapshotAllItems(meta) {
  if (!snapshot.all) {
    snapshot.all = (async () => {
      const items = [];
      for (let i = 0; i < meta.chunks; i += 6) {
        const parts = await Promise.all(Array.from({ length: Math.min(6, meta.chunks - i) }, (_, n) => snapshotChunk(i + n)));
        for (const part of parts) items.push(...part);
      }
      return items;
    })();
  }
  return snapshot.all;
}

function snapshotSort(items, sort) {
  const out = items.slice();
  const timeDesc = (field) => (a, b) => Date.parse(b[field] || 0) - Date.parse(a[field] || 0) || b.id - a.id;
  const priceRank = (it) => (it.price == null ? Number.POSITIVE_INFINITY : Number(it.price));
  if (sort === 'updated') return out.sort(timeDesc('last_seen'));
  if (sort === 'price_asc') return out.sort((a, b) => priceRank(a) - priceRank(b));
  if (sort === 'price_desc') return out.sort((a, b) => priceRank(a) === Number.POSITIVE_INFINITY ? 1 : priceRank(b) === Number.POSITIVE_INFINITY ? -1 : priceRank(b) - priceRank(a));
  return out.sort(timeDesc('first_seen'));
}

function snapshotFilters(params) {
  return {
    q: snapNorm(params.get('q')),
    sources: params.get('source')?.split(',').filter(Boolean) ?? null,
    categories: params.get('category')?.split(',').filter(Boolean) ?? null,
    tag: params.get('tag'),
    status: params.get('status'),
    minPrice: params.get('minPrice') ? Number(params.get('minPrice')) : null,
    maxPrice: params.get('maxPrice') ? Number(params.get('maxPrice')) : null,
    since: params.get('sinceHours') ? Date.now() - Number(params.get('sinceHours')) * 3600_000 : null,
    wished: params.get('wished') === '1',
  };
}

function snapshotFilterItems(items, params) {
  const f = snapshotFilters(params);
  const toks = f.q ? f.q.split(' ').filter(Boolean) : [];
  return items.filter((it) => {
    if (toks.length && !toks.every((t) => String(it.title_norm || '').includes(t))) return false;
    if (f.sources && !f.sources.includes(it.source)) return false;
    if (f.categories && !f.categories.includes(it.category)) return false;
    if (f.tag && !String(it.tags || '').includes(JSON.stringify(f.tag).slice(1, -1))) return false;
    if (f.status && it.status !== f.status) return false;
    if (f.minPrice != null && !(it.price >= f.minPrice)) return false;
    if (f.maxPrice != null && !(it.price <= f.maxPrice)) return false;
    if (f.since != null && Date.parse(it.first_seen) < f.since) return false;
    if (f.wished && !it.wished) return false;
    return true;
  });
}

function canUseSnapshotPage(params) {
  return !params.get('q') && !params.get('source') && !params.get('category') && !params.get('tag') && !params.get('status') &&
    !params.get('minPrice') && !params.get('maxPrice') && !params.get('sinceHours') && params.get('wished') !== '1' &&
    ((params.get('sort') || 'newest') === 'newest');
}

async function snapshotItems(params, meta) {
  const limit = Math.min(Number(params.get('limit')) || PAGE_SIZE, 200);
  const offset = Number(params.get('offset')) || 0;
  if (canUseSnapshotPage(params)) {
    const first = Math.floor(offset / meta.chunkSize);
    const last = Math.floor((offset + limit - 1) / meta.chunkSize);
    const parts = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => snapshotChunk(first + i)));
    return { items: parts.flat().slice(offset - first * meta.chunkSize, offset - first * meta.chunkSize + limit), total: meta.total };
  }
  const items = snapshotSort(snapshotFilterItems(await snapshotAllItems(meta), params), params.get('sort') || 'newest');
  return { items: items.slice(offset, offset + limit), total: items.length };
}

function bigrams(s) {
  const t = snapNorm(s).replace(/[^\p{L}\p{N}]/gu, '');
  return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)));
}

function snapshotSimilar(item, items) {
  const a = bigrams(item.title_norm || item.title);
  return items
    .filter((it) => it.id !== item.id && (it.category === item.category || (item.jan && it.jan === item.jan)))
    .map((it) => {
      if (item.jan && it.jan === item.jan) return { ...it, score: 1 };
      const b = bigrams(it.title_norm || it.title);
      const inter = [...a].filter((g) => b.has(g)).length;
      return { ...it, score: (2 * inter) / (a.size + b.size || 1) };
    })
    .filter((it) => it.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

async function snapshotItem(id, meta) {
  const items = await snapshotAllItems(meta);
  const item = items.find((it) => Number(it.id) === Number(id));
  if (!item) throw new Error('not found');
  return { item, history: [], similar: snapshotSimilar(item, items) };
}

async function snapshotCompare(params, meta) {
  const q = params.get('q') || '';
  const sourceParams = new URLSearchParams({ q, sort: 'price_asc', limit: '120' });
  if (params.get('instock') === '1') sourceParams.set('status', 'instock');
  const items = snapshotSort(snapshotFilterItems(await snapshotAllItems(meta), sourceParams), 'price_asc');
  const summary = Object.fromEntries(ALL_SOURCES.map((src) => {
    const sourceItems = items.filter((it) => it.source === src);
    return [src, { count: sourceItems.length, cheapest: sourceItems[0] ?? null }];
  }));
  return { summary, items: items.slice(0, 120), total: items.length };
}

async function snapshotApi(path, opts) {
  if (!SNAPSHOT_ENABLED) return null;
  if (opts && opts.method && opts.method !== 'GET') return null;
  const meta = await snapshotMeta();
  if (!meta) return null;
  const url = new URL(path, location.origin);
  if (url.pathname === '/api/stats') return { data: meta.stats };
  if (url.pathname === '/api/facets') return { data: meta.facets };
  if (url.pathname === '/api/items') return { data: await snapshotItems(url.searchParams, meta) };
  if (url.pathname === '/api/compare') return { data: await snapshotCompare(url.searchParams, meta) };
  const itemMatch = url.pathname.match(/^\/api\/item\/(\d+)$/);
  if (itemMatch) return { data: await snapshotItem(itemMatch[1], meta) };
  return null;
}

function resetItems() {
  state.offset = 0;
  state.items = [];
  state.done = false;
}

/* ---------------- filters / query ---------------- */

function buildQuery(reset) {
  if (reset) resetItems();
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.sources.size < ALL_SOURCES.length) p.set('source', [...state.sources].join(','));
  if (state.categories.size) p.set('category', [...state.categories].join(','));
  if (state.tag) p.set('tag', state.tag);
  if (state.instock) p.set('status', 'instock');
  if (state.minPrice != null) p.set('minPrice', state.minPrice);
  if (state.maxPrice != null) p.set('maxPrice', state.maxPrice);
  if (state.tab === 'new') p.set('sinceHours', '72');
  if (state.tab === 'wish') p.set('wished', '1');
  p.set('sort', state.tab === 'new' ? 'newest' : state.sort);
  p.set('limit', String(PAGE_SIZE));
  p.set('offset', state.offset);
  return p;
}

async function loadItems(reset) {
  if (state.loading) return;
  state.loading = true;
  const data = await api('/api/items?' + buildQuery(reset)).catch((e) => (toastMsg('讀取失敗：' + e.message), { items: [], total: 0 }));
  state.total = data.total;
  state.items = state.offset === 0 ? data.items : state.items.concat(data.items);
  state.offset += data.items.length;
  if (data.items.length < PAGE_SIZE) state.done = true;
  state.loading = false;
  render();
}

/* ---------------- rendering ---------------- */

function cardNode(it) {
  const card = el('div', 'card' + (it.status === 'soldout' ? ' sold' : ''));
  const thumb = el('div', 'thumb');
  if (it.image) {
    const img = el('img');
    img.loading = 'lazy';
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
  badge.style.background = SRC_COLORS[it.source] || '#666';
  thumb.appendChild(badge);
  if (it.status === 'soldout') thumb.appendChild(el('span', 'soldbadge', '品切'));
  const heart = el('button', 'heart' + (it.wished ? ' on' : ''), it.wished ? '♥' : '♡');
  heart.title = '願望清單';
  heart.onclick = async (ev) => {
    ev.stopPropagation();
    const on = !heart.classList.contains('on');
    await (on ? post('/api/wishlist/' + it.id, {}) : del('/api/wishlist/' + it.id));
    heart.classList.toggle('on', on);
    heart.textContent = on ? '♥' : '♡';
    it.wished = on ? 1 : 0;
    toastMsg(on ? '已加入願望清單' : '已移出願望清單');
  };
  thumb.appendChild(heart);
  card.appendChild(thumb);

  const body = el('div', 'cardbody');
  body.appendChild(el('div', 'cardtitle', it.title));
  const meta = el('div', 'cardmeta');
  meta.appendChild(el('span', 'mtag', it.category));
  for (const t of JSON.parse(it.tags || '[]').slice(0, 2)) meta.appendChild(el('span', 'mtag band', t));
  body.appendChild(meta);
  const foot = el('div', 'cardfoot');
  const priceEl = el('span', 'price' + (it.price == null ? ' free' : ''), yen(it.price));
  foot.appendChild(priceEl);
  if (it.condition) foot.appendChild(el('span', 'cond', it.condition));
  foot.appendChild(el('span', 'when', timeAgo(it.first_seen)));
  body.appendChild(foot);
  card.appendChild(body);
  card.onclick = () => openModal(it.id);
  return card;
}

function render() {
  const grid = $('grid');
  grid.replaceChildren(...state.items.map(cardNode));
  $('resultCount').innerHTML = `<b>${state.total.toLocaleString()}</b> 件`;
  $('emptyState').hidden = state.items.length > 0;
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

async function loadFacets() {
  state.facets = await api('/api/facets');
  const sf = $('sourceFilters');
  sf.replaceChildren();
  for (const src of ALL_SOURCES) {
    const row = el('div', 'srcrow' + (state.sources.has(src) ? '' : ' off'));
    const dot = el('span', 'srcdot');
    dot.style.background = SRC_COLORS[src];
    row.appendChild(dot);
    row.appendChild(el('span', null, SRC_SHORT[src]));
    row.appendChild(el('span', 'srccount', (state.facets.sources[src] || 0).toLocaleString()));
    row.onclick = () => {
      if (state.sources.has(src) && state.sources.size === 1) return;
      state.sources.has(src) ? state.sources.delete(src) : state.sources.add(src);
      row.classList.toggle('off');
      updateFilterButton();
      loadItems(true);
    };
    sf.appendChild(row);
  }
  const cc = $('categoryChips');
  cc.replaceChildren();
  const cats = Object.entries(state.facets.categories).filter(([, n]) => n > 0);
  for (const [cat, n] of cats) {
    const chip = el('button', 'chip' + (state.categories.has(cat) ? ' on' : ''));
    chip.innerHTML = `${esc(cat)}<small>${n}</small>`;
    chip.onclick = () => {
      state.categories.has(cat) ? state.categories.delete(cat) : state.categories.add(cat);
      chip.classList.toggle('on');
      updateFilterButton();
      loadItems(true);
    };
    cc.appendChild(chip);
  }
  const tc = $('tagChips');
  const sc = $('seiyuuChips');
  tc.replaceChildren();
  sc.replaceChildren();
  const tags = Object.entries(state.facets.tags).sort((a, b) => b[1] - a[1]);
  const bands = tags.filter(([t]) => BAND_TAGS.includes(t));
  const seiyuu = tags.filter(([t]) => SEIYUU_TAGS.includes(t)).slice(0, 18);
  const chars = tags.filter(([t]) => !BAND_TAGS.includes(t) && !SEIYUU_TAGS.includes(t)).slice(0, 18);
  const addChip = (container, tag, n) => {
    const chip = el('button', 'chip' + (state.tag === tag ? ' on' : ''));
    chip.innerHTML = `${esc(tag)}<small>${n}</small>`;
    chip.onclick = () => {
      state.tag = state.tag === tag ? null : tag;
      [...tc.children, ...sc.children].forEach((c) => c.classList.remove('on'));
      if (state.tag) chip.classList.add('on');
      updateFilterButton();
      loadItems(true);
    };
    container.appendChild(chip);
  };
  for (const [tag, n] of [...bands, ...chars]) addChip(tc, tag, n);
  for (const [tag, n] of seiyuu) addChip(sc, tag, n);
  updateFilterButton();
}

async function loadStats() {
  const s = await api('/api/stats');
  $('topStats').innerHTML =
    `收錄 <b>${s.total.toLocaleString()}</b> 件<br>` +
    `上次更新：${s.lastCrawl ? timeAgo(s.lastCrawl) : '<span style="color:var(--warn)">尚未更新</span>'}`;
  const newTotal = Number(s.newItems72 ?? 0);
  $('newBadge').textContent = newTotal > 0 ? (newTotal > 999 ? '999+' : newTotal) : '';
  return s;
}

/* ---------------- modal ---------------- */

async function openModal(id) {
  const { item, history, similar } = await api('/api/item/' + id);
  const m = $('modalCard');
  const tags = JSON.parse(item.tags || '[]');
  m.innerHTML = `
    <button class="mclose" id="mclose">✕</button>
    <div class="mhead">
      <div class="mimg${item.adult ? ' r18' : ''}">${item.image ? `<img src="${esc(imgSrc(item.image))}">` : '<span class="noimg">無圖片</span>'}${item.adult ? '<button class="r18cover"><b>R18</b><span>點擊顯示</span></button>' : ''}</div>
      <div class="minfo">
        <div class="mmeta">
          <span class="srcbadge" style="position:static;background:${SRC_COLORS[item.source]}">${SRC_SHORT[item.source]}</span>
          <span class="mtag">${esc(item.category)}</span>
          ${tags.map((t) => `<span class="mtag band">${esc(t)}</span>`).join('')}
        </div>
        <h2>${esc(item.title)}</h2>
        <div class="mprice">${yen(item.price)} <span style="font-size:13px;color:var(--dim)">${esc(item.condition || '')} ${item.status === 'soldout' ? '｜品切' : item.status === 'instock' ? '｜有貨' : ''}</span></div>
        ${item.shop_info ? `<div class="mrow">出品店舖：${esc(item.shop_info)}</div>` : ''}
        ${item.series ? `<div class="mrow">分類/系列：${esc(item.series)}</div>` : ''}
        ${item.note ? `<div class="mrow">${esc(item.note)}</div>` : ''}
        <div class="mrow">收錄於 ${timeAgo(item.first_seen)} ｜ 最後確認 ${timeAgo(item.last_seen)}</div>
        <a class="linkout" href="${esc(item.url)}" target="_blank" rel="noopener">前往 ${SRC_SHORT[item.source]} 購買 →</a>
      </div>
    </div>
    ${history.length > 1 ? `<div class="msec"><h4>價格紀錄</h4>${histSvg(history)}</div>` : ''}
    <div class="msec"><h4>跨站比價（相似商品）</h4>
      <div class="similar" id="simList">${similar.length ? '' : '<span class="hint">其他站沒有找到相似商品。</span>'}</div>
    </div>`;
  const sim = m.querySelector('#simList');
  for (const s of similar) {
    const row = el('div', 'simrow');
    row.innerHTML = `
      ${s.image ? `<img src="${esc(imgSrc(s.image))}" loading="lazy"${s.adult ? ' class="blur-sm"' : ''}>` : '<img style="visibility:hidden">'}
      <span class="srcbadge" style="position:static;background:${SRC_COLORS[s.source]};flex-shrink:0">${SRC_SHORT[s.source]}</span>
      <span class="t">${esc(s.title)}</span>
      <span class="p">${yen(s.price)}</span>
      ${s.status === 'soldout' ? '<span class="mtag">品切</span>' : ''}`;
    row.onclick = () => openModal(s.id);
    sim.appendChild(row);
  }
  const mcover = m.querySelector('.mimg .r18cover');
  if (mcover) {
    mcover.onclick = () => {
      mcover.closest('.mimg').classList.add('revealed');
      mcover.remove();
    };
  }
  m.querySelector('#mclose').onclick = closeModal;
  $('modal').hidden = false;
}
function closeModal() { $('modal').hidden = true; }
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeModal();
  setFiltersOpen(false);
});

function histSvg(history) {
  const pts = history.filter((h) => h.price != null);
  if (pts.length < 2) return '';
  const w = 800, h = 110, pad = 6;
  const min = Math.min(...pts.map((p) => p.price));
  const max = Math.max(...pts.map((p) => p.price));
  const span = max - min || 1;
  const xs = pts.map((p, i) => pad + (i * (w - 2 * pad)) / (pts.length - 1));
  const ys = pts.map((p) => h - pad - ((p.price - min) * (h - 2 * pad)) / span);
  const line = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  return `<svg class="histchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${line}"/>
    <text x="${pad}" y="14" fill="var(--dim)" font-size="12">最高 ${yen(max)}</text>
    <text x="${pad}" y="${h - 10}" fill="var(--dim)" font-size="12">最低 ${yen(min)}</text>
  </svg>`;
}

/* ---------------- tabs ---------------- */

function switchTab(tab) {
  setFiltersOpen(false);
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  const main = document.querySelector('.main');
  const sidebar = $('sidebar');
  const grid = $('grid');
  const isGrid = isGridTab(tab);
  sidebar.style.display = isGrid ? '' : 'none';
  grid.style.display = isGrid ? '' : 'none';
  $('sentinel').style.display = isGrid ? '' : 'none';
  document.querySelector('.resultbar').style.display = isGrid ? '' : 'none';
  const old = main.querySelector('.panel');
  if (old) old.remove();
  $('emptyState').hidden = true;
  if (isGrid) {
    loadItems(true);
  } else if (tab === 'compare') {
    main.appendChild($('compareTpl').content.cloneNode(true).firstElementChild);
    initComparePanel();
  } else if (tab === 'watch') {
    main.appendChild($('watchTpl').content.cloneNode(true).firstElementChild);
    initWatchPanel();
  } else if (tab === 'system') {
    main.appendChild($('systemTpl').content.cloneNode(true).firstElementChild);
    initSystemPanel();
  }
}

async function initWatchPanel() {
  const listEl = $('watchList');
  const refresh = async () => {
    const ws = await api('/api/watches');
    listEl.replaceChildren();
    if (!ws.length) listEl.appendChild(el('li', null, '目前沒有關注中的關鍵字。'));
    for (const w of ws) {
      const li = el('li');
      li.appendChild(el('span', 'kw', w.keyword));
      const rmBtn = el('button', 'del', '✕');
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
    logEl.textContent = st.log.join('\n');
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
  const s = await loadStats();
  $('intervalInput').value = s.crawlIntervalHours;
  if (s.cloudMode) {
    $('localCrawlSection').hidden = true;
    $('cloudCrawlHint').hidden = false;
    $('sgySection').hidden = true;
    return;
  }
  const st = await api('/api/crawl/status');
  if (st.running && !crawlPoll) crawlPoll = setInterval(poll, 1500);
  poll();
}

/* ---------------- quick compare ---------------- */

async function initComparePanel() {
  const input = $('compareInput');
  input.value = state.q || $('searchInput').value.trim();
  const run = async () => {
    const q = input.value.trim();
    if (!q) return toastMsg('請輸入關鍵字');
    $('compareGo').disabled = true;
    try {
      const r = await api('/api/compare?q=' + encodeURIComponent(q) + ($('compareInstock').checked ? '&instock=1' : ''));
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
  const mins = Object.values(r.summary)
    .map((s) => s.cheapest && s.cheapest.price)
    .filter((p) => p != null);
  const best = mins.length ? Math.min(...mins) : null;
  for (const [src, s] of Object.entries(r.summary)) {
    const d = el('div', 'cmp-src' + (s.cheapest && s.cheapest.price === best && best != null ? ' best' : ''));
    const name = el('div', 'name');
    const dot = el('span', 'srcdot');
    dot.style.background = SRC_COLORS[src];
    name.appendChild(dot);
    name.appendChild(document.createTextNode(SRC_SHORT[src]));
    d.appendChild(name);
    if (s.cheapest && s.cheapest.price != null) {
      d.appendChild(el('div', 'min', yen(s.cheapest.price)));
      d.appendChild(el('div', 'cnt', `共 ${s.count.toLocaleString()} 件`));
    } else {
      d.appendChild(el('div', 'nores', '無符合商品'));
    }
    sum.appendChild(d);
  }
  const list = $('cmpList');
  list.replaceChildren();
  if (!r.items.length) {
    list.appendChild(el('p', 'hint', '沒有符合的商品，試試更換關鍵字或取消「只比有貨」。'));
    return;
  }
  for (const it of r.items) {
    const row = el('div', 'cmp-row' + (it.status === 'soldout' ? ' sold' : ''));
    const img = el('img');
    if (it.image) {
      img.loading = 'lazy';
      img.src = imgSrc(it.image);
      if (it.adult) img.classList.add('blur-sm');
    }
    row.appendChild(img);
    const b = el('span', 'badge-sm', SRC_SHORT[it.source]);
    b.style.background = SRC_COLORS[it.source];
    row.appendChild(b);
    row.appendChild(el('span', 't', it.title));
    if (it.condition) row.appendChild(el('span', 'cond-sm', it.condition + (it.status === 'soldout' ? '・品切' : '')));
    row.appendChild(el('span', 'p', yen(it.price)));
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
  localStorage.setItem('danmaku', e.target.checked ? '1' : '0');
  if (e.target.checked) danmakuStart();
  else danmakuStop();
});
if (localStorage.getItem('danmaku') === '1') {
  $('danmakuToggle').checked = true;
  danmakuStart();
}

/* ---------------- live search ---------------- */

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
    btn.innerHTML = '同步最新結果';
    $('liveStatus').textContent = '';
  }
}

/* ---------------- init ---------------- */

let searchTimer = null;
$('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = $('searchInput').value.trim();
    if (isGridTab(state.tab)) loadItems(true);
  }, 300);
});
$('liveBtn').onclick = liveSearch;
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) liveSearch();
});

for (const inp of ['minPrice', 'maxPrice']) {
  $(inp).addEventListener('change', () => {
    state.minPrice = $('minPrice').value ? Number($('minPrice').value) : null;
    state.maxPrice = $('maxPrice').value ? Number($('maxPrice').value) : null;
    updateFilterButton();
    loadItems(true);
  });
}
$('instockOnly').addEventListener('change', (e) => { state.instock = e.target.checked; updateFilterButton(); loadItems(true); });
$('sortSel').addEventListener('change', (e) => { state.sort = e.target.value; loadItems(true); });
$('clearFilters').onclick = () => {
  state.sources = new Set(ALL_SOURCES);
  state.categories.clear();
  state.tag = null;
  state.instock = false;
  state.minPrice = state.maxPrice = null;
  $('minPrice').value = $('maxPrice').value = '';
  $('instockOnly').checked = false;
  updateFilterButton();
  loadFacets();
  loadItems(true);
};

$('filterToggle').onclick = () => setFiltersOpen(true);
$('filterClose').onclick = () => setFiltersOpen(false);
$('filterDone').onclick = () => setFiltersOpen(false);
$('sidebarBackdrop').onclick = () => setFiltersOpen(false);
window.addEventListener('resize', () => {
  if (window.innerWidth > 900) setFiltersOpen(false);
});

$('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tab');
  if (t) switchTab(t.dataset.tab);
});
$('modal').querySelector('.modal-backdrop').onclick = closeModal;

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && !state.loading && !state.done && isGridTab(state.tab)) {
    loadItems(false);
  }
}).observe($('sentinel'));

loadFacets();
loadStats();
loadItems(true);
setInterval(loadStats, STATS_REFRESH_MS);
