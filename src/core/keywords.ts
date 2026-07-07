/** BanG Dream! 詞庫：作品、樂團、角色。用於掃站關鍵字、相關性過濾與標籤。 */

export function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 預設掃站關鍵字（各站爬蟲輪詢用） */
export const DEFAULT_SWEEP = [
  'バンドリ',
  'BanG Dream',
  'ガルパ',
  'Poppin\'Party',
  'Roselia',
  'MyGO!!!!!',
  'Ave Mujica',
  'RAISE A SUILEN',
  'Morfonica',
];

export interface TagDef {
  tag: string;
  patterns: (RegExp | string)[]; // strings are matched against NFKC-lowercased text
}

export const BANDS: TagDef[] = [
  { tag: "Poppin'Party", patterns: [/poppin['’]?\s*party/, 'ポッピンパーティ', 'ポピパ'] },
  { tag: 'Roselia', patterns: [/roselia/, 'ロゼリア'] },
  { tag: 'Afterglow', patterns: [/afterglow/] },
  { tag: 'Pastel*Palettes', patterns: [/pastel\s*[*＊]?\s*palettes/, 'パスパレ', 'パステルパレット'] },
  { tag: 'ハロー、ハッピーワールド！', patterns: ['ハロハピ', 'ハロー、ハッピーワールド', /hello,?\s*happy\s*world/] },
  { tag: 'RAISE A SUILEN', patterns: [/raise\s*a\s*suilen/, 'レイズアスイレン', /\bras\b/] },
  { tag: 'Morfonica', patterns: [/morfonica/, 'モルフォニカ', 'モニカ'] },
  // \b 必須：不然會命中 OhMyGod / JimmyGonzalez / MyGoldMask 這類洋樂專輯
  { tag: 'MyGO!!!!!', patterns: [/\bmygo\b/, 'マイゴ'] },
  { tag: 'Ave Mujica', patterns: [/ave\s*mujica/, 'アヴェムジカ', 'アヴェ・ムジカ'] },
  { tag: 'Glitter*Green', patterns: [/glitter\s*[*＊]?\s*green/, 'グリッターグリーン'] },
  { tag: '夢限大みゅーたいぷ', patterns: ['夢限大みゅーたいぷ', '夢限大ミュータイプ', 'みゅーたいぷ'] },
];

/**
 * 角色表（緊湊格式）：`;` 分隔角色、`|` 分隔別名，首項=全名（可獨立判相關）。
 * `標籤=全名` 表示顯示標籤與全名不同；`~xxx` 表示需要單字邊界（避免 layer 誤中 player）。
 */
const CHAR_DATA =
  '戸山香澄|香澄|kasumi;花園たえ|おたえ;牛込りみ;山吹沙綾|沙綾;市ヶ谷有咲|有咲;' + // Poppin'Party
  '美竹蘭;青葉モカ;上原ひまり;宇田川巴;羽沢つぐみ;' + // Afterglow
  '丸山彩;氷川日菜;白鷺千聖|千聖;大和麻弥;若宮イヴ;' + // Pastel*Palettes
  '湊友希那|友希那;氷川紗夜|紗夜;今井リサ;宇田川あこ;白金燐子|燐子;' + // Roselia
  '弦巻こころ;瀬田薫;北沢はぐみ|はぐみ;松原花音|花音;ミッシェル=奥沢美咲|ミッシェル;' + // ハロハピ
  'LAYER=和奏レイ|~layer;LOCK=朝日六花|六花;MASKING=佐藤ますき|masking;PAREO=鳰原れおな|pareo|パレオ;CHU²=チュチュ|chu2|chu²;' + // RAS
  '倉田ましろ|ましろ;桐ヶ谷透子|透子;広町七深|七深;二葉つくし;八潮瑠唯|瑠唯;' + // Morfonica
  '高松燈;千早愛音|愛音;要楽奈|楽奈;長崎そよ;椎名立希|立希;' + // MyGO!!!!!
  '三角初華|初華|doloris;若葉睦|mortis;八幡海鈴|海鈴|timoris;祐天寺にゃむ|にゃむ|amoris;豊川祥子|祥子|oblivionis'; // Ave Mujica

export const CHARACTERS: TagDef[] = CHAR_DATA.split(';').map((entry) => {
  const [head, ...alts] = entry.split('|');
  const [tag, fullName] = head.includes('=') ? head.split('=') : [head, head];
  const patterns = [fullName, ...alts].map((p) => (p.startsWith('~') ? new RegExp(`\\b${p.slice(1)}\\b`) : p));
  return { tag, patterns };
});

/** 作品本體判定（相關性核心）。注意排除 バンドリエール(LV包)、ガルパン(戰車) 等偽命中。 */
const FRANCHISE_RX: RegExp[] = [
  /バンドリ(?!エール|ング|ムーバ|ル)/,
  /bang[\s_!-]*dream/,
  /ガルパ(?!ン|ート)/,
  /garupa/,
  /ガールズバンドパーティ/,
  /girls\s*band\s*party/,
];

function matchDef(text: string, def: TagDef): boolean {
  for (const p of def.patterns) {
    if (typeof p === 'string') {
      if (text.includes(norm(p))) return true;
    } else {
      const rx = new RegExp(p.source, p.flags.includes('i') ? p.flags : p.flags + 'i');
      if (rx.test(text)) return true;
    }
  }
  return false;
}

/** 回傳命中的樂團/角色標籤 */
export function extractTags(text: string): string[] {
  const t = norm(text);
  const tags: string[] = [];
  for (const b of BANDS) if (matchDef(t, b)) tags.push(b.tag);
  for (const c of CHARACTERS) if (matchDef(t, c)) tags.push(c.tag);
  return tags;
}

/** 18+ 商品判定（標題/分類路徑的文字特徵；「未成年」不算） */
const ADULT_RX = /r-?18|18禁|(?<!未)成年|成人向|アダルト|官能|えっち|エッチ(?!ング)|ふたなり|抱き枕.{0,12}成年/i;
export function isAdultText(text: string): boolean {
  return ADULT_RX.test(norm(text));
}

/** 判定商品是否為 BanG Dream 相關 */
export function isRelevant(text: string): boolean {
  const t = norm(text);
  if (FRANCHISE_RX.some((rx) => rx.test(t))) return true;
  // 樂團名或明確角色全名也算（商品名可能只寫 Roselia）
  for (const b of BANDS) {
    if (b.tag === 'RAISE A SUILEN') {
      // 避免 \bras\b 誤殺：單獨 RAS 需搭配其他訊號，全名/片假名可直接過
      if (t.includes('raise a suilen') || t.includes('レイズアスイレン')) return true;
      continue;
    }
    if (b.tag === 'Afterglow') {
      // afterglow 是常見英文單字，僅在明確樂團寫法時採信
      if (/afterglow/.test(t) && /バンド|bang|ガルパ|美竹|青葉|上原|宇田川|羽沢/.test(t)) return true;
      continue;
    }
    if (b.tag === 'Morfonica' && t.includes('モニカ') && !t.includes('モルフォニカ') && !/morfonica/.test(t)) continue;
    if (matchDef(t, b)) return true;
  }
  for (const c of CHARACTERS) {
    // 只有全名（第一個 pattern，字串且長度>=4）可獨立判相關，短暱稱太容易誤傷
    const first = c.patterns[0];
    if (typeof first === 'string' && norm(first).length >= 4 && t.includes(norm(first))) return true;
  }
  return false;
}
