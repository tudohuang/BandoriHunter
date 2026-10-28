# 🎸 Bandori Hunter

BanG Dream!（バンドリ）中古／二手商品比價網站。把六個日本中古網站的邦邦周邊（含 MyGO!!!!!、Ave Mujica 與聲優個人周邊）抓進同一個介面，提供搜尋、行情、降價追蹤與跨站比價。

公開站：https://bandori-hunter.bangdreamapp947.workers.dev

## 功能

- **全部商品／新上架／降價中**：六站合併瀏覽，可依來源、分類、樂團・角色、聲優、價格篩選；搜尋支援「-詞」排除
- **行情**：搜尋時顯示在售最低/中位數、近期售完（含メルカリ成交）的四分位與價格分布圖；成交樣本 ≥ 5 件才給「便宜/偏貴」判斷
- **比價・行情分頁**：一次看六站各自最低價
- **メルカリ優惠券試算**：輸入折扣 %（可設上限）或折抵金額（可設最低消費），卡片顯示券後價，價格排序以券後價計
- **分享連結**：搜尋條件、分頁與打開的商品都寫進網址
- 願望清單（公開站存在瀏覽器）、深色模式、價格紀錄圖、跨站相似商品
- **新品通知**：使用者在網站上貼自己的 Discord webhook、設關鍵字，有新品上架就推到自己的頻道；本機另有 Windows toast
- 本機版另有：即時同步各站、手動掃站、網頁上管理關注關鍵字

---

## 架構總覽

```
                    ┌──────────────── GitHub Actions（.github/workflows/crawl.yml）────────────────┐
                    │                                                                              │
 6 個中古網站 ──爬──▶│  crawl（src/core/crawler.ts）──upsert──▶ Turso（libSQL，爬蟲狀態庫）           │
                    │                                              │                               │
                    │                                   export-static（scripts/export-static.mts）  │
                    │                                              ▼                               │
                    │                              public/snapshot/*.json（靜態快照）               │
                    │                                              │                               │
                    │                                   wrangler deploy                            │
                    └──────────────────────────────────────────────┼───────────────────────────────┘
                                                                   ▼
                                          Cloudflare Workers + Static Assets
                                          ├─ public/ 靜態檔（HTML/JS/CSS/快照）直接回，不經 Worker
                                          └─ worker/index.js：只處理 /img 圖片代理（後備）
                                                                   │
                                                                   ▼
                                    瀏覽器（public/app.js）在前端讀快照做搜尋/篩選/行情
                                    圖片直連各站 CDN，失敗才走 /img
```

設計重點：**公開站是純靜態、唯讀**。所有查詢都在瀏覽器裡對快照做，伺服器端沒有資料庫查詢，流量幾乎全是 CDN 靜態檔（Cloudflare 免費且不限量）。Turso 只給 GitHub Actions 的爬蟲用。

同一套程式也能在本機跑完整版（`npm run serve`）：Express 直接查本機 SQLite（或 Turso），前端改走 `/api/*`。

### 目錄

| 路徑 | 內容 |
|---|---|
| `src/core/adapters/*.ts` | 各站爬蟲（`Adapter` 介面：`search(keyword, page)`） |
| `src/core/crawler.ts` | 掃站流程：關鍵字輪詢、翻頁、增量停止條件、下架判定、即時搜尋 |
| `src/core/keywords.ts` | 詞庫：作品/樂團/角色/聲優/曲名、相關性判定 `isRelevant`、標籤 `extractTags` |
| `src/core/categorize.ts` | 商品分類（法被、アクリル、缶バッジ、CD、BD/DVD…） |
| `src/core/db.ts` | libSQL 存取：schema、批次 upsert、查詢、行情、降價 |
| `src/core/http.ts` | 共用 HTTP：每站節流、重試、瀏覽器 UA |
| `src/core/notify.ts` | 新品通知：使用者訂閱與站長關注的 Discord 發送、Windows toast（本機） |
| `src/core/subs.ts` | 通知訂閱 API（Worker 與本機共用） |
| `src/server/index.ts` | 本機 Express API ＋ `/img` 代理 |
| `src/cli/index.ts` | CLI（`search` / `crawl` / `watch` / `serve` …） |
| `scripts/export-static.mts` | 匯出公開站快照 |
| `scripts/push-to-turso.mts` | 本機 DB 整批鏡像到 Turso（首次建雲端用） |
| `scripts/clean-noise.mts` | 清掉已入庫的同名雜訊 |
| `public/` | 前端（無框架、無建置步驟）＋ `_headers` 快取規則 |
| `worker/index.js`、`wrangler.toml` | Cloudflare Worker 設定 |

