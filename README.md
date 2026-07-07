# 🎸 Bandori Hunter

BanG Dream!（バンドリ）中古商品情報聚合工具 — 一個介面同時搜尋、追蹤五個日本中古/二手網站：

| 來源 | 方式 | 備註 |
|---|---|---|
| 駿河屋 | 瀏覽器（Playwright） | 有 Cloudflare 驗證，每個 session 需人工點一下（見下方） |
| らしんばん通販 | JSON API | 品項資料最完整（狀態、店鋪、系列） |
| K-BOOKS 通販 | JSON API | 只吃「BanG Dream」開頭的正式品名，程式已自動處理 |
| ハードオフ/ホビーオフ NetMall | HTML | 實體店上架，撿漏用 |
| ブックオフ | HTML | CD/BD/書為主 |
| メルカリ | JSON API（DPoP 簽名） | 二手個人出品，量大、含售完品 |

> まんだらけ通販曾嘗試對接，但該站封鎖非日本 IP（連 Googlebot UA、美國 IP 都被重導回首頁），已移除。若之後有日本代理可再加回（解析器結構已驗證：`.thumlarge .block[data-itemidx]`）。

CD、專輯、BD、法被、壓克力立牌、娃娃、缶バッジ……全類型，自動分類、自動打上樂團/角色標籤，並過濾無關商品（例如 LV 的「バンドリエール」包包）。

## 快速開始

```powershell
npm install                 # 首次
npx playwright install firefox   # 首次（駿河屋用）

npm run serve               # 啟動網頁 → http://localhost:3777
```

第一次使用：開網頁 → 「系統」分頁 → **立刻掃站**（首次會完整建庫，約 5〜15 分鐘）。

### 駿河屋驗證（活 session 模式）

駿河屋有 Cloudflare 人機驗證，且 cookie 不被自動化瀏覽器的新 session 承認，程式無法（也不應該）自動繞過。因此採「活 session」：

- 搜尋/掃站需要駿河屋時，會**自動開一個 Firefox 視窗**；若出現挑戰頁，桌面會跳通知，**點一下「私はロボットではありません」**即可（等你 2 分鐘）
- 點過之後**同一個視窗會保持開啟**（可縮到最小），該 session 內之後的爬取全程靜默
- 視窗被關掉 = session 結束，下次需要時會重開再請你點一次

## 網頁功能

- **瀏覽**：搜尋本地庫（即時響應），左側可篩來源 / 分類 / 樂團·角色 / 價格 / 有貨，卡片點開看詳情
- **⚡ 五站即時搜尋**：當場打五站拿最新結果，同步寫入本地庫
- **新上架**：最近 72 小時各站新收錄
- **願望清單**：卡片按 ♥ 收藏
- **關注通知**：加關鍵字（如「Roselia 法被」），排程掃站發現新品 → Windows 通知；設 Discord webhook 可推手機
- **跨站比價**：商品詳情內自動列出其他站的相似商品與價格；有價格變動會畫歷史曲線

## CLI

```powershell
npm run cli -- search "Roselia 法被"        # 五站即時搜尋
npm run cli -- search "アクスタ" --local     # 只查本地庫
npm run cli -- crawl                        # 掃站（首次=完整建庫）
npm run cli -- watch add "千早愛音"          # 加關注
npm run cli -- watch ls
npm run cli -- config discord_webhook <url> # Discord 通知
npm run cli -- stats
```

> 注意：Windows 的 PowerShell/cmd 傳日文參數可能變成 `????`（編碼問題）。
> 建議 CLI 搜日文時用 Git Bash，或直接用網頁介面（無此問題）。

## 排程

`npm run serve` 開著時預設每 3 小時自動掃站（可在「系統」分頁調整）。
想不開網頁也定時掃，可用 Windows 工作排程器跑：

```
排程動作: powershell -Command "cd C:\Users\Tudo\Downloads\secondHand; npm run crawl"
```

## 雲端部署（Vercel + Turso + GitHub Actions）

架構：**GitHub Actions** 每小時跑爬蟲 → 寫入 **Turso**（雲端 SQLite）→ **Vercel** 部署網頁讀取。
本機模式不受影響（未設 `TURSO_DATABASE_URL` 時自動用本機 `data/bandori.db`）。
雲端限制：駿河屋僅本機支援（需人工驗證 + 瀏覽器）；Mercari 從資料中心 IP 有被擋的可能。

一次性設定步驟：

1. **Turso**：<https://turso.tech> 註冊 → 建立 Database → 記下 `libsql://…` URL 和 auth token
2. **推上既有資料**（可選但建議，不然雲端要重新建庫）：
   ```powershell
   $env:TURSO_DATABASE_URL="libsql://xxx.turso.io"
   $env:TURSO_AUTH_TOKEN="eyJ..."
   npx tsx scripts/push-to-turso.mts
   ```
3. **GitHub**：建 repo 並 push 本專案 → repo Settings → Secrets and variables → Actions →
   加入 `TURSO_DATABASE_URL` 和 `TURSO_AUTH_TOKEN` 兩個 secret。
   排程（`.github/workflows/crawl.yml`）每小時自動跑；Actions 分頁可手動觸發（含完整重掃選項）。
   ※ private repo 免費額度 2,000 分鐘/月可能不夠每小時掃，public repo 不限。
4. **Vercel**：Import 該 GitHub repo → Environment Variables 加同樣兩個變數 → Deploy。
   `vercel.json` 已設定好（public/ 靜態 + express API + 圖片代理）。

## 設計備忘

- 禮貌爬蟲：每站獨立節流 2.5〜4 秒/請求、失敗退避重試；增量掃站只翻前幾頁（各站結果大致按新著排序），連兩頁沒新品即停
- 相關性過濾：`src/core/keywords.ts` 詞庫（作品/樂團/角色 + 排除詞），要追加自訂詞改這裡
- 分類規則：`src/core/categorize.ts`
- 資料庫：SQLite（`data/bandori.db`），含價格歷史；圖片快取在 `data/imgcache`
- 每站的「首次完整建庫」獨立記錄——駿河屋晚點通過驗證也會自動補跑完整模式
