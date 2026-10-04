# 開発ラウンド記録 / Goal Progress

対象: 「工事みえるマップ 3D Beta」(Construction Public Twin Portal) MVP
実行モード: AUTONOMOUS / LOOP ENABLED / MAX_ROUNDS = 8
基準日: 2026年10月4日

---

## Round 1 — 調査と契約凍結

### Observe

- リポジトリは **Git 未管理**。`WebUI/` にデザインハンドオフ（`koji-mieru-map-3d.html` 1937行、
  `DESIGN-HANDOFF.md`、`DESIGN-MANIFEST.json`、写真素材9点）と、要件定義書・システム仕様書が存在。
- `koji-mieru-map-3d.html` は Cesium + Three.js の自己完結プロトタイプで、
  **24案件分の実データ**（案件名・目的・整備効果・発注者・工期・住所・写真クレジット）と
  手続き生成の完成予想モデル8種を埋め込んでいた。
- デザイン契約は「Preserve real copy, labels, and data shown in the export」を要求。
- npm レジストリへ到達可能。Next 16.3.8 / React 19.3 / three 0.186 / R3F 9.8 /
  drei 10.7 / maplibre-gl 6.12 / zustand 5 / zod 4 が導入可能と確認。

### Plan

1. Git を初期化しベースラインを保全する
2. 共有契約層（Zod スキーマ・座標変換・データセット・ストア・デザイントークン）を凍結する
3. `docs/CONTRACTS.md` にインターフェースを固定し、Agent Team を編成する

### Implement

- `git init` + ベースラインコミット（既存変更を破壊しない）
- `app/globals.css`: プロトタイプの CSS からデザイントークンを忠実に移植
- `lib/schemas/{project,impact}.ts`: Zod スキーマ
- `lib/geo/{transform,geojson}.ts`: WGS84 ⇄ シーン座標、GeoJSON 型・検証
- `lib/data/*`: プロトタイプの24案件・36影響イベントを移植・組立・検索
- `lib/store/useAppStore.ts`: Zustand（仕様書 #15 の全状態）
- `scripts/export-data.ts`: `public/data/**` へ JSON / GeoJSON 101ファイルを書き出し
- `docs/CONTRACTS.md`: 凍結インターフェースと書き込みスコープ

### Test

- `npx tsc --noEmit` … PASS（Next 16 で廃止された `eslint` config キーを除去後）
- `npm run export:data` … 24案件 / 36影響イベント / 101ファイル / 166フィーチャ

### Result

- 契約層が型検査を通過。Agent Team（viewer3d / map2d / projectui / apidata）を編成。

### Decision

CONTINUE

---

## Round 2 — 並列実装と統合

### Observe

- 4名の担当がディレクトリ単位で完全分離して並列実装。
- 統合時に「未実装コンポーネント参照」の型エラーのみ（想定内）。

### Plan

1. Lead が統合層（layout / TopBar / Sidebar / StatusBar / page.tsx / 個別ルート）を実装
2. 各自の完了後に typecheck / lint / test / build を通す

### Implement

- Lead: `components/layout/**`, `app/page.tsx`, `app/projects/[slug]/page.tsx`
- 並行: `components/viewer/**`（3D）, `components/map/**`（2D・検索・一覧）,
  `components/project/**`（詳細UI）, `app/api/**` + `tests/**`（API・テスト）

### Test

- `npm test` … **98 tests / 7 files すべて PASS**
- `npx tsc --noEmit` … PASS
- `npx eslint .` … PASS（警告 0 まで解消）
- `npm run build` … PASS（Turbopack、27ルート生成）

### Result

- apidata が実HTTPスモーク（5ルートの 200/400/404）を実施。
- **map2d が `app/globals.css` のコメント内 `**/` がコメントを早期終端させ、
  `:root` トークン定義ごとパースから落ちる致命バグを検出。** Lead が修正し、
  全 CSS を再走査して同種の危険がゼロであることを確認。

### Decision

CONTINUE

---

## Round 3 — データ整合の修正とブラウザ検証

### Observe