---

## 資料來源（adapters）

| 站 | 檔案 | 方式 | 每次請求間隔 | 備註 |
|---|---|---|---|---|
| メルカリ | `mercari.ts` | JSON API `api.mercari.jp/v2/entities:search` | 2.5 s | 需 DPoP：每次啟動自產 P-256 金鑰、每個請求簽一個 JWT，免登入。含 Mercari Shops |
| らしんばん | `lashinbang.ts` | JSON API | 2.5 s | 狀態、店舖、系列資料最完整 |
| 駿河屋 | `surugaya.ts` | Yahoo!ショッピング店頁的 `__NEXT_DATA__` | 3.5 s | 本站有 Cloudflare 人機驗證，改抓官方 Yahoo! 店；有 JAN 可跨站比對 |
| K-BOOKS | `kbooks.ts` | JSON API（groobee） | 2.5 s | 只索引「BanG Dream」開頭的正式品名，掃站關鍵字固定改用正式名 |
| HARD OFF / HOBBY OFF | `hardoff.ts` | NetMall HTML（cheerio） | 3 s | 實體店上架 |
| BOOKOFF | `bookoff.ts` | HTML（cheerio） | 2.5 s | CD/BD/書為主 |

`http.ts` 依 host（或 `throttleKey`）把請求排隊、保證最小間隔；429/5xx 退避重試 2 次、單次逾時 45 秒。六站平行跑，同站內嚴格序列。

### メルカリ的深度問題

メルカリ單一搜尋最多只能翻到 15,000 件（125 頁 × 120）。熱門詞（MyGO、Ave Mujica）都超過上限，所以完整掃站時把每個關鍵字切成 6 個價格帶各自翻到底：

```
¥0–999 / ¥1,000–1,999 / ¥2,000–3,499 / ¥3,500–5,999 / ¥6,000–11,999 / ¥12,000–
```

價格帶寫在關鍵字尾端（例：`MyGO〔¥1000-1999〕`），由 `mercari.sweepKeywords(defaults, full)` 展開、`parseKeyword` 解析成 `priceMin/priceMax`。實測 MyGO 單一關鍵字完整掃站約 29,700 件相關品項（原本 60 頁上限只能到約 6,500）。增量掃站只看最新幾頁，不切價格帶。

另外會收：狀態（新品、未使用〜全体的に状態が悪い）、運費（送料込み/着払い）、上架時間（`listed_at`）。

---

## 掃站流程（`crawler.ts`）

**關鍵字**：`DEFAULT_SWEEP` = 作品/樂團（バンドリ、BanG Dream、ガルパ、Poppin'Party、Roselia、MyGO!!!!!、Ave Mujica、RAISE A SUILEN、Morfonica）＋ 可掃的聲優名。多作品大牌聲優只當標籤、不掃站（詞庫裡加 `!` 前綴），以免灌進大量非邦邦商品。

**兩種模式**：

| | 增量（每小時） | 完整（每天 03:07 JST，或 `--full`） |
|---|---|---|
| 頁數 | 每關鍵字最多 5 頁，**連續 2 頁沒新品就換下一個** | 翻到底（メルカリ 125 頁、其他站 60 頁） |
| メルカリ價格帶 | 不切 | 切 6 帶 |
| 寫入 | 只寫新品與價格/狀態有變的列 | 每列都更新（含 `last_seen`） |
| 下架判定 | 無 | 有（見下） |

每個站第一次掃（`meta.baseline_<source>` 不存在）自動走完整模式，且不發新品通知。

**下架判定**：メルカリ的完整掃站若「預設關鍵字、沒有錯誤、沒有任何關鍵字翻到頁數上限」，代表涵蓋了全部相關品項；這時本次沒再出現、但 DB 仍標有貨的品項改為售完（`markUnseenSold`）。不然被刪除/賣掉的商品會永遠顯示有貨。

掃完後：比對關注關鍵字發通知（非首次、非 quiet）、更新 `last_crawl`、預算標籤統計存 `meta.facet_tags`。

---

## 相關性判定（`keywords.ts`）

各站搜尋會混進大量同名雜訊（Bandolino 鞋、LV マルリーバンドリエール、GUCCI バンドリング、ガルパン、ブロスタ的モーティス、Raychell 自行車…），入庫前用 `isRelevant(title + series + searchText)` 過濾。文字先 `norm()`：NFKC、小寫、壓空白。判定依序：

