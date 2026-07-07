import { norm } from './keywords.js';

export const CATEGORIES = [
  'CD',
  'BD/DVD',
  '法被',
  'アクリル',
  'ぬいぐるみ',
  '缶バッジ',
  'フィギュア',
  'タペストリー',
  'ポスター',
  'ラバスト',
  'キーホルダー',
  'ストラップ',
  'クリアファイル',
  'カード',
  'タオル',
  '色紙',
  'ペンライト',
  '衣類',
  'ゲーム',
  '書籍',
  'ポーチ/バッグ',
  'ステッカー',
  'スタンドポップ',
  'その他',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** order matters: first match wins */
const RULES: [Category, RegExp][] = [
  ['法被', /法被|はっぴ|ハッピ(?!ー)/],
  ['タオル', /タオル/],
  ['缶バッジ', /缶バッ(ジ|チ|ヂ)|カンバッジ/],
  ['アクリル', /アクスタ|アクキー|アクリル/],
  ['ぬいぐるみ', /ぬいぐるみ|ぬいクッション|クッション|マスコット(?!キャラ)/],
  ['フィギュア', /フィギュア|プレミアムフィギュア|ねんどろいど|一番くじ.*(賞)/],
  ['タペストリー', /タペストリー/],
  ['ポスター', /ポスター/],
  ['ラバスト', /ラバースト|ラバスト|ラバーマスコット|ラバーキーホルダー/],
  ['キーホルダー', /キーホルダー|キーチェーン|チャーム/],
  ['ストラップ', /ストラップ/],
  ['クリアファイル', /クリアファイル/],
  // BD/W95-069（ヴァイス）、BD/001B-124（Reバース）這類是 BanG Dream 卡包代號，不是 Blu-ray
  ['カード', /ヴァイス|プレシャスメモリーズ|reバース|トレーディングカード|トレカ|カードダス|ブロマイド|生写真|\bpr\d|bd\/(w|s|\d)\d+|カード(?!ケース|ホルダー)/],
  ['色紙', /色紙/],
  ['ペンライト', /ペンライト|サイリウム|キンブレ/],
  ['衣類', /tシャツ|パーカー|ジャージ|コスプレ|衣装|制服/],
  ['ゲーム', /switch|ニンテンドー|nintendo|プレイステーション|ps[345]|ゲームソフト/],
  ['書籍', /画集|写真集|フォトブック|パンフレット|漫画|コミック|書籍|雑誌|楽譜|バンドスコア|スコア|小説|アンソロジー|ガイドブック|イラスト集/],
  ['ポーチ/バッグ', /ポーチ|バッグ|トートバック|トートバッグ|リュック|巾着/],
  ['ステッカー', /ステッカー|シール(?!ド)/],
  ['スタンドポップ', /スタンドポップ|スタポ|スタンディ/],
  ['CD', /(blu-?ray|ブルーレイ|bd|dvd)付/], // 「Blu-ray付生産限定盤」主體是 CD
  ['BD/DVD', /blu-?ray|ブルーレイ|\bbd\b|dvd/],
  ['CD', /\bcd\b|アルバム|シングル|サントラ|サウンドトラック|盤\b/],
];

/**
 * @param title 商品名
 * @param hint 網站自身的分類字串（lashinbang path、bookoff genre 等），優先於商品名判斷
 */
export function categorize(title: string, hint?: string | null): Category {
  // 商品名優先（最具體），網站分類字串只當後備。
  // 例：らしんばん的路徑「缶バッジ・アクリル・ラバスト・キーホルダー類」一次涵蓋四類，不能直接採信。
  const t = norm(title);
  for (const [cat, rx] of RULES) if (rx.test(t)) return cat;

  const h = hint ? norm(hint) : '';
  if (h) {
    if (/音楽cd|^cd|:cd/.test(h)) return 'CD';
    if (/blu-?ray|dvd|映像/.test(h)) return 'BD/DVD';
    if (/アクリル|アクスタ/.test(h)) return 'アクリル';
    if (/缶バッ/.test(h)) return '缶バッジ';
    if (/ぬいぐるみ/.test(h)) return 'ぬいぐるみ';
    if (/フィギュア/.test(h)) return 'フィギュア';
    if (/タペストリ/.test(h)) return 'タペストリー';
    if (/カード|tcg|トレカ/.test(h)) return 'カード';
    if (/ゲーム/.test(h)) return 'ゲーム';
    if (/書籍|本|コミック|雑誌/.test(h)) return '書籍';
    if (/タオル/.test(h)) return 'タオル';
    if (/衣類|アパレル|tシャツ/.test(h)) return '衣類';
    for (const [cat, rx] of RULES) if (rx.test(h)) return cat;
  }
  return 'その他';
}