- **map2d の報告**: `public/data/geo/all/workzone.geojson` の全24工区が基準点に重なって生成され、
  工事位置と最大 853m ずれる。
- 原因: `ProjectGeometry` は「案件中心原点」のローカル座標だが、
  `lib/data/geometry.ts` は「基準点原点」のシーン座標として変換していた（座標系の二重解釈）。

### Plan

1. 案件中心オフセットを適用する単一の窓口を設ける
2. データを再生成して実測で検証する
3. ブラウザ検証ハーネスを用意する

### Implement

- `lib/data/projects.ts` に `projectSceneOffset()` / `sceneGeometryOf()` を追加
- `ProjectGeometry` の各フィールドに「案件中心原点である」旨の doc を明記（再発防止）
- `lib/data/geometry.ts` を `sceneGeometryOf()` 経由に変更
- `scripts/verify-browser.mjs`: 依存ゼロの headless Chrome + CDP 検証ハーネスを新規作成

### Test

- 再生成後の実測: **工区重心と工事位置の最大ズレ 19.0m**（修正前 853m）。
  19m は工区形状が中心から偏っていることによる正常値。
- `npm test` … 98 PASS（`isoDateSchema` を暦日ラウンドトリップ検証へ厳格化し、
  `2026-02-30` を拒否するよう回帰テストを追加）

### Result

- データ整合を回復。ブラウザ検証の準備が完了。

### Decision

CONTINUE

---

## Round 4 — 起動不能障害の収束（STRATEGY_RESET 適用）

### Observe

- **アプリ全体が HTTP 500**。`components/map/maplibreWorker.ts` の
  `maplibre-gl/dist/...mjs?url` が Turbopack で解決できず、`app/page.tsx` 経由で全体が落ちた。
- map2d が `?url` / `new URL(..., import.meta.url)` を **3回** 試行しいずれも失敗。
  **停滞検知ルール（同一問題3回で戦略転換）に該当**。
- 根本原因を特定:
  - maplibre は `import.meta.url` 基準で worker URL を組み立てる
    （`if(!/^https?:/.test(e)) return ""` → `new URL("./maplibre-gl-worker.mjs", e)`）
  - Turbopack は依存アセットを**ハッシュ付きファイル名**で逐語コピーするため、
    worker 内の相対 import `./maplibre-gl-shared.mjs` が 404 になる
  - さらに maplibre-gl の exports マップ `"./dist/*"` が `?url` と両立しない

### Plan

1. Lead が当該ファイルを引き取り、バンドラ固有記法を全廃する
2. worker と shared を**元のファイル名のまま** `public/vendor/maplibre/` に配置する
3. systemd でサービス化し、本番ビルドに対して検証する

### Implement

- `scripts/vendor-maplibre.mjs` + `npm run vendor:maplibre`
- `components/map/maplibreWorker.ts` を「静的パスを返すだけ」に書き換え
  （fetch も blob パッチも `?url` も使わない）
- `components/map/maplibre-worker.d.ts` を削除
- `scripts/install-service.sh`: 空きポート自動選択 + systemd ユニット生成
- `scripts/probe-2d.mjs`: スクリーンショットのピクセルを測定する診断プローブ

### Test

- アプリが **HTTP 200** に復帰。`/vendor/maplibre/*.mjs` が 200 で配信。
- systemd: `active` / `enabled` / `WantedBy=multi-user.target`
- ブラウザ検証（本番 `http://127.0.0.1:43100`）… **24 PASS / 0 FAIL**
  - Console エラー 0 / 未捕捉例外 0 / 失敗リクエスト 0
  - 検索 24→1件、フィルタ 着工前→1件、一覧選択で詳細切替、時間軸 10/04→12/03、
    2D↔3D 切替、レイヤー8種、現場ビューア、モバイル幅 横スクロールなし

### Result

- 3D は目視でも良好（手続き生成都市・工区・完成予想・カメラプリセット・バッジ）。
- **2D の見た目に不具合を検出**: ビューポートがマゼンタで、GeoJSON が見えない。
  ピクセル測定の結果、5点中4点が完全な `#ff00ff`。原因は
  `FallbackMap.module.css` に残ったデバッグ背景と、
  `maplibre-gl.css` の `.maplibregl-map { position: relative }` が
  `.canvas { position: absolute }` を同特異度で上書きしてコンテナ高さが 0 になること。