1. **否決**：ヴィトン/vuitton 直接排除（LV 包標題常被截在「バンドリ(エール)」）
2. **作品本體** `FRANCHISE_RX`：バンドリ（排除 エール/ング/ーノ/ール/ーダ 等字尾）、bang dream、ガルパ（排除 ガルパン）、ガールズバンドパーティ，以及作品內專有名詞 マイムジ、CRYCHIC、アベムジカ、迷子のバンド、sumimi，與卡牌代號 `BD/W125-…`（ヴァイス）、`BD/001B-…`（Reバース）
3. **法被規則**：標題有 法被/はっぴ/ハッピ 且命中任一樂團或角色暱稱（Afterglow、パレオ…）即相關——應援法被幾乎只有粉絲周邊會出
4. **樂團名**：Afterglow 是常見英文單字，需要搭配其他邦邦訊號；單獨 RAS 也一樣；モニカ 需寫成 モルフォニカ
5. **Ave Mujica 面具名**：ドロリス、ティモリス、アモーリス、オブリビオニス；モーティス 排除ブロスタ
6. **曲名／專輯名**：迷跡波、端程山、詩超絆、KiLLKiSS、黒のバースデイ… 只收夠獨特的
7. **角色全名**：≥ 3 字（高松燈、要楽奈也算），比對時忽略空白（「高松 燈」）；短暱稱不能單獨判定
8. **聲優**：僅可掃名單；人名前後加「非漢字邊界」（鈴木愛美 ≠ 愛美），並排除已知撞名雜訊

`extractTags` 用同一份詞庫打樂團/角色/聲優標籤（前端的樂團・角色、聲優篩選就是這個）。`isAdultText` 標記 R18，前端預設打碼。

改了詞庫後，已入庫的雜訊可以用 `npx tsx scripts/clean-noise.mts` 重判清除。

---

## 資料庫（`db.ts`）

libSQL：設了 `TURSO_DATABASE_URL` 走 Turso，否則用本機 `data/bandori.db`。

```sql
items(id, source, source_id, url, title, title_norm, price, status, condition, image, jan,
      shop_info, series, note, category, tags, adult, listed_at, first_seen, last_seen, wished,
      UNIQUE(source, source_id))
price_history(id, item_id, price, status, seen_at)   -- 只在價格或狀態變動時新增一列
watches(id, keyword, created_at)
meta(key, value)                                     -- baseline 旗標、last_crawl、facet_tags、設定
```

- `status`：`instock` / `soldout` / `unknown`；`title_norm` 是 norm 過的標題+系列+站內分類字串，搜尋用
- 欄位遷移用 `ALTER TABLE … ADD COLUMN` 並吞掉「已存在」錯誤（`ready()`）
- **批次 upsert**：每頁一次 `SELECT … IN (…)` 查既有，再一次 `batch` 寫入；Turso 遠端時把往返壓到最低
- **大量讀取一律分批**（`getItems` 每批 200 筆 `IN`）：一次併發數千個查詢會讓 Turso 直接斷線
- **降價**：現價是近 30 天內降下來、且低於最早記錄價格才算（漲回原價、很久以前的降價都不算）。SQL 版在 `PREV_PRICE_SQL`，前端版 `recentDropFrom`、匯出版在 `export-static.mts`，三處同定義
- **行情** `marketFrom`：在售最低/中位數、售完的 P25/P50/P75、最多 2,000 點價格分布；前端快照模式用同一套算法

---

## 靜態快照（`export-static.mts`）

輸出到 `public/snapshot/`（不進 git），格式：

```
meta.json                     統計、篩選欄計數、分頁徽章數、files 清單
items-<bucket>-<hash>.json    依 id 區間分塊（每塊涵蓋 4,000 個 id），檔名帶內容 sha1
```

- **瘦身**：售完且超過 90 天（`STATIC_SOLD_KEEP_DAYS`）沒再出現的不輸出；省略 null、`title_norm`、`wished`；可由 `source_id` 推回的網址不存（前後端共用 `URL_RULES`）；時間存 unix 秒
- **價格紀錄**：價格真的變過的品項附 `h: [[unix 秒, 價格], …]`（最多 24 筆）
- **快取友善**：id 只增不減，新品只會落在最後一塊；`last_seen` 取整到天。沒變的分塊檔名不變，瀏覽器與 CDN 永久快取（`_headers`：分塊 `immutable`、`meta.json` 每次重新驗證）。增量掃站後回訪只需重抓變動的幾塊
- **篩選欄計數、新上架/降價徽章**直接算好放 `meta.json`，前端不必為了顯示數字下載全部分塊

