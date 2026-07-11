# Hyperframes Composition Brief: Bandori Hunter

## Objective
Create a short launch-style brag video for Bandori Hunter（バンドリ中古商品整合）.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `C:/Users/Tudo/Downloads/secondHand`
- Primary files read: `public/index.html`, `public/style.css`, `README.md`, `package.json`, `src/core/keywords.ts`
- Product name: Bandori Hunter
- Tagline / strongest claim: 一個介面同時搜尋六個日本中古網站；收錄 78,000+ 件、每小時自動更新
- Key UI or visual moment to recreate: 頂欄搜尋列（logo + 搜尋框 + 桃紅按鈕「同步最新結果」）、商品卡格線（六色來源徽章 + ¥ 價格）、快速比價列表
- Copy that must appear verbatim:
  - 「邦邦周邊，散落在六個網站。」
  - 「一次搜遍六站」
  - 「該收的，一件都不會漏。」
  - 「Bandori Hunter」＋「bandori-hunter.vercel.app」
  - 六站名：駿河屋・らしんばん・K-BOOKS・ハードオフ・ブックオフ・メルカリ

## Creative Direction
- Tone preset: default
- Creative direction: 認真做的宅工具發表會——同人氣的驕傲、乾淨明快、不搞笑但有溫度
- Interpretation: 節奏輕快、白底輕盈、桃紅 accent 貫穿；UI 重現要像真的產品畫面；文案帶粉絲語感
- Angle: 「收藏獵人的武器」。邦邦周邊散落在六個網站，Bandori Hunter 把六個獵場收進一個畫面。張力來自「散落 → 收攏」。
- Hook: 六個彩色站點徽章逐顆彈出散落 → 大字「邦邦周邊，散落在六個網站。」
- Outro / punchline: 「該收的，一件都不會漏。」→ 🎸 Bandori Hunter + URL
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign（不要改成深色霓虹風——產品是乾淨淺色系）

## Visual Identity
- Background: #f5f6f8（頁底）/ #ffffff（卡片面）
- Text: #21262e 主、#697180 次、#9aa1ad 淡
- Accent: #c2255c（soft #fdeef4；ok 綠 #2b8a3e / #ebfbee）
- Display font: "Segoe UI", "Yu Gothic UI", "Noto Sans JP", "Microsoft JhengHei", sans-serif（粗體標題）
- Body font: 同上 regular
- Visual references from the project: 六站品牌色 — 駿河屋 #1971c2、らしんばん #d6336c、ハードオフ #2b8a3e、ブックオフ #d9480f、K-BOOKS #6741d9、メルカリ #e03131；圓角 8px、卡片陰影 0 1px 2px rgba(20,24,34,.05)；logo 首字母桃紅

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. 散落的獵場（hook）— 3.5s — 六色站點徽章依拍逐顆彈出散落；大字「邦邦周邊，散落在六個網站。」（beat-lock 3.70s）
2. 一個搜尋框（reveal）— 3s — 重現頂欄：logo＋搜尋框；打字「Roselia 法被」＋游標點擊「同步最新結果」（click 貼 6.34s）
3. 結果湧入 — 4.5s — 商品卡每拍一張進格線（含 ¥ 價格與六色來源徽章）；字卡「一次搜遍六站」（beat-lock 10.54s）
4. 比價與通知 — 5s — 快速比價 4 行價格由低到高隔拍滑入、最低價綠色「✓ 最便宜」；右下通知卡「新上架：MyGO!!!!! 高松燈 アクスタ」
5. 數字與 logo（outro）— 4s — 「78,000+ 件收錄」count-up＋「每小時自動更新」「聲優周邊も収録」徽章；punchline；🎸 Bandori Hunter＋URL（beat-lock 16.34s）

## Audio
- Audio role: warm upbeat bed
- Audio arc: 輕快 bed 全程 → 打字/點擊 → 卡片 whoosh 依拍 → 比價 tick＋ding → count-up tick 漸密 → 溫暖 logo hit、1s 淡出
- Music: happy-beats-business-moves-vol-9-by-ende-dot-app.mp3
- Music treatment: 0s 起播、音量襯底（約 0.35–0.45）、19s 起 1s 淡出
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-9-by-ende-dot-app.music-cues.json`（114.84 BPM）。strong cues 建議：3.70s hook 字、6.34s 搜尋點擊、10.54s「一次搜遍六站」、11.60s 比價展開、16.34s count-up。beat grid ~0.52s：六顆徽章與商品卡可貼滿拍；比價文字列貼隔拍（~1.05s）保讀取
- Audio-reactive treatment: none（保持乾淨產品感）
- Audio-coupled moments:
  - Scene 1 — 六顆徽章 pop 各配極輕 UI tick；hook 字配低 thud
  - Scene 2 — 打字鍵盤聲＋按鈕 click
  - Scene 3 — 卡片 whoosh 依拍；字卡 hit
  - Scene 4 — 價格列 tick、最低價 ding、通知卡 notification 音
  - Scene 5 — counter ticks＋logo hit
- SFX selection guidance: 動作對位、音量低於 bed；重複性音效選低高頻風險檔
- SFX analysis guidance: `C:/Users/Tudo/.claude/plugins/cache/brag/brag/0.1.0/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes 依實作動畫自選檔名/時點/密度/音量
- Audio files: 音樂與所選 SFX 複製進 `brag-output/composition/assets/`

## Hyperframes Instructions
Use the current `hyperframes` skill and CLI workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep all text readable in the final render（讀取下限：短標籤 0.8s、句子 ~0.3s/字）。
- Keep the video within 15-25 seconds.
- Include the planned music/SFX layer.
- Beat cues are optional hints; readability and product story first. 1-3 strong cue locks.
- Use local assets for audio and runtime dependencies.
- Run Hyperframes lint and validate before render.
