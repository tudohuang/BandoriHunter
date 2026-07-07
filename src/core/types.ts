export type Source = 'surugaya' | 'lashinbang' | 'hardoff' | 'bookoff' | 'kbooks' | 'mercari';

export const SOURCE_NAMES: Record<Source, string> = {
  surugaya: '駿河屋（Yahoo!店）',
  lashinbang: 'らしんばん',
  hardoff: 'HARD OFF / HOBBY OFF',
  bookoff: 'BOOKOFF',
  kbooks: 'K-BOOKS',
  mercari: 'メルカリ',
};

export type Stock = 'instock' | 'soldout' | 'unknown';

export interface RawItem {
  source: Source;
  sourceId: string;
  url: string;
  title: string;
  price: number | null;
  status: Stock;
  condition: string | null;
  image: string | null;
  jan: string | null;
  shopInfo: string | null;
  series: string | null;
  note: string | null;
  /** extra text (brand, code, category path) used for relevance matching, not displayed */
  searchText?: string;
  /** 網站明確標示的 18+ 旗標（文字特徵判定另外在入庫時做） */
  adult?: boolean;
}

export interface SearchPage {
  items: RawItem[];
  total: number | null;
  hasNext: boolean;
}

export interface Adapter {
  source: Source;
  displayName: string;
  /** ms between requests to this site */
  minInterval: number;
  search(keyword: string, page: number): Promise<SearchPage>;
  /** override sweep keywords for this site (e.g. K-Books only indexes official titles) */
  sweepKeywords?(defaults: string[]): string[];
}

export interface ItemRow {
  id: number;
  source: Source;
  source_id: string;
  url: string;
  title: string;
  title_norm: string;
  price: number | null;
  status: Stock;
  condition: string | null;
  image: string | null;
  jan: string | null;
  shop_info: string | null;
  series: string | null;
  note: string | null;
  category: string;
  tags: string; // JSON array of band/character tags
  first_seen: string;
  last_seen: string;
  wished: 0 | 1;
  adult: 0 | 1;
}

export interface CrawlSiteReport {
  source: Source;
  found: number;
  added: number;
  priceChanged: number;
  errors: string[];
}

export interface CrawlReport {
  startedAt: string;
  finishedAt: string;
  sites: CrawlSiteReport[];
  newItems: ItemRow[];
  baseline: boolean;
}