規模參考：約 8 萬件 → 未壓縮 36 MB、brotli 傳輸約 4.5 MB。

---

## 前端（`public/`）

無框架、無建置步驟的單頁（`index.html` + `app.js` + `style.css`）。

**兩種資料模式**（`init()` 判斷）：

| | 公開站（快照模式） | 本機（API 模式） |
|---|---|---|
| 條件 | 非 localhost，或網址加 `?snapshot` | localhost |
| 資料 | 讀 `/snapshot/*`，`snapshotApi()` 在瀏覽器裡模擬 `/api/*` 的讀取端 | `/api/*` 查 DB |
| 願望清單 | `localStorage` | DB（`wished` 欄） |
| 關注通知、設定、即時同步 | 隱藏 | 可用 |

**快照載入策略**：首屏（預設「最新收錄」、無條件）只讀最後一個分塊；一旦搜尋或篩選，才平行下載全部分塊、建 `byId` 索引，之後所有篩選/排序/行情/相似商品都在記憶體裡做。載入時 `prepItem` 補回省略的欄位、預算搜尋字串與降價前價格。

**其他實作**：
- **網址狀態**：`syncUrl` / `readUrl` 把分頁、搜尋、來源、分類、標籤、價格、排序、打開的商品寫進 query string（`history.replaceState`）
- **競態處理**：每次重新查詢遞增 `reqId`，晚回來的舊結果直接丟棄
- **圖片**：直接從各站 CDN 載（`<meta name="referrer" content="no-referrer">`）；全域 `error` 捕捉在第一次失敗時改走 `/img?u=` 代理，再失敗才顯示「無圖片」
- **主題**：CSS 變數設計 token，`prefers-color-scheme` ＋ 手動切換（`data-theme`），`localStorage` 記住
- 骨架載入、無限捲動（IntersectionObserver）、R18 打碼、手機版側欄抽屜與底部彈出的商品視窗、彈幕（最近收錄商品飄過畫面）

---

## 伺服器端

**Cloudflare Worker**（`worker/index.js`）：靜態檔由 Static Assets 直接回，不經過程式、不算請求額度；Worker 只處理：
- `/img?u=`：白名單網域才代理，帶各站要求的 Referer，邊緣快取 7 天
- `/api/subs*`：使用者通知訂閱（連 Turso）
- 其他 `/api/*`：回 404（公開站商品資料唯讀，讀 `/snapshot`）

**本機 Express**（`src/server/index.ts`）：`/api/items`、`/api/market`、`/api/facets`、`/api/compare`、`/api/item/:id`、`/api/stats`、願望清單、關注、即時搜尋、掃站觸發與狀態、設定。偵測到雲端環境時寫入類 API 一律 403，避免任何訪客改 webhook 或叫伺服器去爬站。

---

## 新品通知（`notify.ts`、`subs.ts`）

**使用者自己訂閱**：網站的「🔔 通知」分頁貼上自己的 Discord webhook、填最多 10 個關鍵字即可，搜尋結果列也有「通知我」按鈕。

- `POST /api/subs` 先對 webhook 發一則確認訊息，Discord 收得到才建立（webhook 網址本身就是秘密，能拿到的人才有權限），回傳管理 token；DB 只存 token 的 SHA-256
- `GET / PUT / DELETE /api/subs/:id`、`POST /api/subs/:id/test` 要帶 `Authorization: Bearer <token>`；token 存在使用者瀏覽器（`localStorage.bh_sub`）
- 同一個 webhook 重新註冊會覆蓋舊設定（遺失 token 的補救）；每個 IP 每天最多建 5 個、總數上限 2,000；webhook 被刪除（401/404）累計 3 次自動移除
- 處理邏輯 `src/core/subs.ts` 只用 Web 標準 API，Cloudflare Worker 與本機 Express 共用；資料在 Turso 的 `subscriptions` 表，Worker 的 Turso 連線資訊由 workflow 用 `wrangler secret bulk` 設定
- 每個訂閱一次掃站最多一則訊息（列出各關鍵字命中數＋最多 10 張商品卡）；遇到 Discord 429 依 `retry_after` 等待

