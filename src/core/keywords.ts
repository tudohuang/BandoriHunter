/** BanG Dream! 詞庫：作品、樂團、角色、聲優。用於掃站關鍵字、相關性過濾與標籤。 */

export function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 作品／樂團掃站關鍵字（完整清單 DEFAULT_SWEEP 在檔尾，含聲優） */
const FRANCHISE_SWEEP = [
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

/**
 * 人名比對用：字串頭尾是漢字時加「非漢字邊界」（鈴木愛美 ≠ 愛美）；純英數名加 \b（MIKAsa ≠ mika）。
 * 比對目標是 norm() 過的文字，所以先 normalize 再造 regex。
 */
function nameRx(name: string): RegExp {
  const n = norm(name);
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[\x00-\x7f]+$/.test(n)) return new RegExp(`\\b${esc}\\b`);
  const kanji = '\\u4e00-\\u9fff\\u3005'; // 3005=々
  const pre = new RegExp(`^[${kanji}]`).test(n) ? `(?<![${kanji}])` : '';
  const post = new RegExp(`[${kanji}]$`).test(n) ? `(?![${kanji}])` : '';
  return new RegExp(pre + esc + post);
}

/**
 * 聲優表（格式同 CHAR_DATA：`;` 分隔、`|` 分隔別名，首項=藝名/本名）。
 * 前綴 `!` = 僅作標籤：不掃站、不獨立判相關 —— 多作品大牌（佐倉綾音、上坂すみれ…）或
 * 名字太通用（mika），直接掃會把大量非邦邦商品灌進庫；要追蹤誰就把 `!` 拿掉。
 * 真實樂團編制（PPP/Roselia/RAS/Morfonica/MyGO/Ave Mujica）的成員個人周邊視同邦邦周邊。
 */
const SEIYUU_DATA =
  '愛美|~aimi;大塚紗英;西本りみ;大橋彩香;伊藤彩沙;' + // Poppin'Party
  '!佐倉綾音;!三澤紗千香;!加藤英美里;!日笠陽子;!金元寿子;' + // Afterglow
  '!前島亜美;!小澤亜李;!上坂すみれ;!中上育実;!秦佐和子;' + // Pastel*Palettes
  '相羽あいな;工藤晴香;中島由貴;櫻川めぐ;志崎樺音;!遠藤ゆりか;!明坂聡美;' + // Roselia（含前任）
  '!伊藤美来;!田所あずさ;!吉田有里;!豊田萌絵;!黒沢ともよ;' + // ハロハピ
  'Raychell;小原莉子;夏芽;紡木吏佐;倉知玲鳳;' + // RAS
  '進藤あまね;直田姫奈;西尾夕香;!mika;Ayasa;' + // Morfonica
  '羊宮妃那;立石凛;青木陽菜;小日向美香;林鼓子;' + // MyGO!!!!!
  '佐々木李子;渡瀬結月;米澤茜;岡田夢以;高尾奏音'; // Ave Mujica

export const SEIYUU: (TagDef & { sweep: boolean })[] = SEIYUU_DATA.split(';').map((entry) => {
  const sweep = !entry.startsWith('!');
  const [name, ...alts] = (sweep ? entry : entry.slice(1)).split('|');
  const patterns: (RegExp | string)[] = [
    nameRx(name),
    ...alts.map((p) => (p.startsWith('~') ? new RegExp(`\\b${p.slice(1)}\\b`) : p)),
  ];
  return { tag: name, patterns, sweep };
});

export const SEIYUU_SWEEP = SEIYUU.filter((s) => s.sweep).map((s) => s.tag);

/** 預設掃站關鍵字（各站爬蟲輪詢用）：作品/樂團 + 可掃聲優 */
export const DEFAULT_SWEEP = [...FRANCHISE_SWEEP, ...SEIYUU_SWEEP];

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

/** 回傳命中的樂團/角色/聲優標籤 */
export function extractTags(text: string): string[] {
  const t = norm(text);
  const tags: string[] = [];
  for (const b of BANDS) if (matchDef(t, b)) tags.push(b.tag);
  for (const c of CHARACTERS) if (matchDef(t, c)) tags.push(c.tag);
  for (const s of SEIYUU) if (matchDef(t, s)) tags.push(s.tag);
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
  // 可掃聲優的個人周邊視同相關（僅 sweep 名單；標籤用大牌名單不在此列，避免誤收非邦邦商品）
  for (const s of SEIYUU) if (s.sweep && matchDef(t, s)) return true;
  return false;
}
