# 🎸 Bandori Hunter

BanG Dream!（バンドリ）中古商品情報聚合工具 — 一個介面同時搜尋、追蹤六個日本中古/二手網站，也收邦邦聲優（愛美、相羽あいな、MyGO/Ave Mujica 聲優團等）的個人周邊：

| 來源 | 方式 | 備註 |
|---|---|---|
| 駿河屋 | HTML（Yahoo!店 __NEXT_DATA__） | 本站有 Cloudflare 人機驗證，改抓官方 Yahoo!ショッピング店，附 JAN 可比價 |
| らしんばん通販 | JSON API | 品項資料最完整（狀態、店鋪、系列） |
| K-BOOKS 通販 | JSON API | 只吃「BanG Dream」開頭的正式品名，程式已自動處理 |
| ハードオフ/ホビーオフ NetMall | HTML | 實體店上架，撿漏用 |
| ブックオフ | HTML | CD/BD/書為主 |
| メルカリ | JSON API（DPoP 簽名） | 二手個人出品，量大、含售完品 |

## 功能

- **全部商品／新上架／降價中**：六站合併瀏覽，可依來源、分類、樂團・角色、聲優、價格篩選；搜尋支援「-詞」排除
- **行情**：搜尋時顯示在售最低/中位數與近期售完（含メルカリ成交）四分位、價格分布圖
- **比價**：一次看六站各自最低價
- **メルカリ優惠券試算**：輸入折扣 %／折抵金額，卡片顯示券後價、價格排序以券後價計
- **分享連結**：搜尋條件與商品都會寫進網址
- 願望清單（公開站存在瀏覽器）、深色模式、價格紀錄圖

## 部署架構

```
GitHub Actions（每小時）
  crawl → Turso（爬蟲狀態庫）
  export-static → public/snapshot/*.json（售完超過 90 天不輸出）
  vercel deploy --prod → 公開站讀靜態快照（唯讀）
```

需要的 GitHub Secrets：`TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`、`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`
（後兩個在本機 `npx vercel link` 後的 `.vercel/project.json` 裡）。Vercel 的 git 自動部署已在 `vercel.json` 關閉，一律由 Actions 部署；
推到 master 也會觸發一次「只匯出＋部署、不掃站」。

GitHub 會停用 60 天沒有 commit 的 repo 的排程，workflow 每次跑完會呼叫 API 重新 enable 自己來避免。

本機 `npm run serve` 走即時 API，可用關注通知（Windows toast / Discord）、即時同步、手動掃站；網址加 `?snapshot` 可預覽公開版。