**通知哪些商品**：首次建庫的站不算；完整掃站會翻到以前沒抓到的舊品，所以有上架時間的（メルカリ）只通知 48 小時內上架的，沒有上架時間的只在增量掃站通知。

**站長自己的關注**（舊機制，仍可用）：每次掃站結束，把「新上架」（首次建庫的站不算）跟關注關鍵字比對：關鍵字拆成 token，每個都要出現在標題或標籤裡才算命中。命中的每個關鍵字發一則 Discord 訊息（最多附 10 張商品卡：標題、價格、來源、分類、縮圖）。

- **Webhook**：優先用環境變數 `DISCORD_WEBHOOK_URL`（GitHub Actions 用同名 secret），沒有才讀 DB 的 `meta.discord_webhook`
- **關注關鍵字**：存在 DB 的 `watches` 表。雲端版要對 Turso 操作，在本機帶 Turso 環境變數跑 CLI：

```bash
TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npx tsx src/cli/index.ts watch add Roselia 法被
TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npx tsx src/cli/index.ts watch ls
```

公開站不提供設定介面（任何訪客都能改等於沒有保護）。本機 `npm run serve` 的「關注通知」分頁可以直接管理本機 DB 的關鍵字。

## 部署（GitHub Actions）

`.github/workflows/crawl.yml`：

| 觸發 | 做什麼 |
|---|---|
| 每小時（`23 * * * *`） | 增量掃站 → 匯出 → 部署 |
| 每天 03:07 JST（`7 18 * * *`） | 完整掃站 → 匯出 → 部署 |
| 推到 master | 只匯出＋部署，不掃站 |
| 手動 | `gh workflow run crawl.yml`（加 `-f full=true` 完整重掃） |

- 掃站中途失敗仍會匯出部署已寫進 DB 的部分（`if: !cancelled()`）
- `concurrency: crawl`，同時只跑一個
- **Keepalive**：GitHub 會停用 60 天沒 commit 的 repo 的排程；每次排程跑完呼叫 API 重新 enable 自己
- `wrangler deploy` 只上傳內容有變的檔案

**需要的 Secrets**：

| 名稱 | 用途 |
|---|---|
| `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN` | 爬蟲狀態庫 |
| `CLOUDFLARE_API_TOKEN` | 用「Edit Cloudflare Workers」範本建立 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 後台右側 |
| `DISCORD_WEBHOOK_URL`（選用） | 新品通知；Discord 頻道設定 → 整合 → Webhook |

### 額度估算（參考）

| 項目 | 估算 |
|---|---|
| Cloudflare | 靜態檔流量免費不限量；Worker 只有圖片後備會用到 |
| Turso 寫入 | 增量只寫變動，主要是每日完整掃站，約每月數百萬列 |
| Turso 讀取 | 主要是每次匯出讀全表，約每月一億列以內 |
| GitHub Actions | 公開 repo 免費；完整掃站約 1〜2 小時 |
| 對各站的負載 | 同站請求間隔 2.5〜3.5 秒；增量約數百請求、完整約一兩千請求 |

---

## 本機開發

需要 Node 22+。

```bash
npm ci
npm run serve                 # http://localhost:3777（加 --no-schedule 不排程掃站）
npm run crawl                 # 增量掃站；第一次自動完整建庫
npm run crawl -- --full       # 完整掃站
npm run search -- MyGO 法被    # 即時查各站（結果同時入庫）
npm run search -- 法被 --local # 只查本機 DB
npm run export:static         # 匯出快照，之後開 http://localhost:3777/?snapshot 預覽公開版
npx wrangler dev              # 用 Cloudflare 本機環境跑公開版
```

CLI 其他指令：`watch add|ls|rm`（關注關鍵字）、`wish`、`stats`、`config discord_webhook <url>`、`notify-test`。

不設 `TURSO_DATABASE_URL` 時資料存在 `data/bandori.db`（gitignore）。要把本機資料鏡像上 Turso：`npx tsx scripts/push-to-turso.mts`（會先清空遠端 items/price_history）。

## 已知限制

- 駿河屋（Yahoo! 店）連續請求太多會回 HTTP 489（限流），後段關鍵字偶爾掃不到，下次再補
- 標題完全沒有作品訊號的商品（例：「XX様 リクエスト まとめ」、只寫曲名但曲名太通用）會被相關性過濾掉
- 增量掃站不回寫沒變的列，標題/圖片的修改要等每日完整掃站才更新
- 搜尋時快照要整包下載到瀏覽器（數 MB），資料量再大幾倍時需要改成按需載入