### Decision

CONTINUE（2D の描画修正が必要）

---

## Round 5 — 2D 描画の修正と最終判定

### Observe

- 実測: MapLibre コンテナの `getBoundingClientRect().height === 0`、
  内部 canvas は MapLibre のフォールバックで 300px。
  → コンテナに高さを与えれば解決する。

### Plan

1. デバッグ背景を全廃する
2. 親子セレクタで特異度を上げ、`width`/`height` を明示する
3. 再ビルド → 再検証 → 受入条件を最終判定する

### Implement

（map2d が担当。Lead が根本原因と修正方針を提示）

- `FallbackMap.module.css`:
  - デバッグ背景 `#ff00ff` を完全撤去（リポジトリ全体を grep して残存ゼロを確認）
  - `.wrap > .canvas` とし特異度 (0,2,0) に上げ、`width`/`height: 100%` を明示
    （`maplibre-gl.css` の `.maplibregl-map { position: relative }` に同特異度で負けないため）
- `scripts/verify-browser.mjs` に回帰チェックを追加:
  2D コンテナの実サイズ（>300x200）と、デバッグ色 `#ff00ff` のピクセル露出
- `scripts/deploy.sh` を追加（停止 → 検証 → ビルド → 起動）。
  稼働中の `.next` を差し替えると `InvariantError: client reference manifest ...` で
  502/500 が継続する事象を実際に観測したため、順序を強制する

### Test

- `probe-2d`（ピクセル測定）:
  - 修正前: container `1044 x 0` / canvas `1044 x 300` / 5点中4点が `#ff00ff`
  - 修正後: container `1044 x 659` / canvas `1044 x 659` / マゼンタ 0 点
    （採取色は `#ecf8ed` 地形、`#7dabdf` 工区、`#fefffe`）
- 目視: 工区ポリゴン・規制の赤実線・迂回路の水色破線・工事位置の点・案件名ラベルを確認
- `npm run lint` … PASS（0 error / 0 warning）
- `npx tsc --noEmit` … PASS
- `npm test` … PASS（98 tests / 7 files）
- `npm run build` … PASS
- `verify:browser`（本番デプロイ）… **26 PASS / 0 FAIL**

### Result

- 2D フォールバックが実用可能な品質に到達。デバッグ色とコンテナ高さの両方を
  自動検証に組み込んだため、同種の退行は再発時に検出される。
- systemd サービスを再ビルド後の成果物で更新し、`active` / `enabled` を確認。

### Decision

COMPLETE

---

## 最終判定（MVP Acceptance Criteria）

`scripts/verify-browser.mjs` を本番デプロイ（http://192.168.0.185:43100/）に対して実行した結果:

| Check | Result |
|---|---|
| install | PASS |
| lint | PASS（0 error / 0 warning） |
| typecheck | PASS |
| test | PASS（98 tests / 7 files） |
| build | PASS |
| web start | PASS（systemd `active` / `enabled`） |
| top page | PASS |
| brand / header | PASS |
| project list | PASS（24行） |
| search | PASS（24 → 1件） |
| filter | PASS（着工前 → 1件） |
| project select | PASS |
| project detail | PASS |
| source / updated at | PASS |
| photo credit (CC) | PASS |
| GeoJSON | PASS（実ファイルを fetch して描画） |
| 3D viewer | PASS |
| 3D city background | PASS（内蔵の手続き生成都市） |
| 2D fallback | PASS（コンテナ実サイズ・マゼンタ露出なし） |
| impact | PASS |
| timeline | PASS（10/04 → 12/03） |
| layer control | PASS（8レイヤー） |
| site viewer | PASS |
| project page | PASS |
| responsive (390px) | PASS（横スクロールなし） |
| console errors | 0 |
| uncaught exceptions | 0 |
| failed requests | 0 |

---

