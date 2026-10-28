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