## Round 6 — 現場ごとの3D / データレイヤー / 24現場の3Dギャラリー（第2次要望）

### Observe

ユーザー指摘:
> 「３Dが一つに集約されてしまっている。現場ごとの３Dを作って欲しい」
> 「一つの現場に対して一つの３D画像としてください。24の３D画像表示としてください。そしてサンプル写真画像表示もお願いします」
> 「現場ギャラリー24を廃してそれぞれの３D表示として欲しい」
> 「以下レイヤー機能を付けてください: BIM / CAD / GIS / 点群 / 3DGS / スマホ / 写真 / 施工進捗 / 点検 / 撮影軌跡 / AI・指摘ピン」

- 原因を特定: `ProjectOverlay` が未選択時に**全24件**の工区・完成予想を描画していた。
- `SiteViewer` は 24件の**写真**ギャラリーであり、3D は 1 つの集約シーンだけだった。

### Plan

1. 表示スコープ（現場 / 地区）とデータレイヤー11種を契約として凍結する
2. 現場ごとの3Dシーンとデータレイヤーを実装する
3. 24現場の3Dギャラリーを実装する
4. 現場スコープを既定にし、検証を拡張する

### Implement

- **契約（Lead）**: `viewScope` / `DATA_LAYER_IDS`(11) / `DATA_LAYERS` / `dataLayers`、
  `lib/site/sceneData.ts`（案件IDから**決定的に**生成する現場別データ）
- **site3d**: `SiteScene`（`<Canvas>` を含まないシーン内容）、`SiteDataLayers`、`SiteGisLayer`、
  `viewScope` 対応、`LayerControl` 刷新、`CameraController` を冪等実装へ
- **gallery3d**: `Site3DGallery` / `CaptureRig` / `SiteThumbnail`。
  **画面外の Canvas 1つ**で24現場を順に描画し `toDataURL()` で画像化（WebGL コンテキストは常に1つ）
- **Lead**: `SiteViewer` を3Dギャラリー+現場詳細へ刷新、凡例のデータレイヤー対応、
  ViewportControls の重複スコープ切替を削除（ビューア側に一元化）、`allowedDevOrigins`

### Test

拡張した `verify-browser.mjs`（36項目）を本番デプロイに対して実行 → **36 PASS / 0 FAIL**

主な実測値:
- 現場スコープが既定（注記「現場3D表示」）、地区へ切替で**差分 766/768 画素**
- データレイヤー11種がパネルに並ぶ（**11/11**）
- BIM の ON/OFF で **差分 438/768 画素**
- 現場ギャラリー: **24/24 タイルが3Dキャプチャ**（写真フォールバック 0件）、写真も併記
- 現場詳細タブ: 3D + サンプル写真 + クレジットすべて表示
- Console エラー 0 / 未捕捉例外 0 / 失敗リクエスト 0
- モバイル 390px 横スクロールなし

### Result

- **1現場 = 1つの3D** を実現。24現場それぞれが固有の3Dを持ち、ギャラリーで一覧できる。
- データレイヤーはトグルで実際に描画が変わる（飾りではない）。
- サンプル写真を3D空間の写真パネルとして実テクスチャで利用し、ギャラリーにも併記。

#### 収束させた問題

| 事象 | 原因 | 対応 |
|---|---|---|
| 本番 PASS / dev FAIL（BIM の差分0） | 検証が clip 内**6点**のみ比較していたため、細い柱・梁で当たり外れが出た | clip 全体を 32×24 に縮小して全画素比較（site3d が再現・反証、Lead が修正） |
| 現場/地区の切替 UI が2箇所に重複 | Lead と site3d が別々に実装 | ビューア側に一元化（スコープ変更時にカメラプリセットも再適用するため） |
| 検証が Runtime.evaluate でタイムアウト | 画面全体のスクショ（数百KB）をページ内デコードしていた | クリップ領域のみ取得する方式へ変更 |
| dev で hydration が止まる | Next 16 の cross-origin dev リソース制限 | `allowedDevOrigins` を追加、ハーネス既定を `localhost` へ |

### Decision

COMPLETE


