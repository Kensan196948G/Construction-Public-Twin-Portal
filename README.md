# 工事みえるマップ 3D Beta

**Construction Public Twin Portal — MVP**

公共工事を **「位置・目的・工期・完成像・交通規制・生活影響」** の文脈で住民が理解できるようにする Web アプリケーションです。
工事看板・PDF・自治体サイト・SNS に分散していた情報を、地図・3D 空間・時間軸で 1 か所に統合することを目的としています。

> **重要**: 本リポジトリに収録している工事案件は **MVP 開発用のサンプルデータ** です。
> 実在の工事・公告ではありません。写真のみ Wikimedia Commons の実在素材を使用しており、
> 作者・ライセンス・原典 URL を画面に表示しています。

---

## 1. システム概要

| 項目 | 内容 |
|---|---|
| 名称 | 工事みえるマップ 3D Beta |
| 英語名称 | Construction Public Twin Portal |
| 目的 | 公共工事を「何の工事か / なぜ必要か / どこで / いつまで / 現在の段階 / 生活への影響 / 完成後に何が変わるか / 誰が公開しているか / いつ確認されたか」の 9 点で理解できるようにする |
| 対象フェーズ | PoC〜MVP |
| MVP スコープ | 1 地区（田園調布周辺）、24 案件、道路・広場・下水道・公園・建築・土木 |
| **3D 基盤** | **CesiumJS + 日本3Dビル相当（PLATEAU / Cesium ion）＋ 地理院タイル ＋ PLATEAU-Terrain** |
| **住所検索** | **公的ジオコーダー（国土地理院 住所検索API）** |
| **業務検索** | **自社現場台帳（現場ID・発注番号・工事件名・発注者・元請・JV・工種・工期）** |
| **施工範囲** | **PostGIS 3.6（工区・規制・迂回路・歩道切替の空間検索）** |

> 4 つの構成要素（CesiumJS 3D基盤 / 公的ジオコーダー / 自社現場台帳 / PostGIS 施工範囲）の
> 役割分担・構築手順・検証方法は [`docs/MVP-ENVIRONMENT.md`](docs/MVP-ENVIRONMENT.md) にまとめています。

### 画面構成

```
┌──────────────────────────────────────────────────────────┐
│ TopBar  ブランド / 検索 / 工種・状態フィルタ / 情報更新時刻   │
├───────────────────────────────┬──────────────────────────┤
│ Viewport                      │ 工事詳細カード (396px)     │
│  3D: PublicTwinViewer         │  ・住民向け名称 / 正式名称  │
│  2D: FallbackMap (MapLibre)   │  ・工事目的 / 整備効果      │
│  ＋ 工事一覧 / レイヤー (float) │  ・発注者 / 施工者 / 工期   │
│  ＋ 表示切替 / 凡例 / 時間軸    │  ・影響イベント            │
│                               │  ・出典 / 更新日時 / 免責   │
├───────────────────────────────┴──────────────────────────┤
│ StatusBar  表示件数 / 基準日 / 有効な規制件数 / 出典タグ      │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 技術スタック

| 領域 | 採用技術 |
|---|---|
| フレームワーク | Next.js 16 (App Router) / React 19 |
| 言語 | TypeScript 5（strict） |
| **3D（主題）** | **CesiumJS 1.146（日本3Dビル / PLATEAU 3D Tiles / 地理院タイル / PLATEAU-Terrain）** |
| 3D（内蔵） | Three.js 0.186 / React Three Fiber 9 / @react-three/drei 10 |
| 3D Tiles（内蔵） | 3d-tiles-renderer 0.5（PLATEAU 用・動的 import） |
| 2D 地図 | MapLibre GL JS 6（スタイルはローカル定義・外部タイル非依存） |
| **地理空間DB** | **PostgreSQL 16 + PostGIS 3.6（スキーマ `twin`）** |
| **ジオコーダー** | **国土地理院 住所検索API（APIキー不要）** |
| 状態管理 | Zustand 5 |
| スキーマ検証 | Zod 4 |
| 地理演算 | 自前実装（`lib/geo`）＋ PostGIS（`ST_DWithin` / `ST_Intersects`） |
| API | Next.js Route Handlers（REST） |
| データ | JSON / GeoJSON（`public/data/**`）＋ PostGIS（`twin` スキーマ） |
| テスト | Vitest 3（148 テスト） |

---

## 3. セットアップ

### 3.1 MVP 環境（PostGIS を含む一式）

```bash
sudo bash scripts/mvp-setup.sh
```

依存インストール → PostGIS 初期化 → systemd への環境ファイル受け渡し →
データ生成 → PostGIS 投入 → ビルド → サービス再起動 → 到達確認を順に実行します（すべて冪等）。

個別に実行する場合:

```bash
sudo bash scripts/db-init.sh      # ロール・DB・スキーマ・環境ファイル
sudo bash scripts/service-env.sh  # systemd drop-in（DATABASE_URL をサービスへ）
sudo bash scripts/db-ingest.sh    # 工事データを PostGIS へ投入
sudo bash scripts/deploy.sh       # 停止 → 検証 → ビルド → 起動
```

PostGIS を用意しなくてもアプリは動作します。`DATABASE_URL` が未設定・到達不能の場合は
API が静的データ（`public/data/**`）で同じ検索意味を返し、応答の `source` と画面表示で
どちらを使ったかを明示します。

### 3.2 フロントエンドのみ

```bash
npm install
```

Node.js 22 以上を推奨します（開発時は v22.22.3 で検証）。

`npm run build` / `npm run dev` は先に `scripts/copy-cesium.mjs` を実行し、
CesiumJS の静的アセット（Workers / Assets / Widgets）を `public/cesium` へ複製します。
Next.js 16 は Turbopack が既定で webpack プラグインが使えないため、
バンドラ設定ではなくスクリプトで複製しています。

### 3.3 データの再生成（任意）

`public/data/**` の JSON / GeoJSON はリポジトリにコミット済みです。
`lib/data/**` を変更した場合のみ再生成してください。

```bash
npm run export:data
```

---

## 4. 起動方法

```bash
# 開発サーバ
npm run dev
# → http://localhost:3000

# 本番ビルド + 起動
npm run build
npm start
```

ポートを変える場合:

```bash
PORT=3100 npm run dev
```

---

## 4.1 MVP 環境（systemd 常時配信）

このリポジトリの MVP は **systemd サービスとして登録済み**です。
IP アドレスは実行環境の自動割当 IP、ポートは競合しない空きポートを自動選択します。

| 項目 | 値 |
|---|---|
| **環境URL** | **http://192.168.0.185:43100/** |
| ローカル | http://127.0.0.1:43100/ |
| ユニット名 | `construction-public-twin-portal.service` |
| ユニット定義 | `/etc/systemd/system/construction-public-twin-portal.service` |
| 自動起動 | `enabled`（`WantedBy=multi-user.target`） |
| 待受 | `0.0.0.0:43100`（全インターフェース） |

### セットアップ / 再登録

```bash
# 初回登録（空きポートを自動選択。SERVICE_PORT=43100 で固定も可能）
sudo bash scripts/install-service.sh

# 更新デプロイ（停止 → lint/typecheck/test → build → 起動 → 到達確認）
sudo bash scripts/deploy.sh
```

`deploy.sh` が**サービスを止めてからビルドする**のは意図的です。
稼働中の `next start` が参照している `.next` を書き換えると、
実行中プロセスのクライアント参照マニフェストが失われ
`InvariantError: The client reference manifest for route "/_not-found" does not exist`
が発生し、以後 502/500 を返し続けます。

### 操作

```bash
sudo systemctl status construction-public-twin-portal
sudo systemctl restart construction-public-twin-portal
sudo systemctl stop construction-public-twin-portal
sudo journalctl -u construction-public-twin-portal -f
```

`scripts/install-service.sh` は `43100`〜`43200` を走査して最初の空きポートを使います。
固定したい場合は `SERVICE_PORT=43100 sudo bash scripts/install-service.sh` のように指定します。

---

## 5. 検証コマンド

```bash
npm run lint        # ESLint（0 error / 0 warning）
npm run typecheck   # tsc --noEmit
npm test            # Vitest 148 テスト
npm run build       # 本番ビルド（Cesium アセット複製を含む）

# 実ブラウザ検証（headless Chrome + CDP。dev／start サーバを起動した状態で実行）
npm run verify:browser
```

### 4 要素の疎通確認

```bash
curl -s http://192.168.0.185:43100/api/health | jq .
curl -s "http://192.168.0.185:43100/api/geocode?q=東京都千代田区丸の内一丁目9番" | jq '.count, .candidates[0]'
curl -s "http://192.168.0.185:43100/api/ledger?keyword=田園調布" | jq '.total, .source'
curl -s "http://192.168.0.185:43100/api/geo/nearby?lng=139.668&lat=35.593&radius=500" | jq '.count, .source'
curl -s "http://192.168.0.185:43100/api/geo/contains?lng=139.6679&lat=35.593" | jq '.features[0]'
```

`verify:browser` は実際に Chrome を起動してページを読み込み・操作し、
検索 / フィルタ / 工事選択 / 2D・3D 切替 / **CesiumJS ビューアの既定描画と出典表示** /
**内蔵3Dへのエンジン切替** / 現場・地区スコープ / レイヤー切替 / 時間軸 / 現場ビューア /
モバイル幅での横スクロール有無 / Console エラー・失敗リクエストを機械的に判定します。
結果は `tmp-verify/browser-report.json` とスクリーンショット（`tmp-verify/*.png`）に出力されます。

CesiumJS は npm から import せず `public/cesium/Cesium.js`（UMD）を読み込んでいます。
**この方式を崩すとビルドは成功するのにブラウザで 3D が起動しません**（理由は
[`docs/MVP-ENVIRONMENT.md`](docs/MVP-ENVIRONMENT.md) §8 を参照）。単体で確認するには:

```bash
node scripts/probe-cesium.mjs --url http://127.0.0.1:43100
# canvas / .cesium-viewer の有無、例外、失敗リクエストを出力する
```

---

## 6. 環境変数

すべて任意です。未設定でも全機能が動作します。

| 変数 | 既定 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_PLATEAU_TILESET_URL` | （空） | PLATEAU 3D Tiles の `tileset.json` URL。**未設定時は内蔵の手続き生成 3D 都市モデルを使用**します。設定した場合も、取得失敗・タイムアウト時は自動的に内蔵背景へフォールバックします。 |
| `PORT` | `3000` | `next dev` / `next start` のポート。 |

秘密情報は一切埋め込んでいません。

---

## 7. データ構造

### 7.1 ディレクトリ

```
app/
  page.tsx                      トップ（検索 + 3D/2D + 詳細）
  layout.tsx                    ルートレイアウト
  globals.css                   デザイントークン + 共有プリミティブ
  projects/[slug]/page.tsx      工事個別ページ（SSG）
  api/                          Route Handlers
    geocode/                    公的ジオコーダー（国土地理院 住所検索API）
    ledger/                     自社現場台帳検索
    geo/nearby/                 周辺の施工現場（PostGIS ST_DWithin）
    geo/contains/               地点を含む施工範囲（PostGIS ST_Intersects）
    health/                     構成状態（DB・ジオコーダー・ビューア・データ）
components/
  layout/                       TopBar / Sidebar / StatusBar / Legend /
                                ViewportControls / MapNote / MobileProjectSheet /
                                Toast / HelpModal
  map/                          ProjectSearch（統合検索）/ ProjectFilter / ProjectList /
                                FallbackMap（MapLibre 2D）/ GeoContextPanel（住所から探す）
  viewer/                       CesiumJapanViewer（CesiumJS 3D・主題）/
                                PublicTwinViewer（R3F 内蔵3D）/ PlateauTileset /
                                WorkZoneLayer / ImpactLayer / DetourLayer /
                                CompletionModel / CameraController /
                                LayerControl / TimelineControl
  project/                      ProjectDetailCard / ImpactPanel / ProjectTimeline /
                                OfficialSourceLink / Disclaimer / SiteViewer
lib/
  schemas/                      Zod スキーマ（project / impact / ledger）
  geo/                          WGS84 ⇄ シーンローカル変換 / GeoJSON 型・検証 /
                                住所正規化（address.ts）/ 国土地理院ジオコーダー（gsi.ts）/
                                距離・包含判定（measure.ts）
  db/                           PostGIS 接続（client.ts）/ 問い合わせ（queries.ts）
  data/                         サンプルデータ原表・組立・検索・GeoJSON 生成 /
                                現場台帳の静的フォールバック（ledger.ts）
  store/                        Zustand ストア / レイヤー定義 / 時間軸
  viewer/                       cesiumConfig / tileConfig / cameraPresets /
                                sceneBuilder / mapStyle
db/
  schema.sql                    PostGIS スキーマ（twin）・空間検索関数・公開ビュー
  seed.sql                      db-ingest が生成する投入 SQL（コミット対象外）
public/
  data/projects/                工事 JSON（1 案件 1 ファイル + index.json）
  data/impacts/                 影響イベント JSON
  data/geo/{slug}/              工区・規制・迂回路・歩道切替の GeoJSON
  data/geo/all/                 全案件を統合した GeoJSON
  images/                       サンプル写真（Wikimedia Commons・クレジット保持）
  cesium/                       CesiumJS 静的アセット（copy-cesium が生成。コミット対象外）
scripts/
  mvp-setup.sh                  MVP 環境の一式セットアップ
  db-init.sh                    PostGIS のロール・DB・スキーマ・環境ファイル
  db-ingest.sh / db-ingest.mjs  工事データの PostGIS 投入
  service-env.sh                systemd へ環境ファイルを渡す drop-in
  copy-cesium.mjs               CesiumJS 静的アセットの複製
  deploy.sh / install-service.sh 本番デプロイ・サービス登録
  export-data.ts                静的データ書き出し
  verify-browser.mjs            headless Chrome による実操作検証
docs/
  MVP-ENVIRONMENT.md            MVP 環境の構成・構築手順・検証・ライセンス
  CONTRACTS.md                  実装契約（凍結インターフェース）
  goal-progress.md              開発ラウンド記録
WebUI/                          デザインハンドオフ（視覚契約の原本）
```

### 7.2 Project（工事）

Zod スキーマ `lib/schemas/project.ts` で検証します。主なフィールド:

```jsonc
{
  "id": "tokyo-demo-002",
  "slug": "denenchofu-station-plaza",
  "status": "under_construction",        // planned | under_construction | completed | suspended
  "category": "広場",                     // 工種
  "siteType": "civil-urban",
  "name": "田園調布駅前広場整備工事",       // 正式工事件名
  "publicTitle": "駅前広場を歩行者中心に整える工事",
  "purpose": "…",                        // 工事目的
  "benefits": ["…"],                     // 整備効果
  "owner": { "name": "大田区 建設部 まちづくり課" },
  "contractor": { "name": "田園調布建設株式会社" },
  "schedule": {
    "startDate": "2026-04-01",
    "plannedEndDate": "2027-03-31",
    "phase": "広場舗装・植栽工事",
    "lastUpdatedAt": "2026-10-04T07:00:00+09:00"
  },
  "location": {
    "municipality": "大田区",
    "address": "東京都 大田区 田園調布本町 1-1-1",
    "center": { "longitude": 139.668, "latitude": 35.593 },
    "workZoneGeoJsonUrl": "/data/geo/denenchofu-station-plaza/workzone.geojson"
  },
  "visual": {
    "thumbnailUrl": "/images/sample-cu1.jpg",
    "thumbnailCredit": { "author": "…", "license": "CC BY-SA 4.0", "url": "…" },
    "completionType": "plaza",           // 手続き生成する完成予想モデルの種別
    "siteWidthM": 118, "siteDepthM": 60, "floors": 0
  },
  "impacts": ["imp-002-sidewalk", "imp-002-night-lane", "imp-002-detour"],
  "visibility": {
    "classification": "public",          // public | limited | internal | private
    "publicationState": "published",     // draft | review | approved | published | suspended | expired
    "reviewDueAt": "2027-04-30"
  },
  "source": {
    "provider": "大田区 建設部 まちづくり課",
    "officialUrl": "https://www.city.ota.tokyo.jp/",
    "verifiedAt": "2026-10-04T07:00:00+09:00",
    "dataset": "開発用サンプルデータ",
    "license": "サンプル（写真は Wikimedia Commons、各クレジット参照）"
  },
  "disclaimer": "この案件は…開発用サンプルデータです。…"
}
```

### 7.3 Impact（影響イベント）

交通規制等は Project とは **別エンティティ** として管理します（`lib/schemas/impact.ts`）。

```jsonc
{
  "id": "imp-002-night-lane",
  "projectId": "tokyo-demo-002",
  "type": "lane_closure",     // lane_closure | road_closure | sidewalk_switch |
                              // detour | night_work | noise | vibration |
                              // access_restriction | advance_notice | completion
  "severity": "warning",      // info | notice | warning
  "title": "夜間の片側交互通行",
  "description": "舗装工事のため、夜間に片側交互通行を実施します。…",
  "activeFrom": "2026-10-10",
  "activeTo": "2026-10-31",
  "recurrence": "平日 21:00〜翌5:00",
  "geometryUrl": "/data/geo/denenchofu-station-plaza/regulation.geojson",
  "geometryKind": "regulation",
  "source": { "provider": "…", "officialUrl": "…", "verifiedAt": "…" }
}
```

表示判定は `activeFrom <= viewTime <= activeTo`（`isImpactActiveAt()`）。

### 7.4 デザイントークン

`app/globals.css` の `:root` に定義。出典は `WebUI/koji-mieru-map-3d.html`（デザインハンドオフ）で、
色・角丸・影・タイポグラフィ・余白はその原本に一致させています。
`components/**` は CSS Modules でレイアウト固有のスタイルを持ち、色は必ずトークンを参照します。

### 7.5 スタイルの正（Source of truth）

**UI の見た目は `WebUI/` フォルダの内容を正とします。**

| 原本 | 実装での扱い |
|---|---|
| `WebUI/koji-mieru-map-3d.html` の `:root`（22トークン） | `app/globals.css` の `:root` に**同名・同値で移植**（監査済み: 原本トークンの欠落 0） |
| 同ファイルのコンポーネント CSS（`.topbar` `.fchip` `.pcard` `.detail` `.imp` `.siteviewer` など） | 各コンポーネントの CSS Modules へ移植 |
| 同ファイルの HTML 文言・ラベル・サンプルデータ | `lib/data/source.ts` に原文のまま保持 |
| `WebUI/DESIGN-MANIFEST.json` | レスポンシブ検証ビューポート（360〜1920px）の根拠 |
| `WebUI/DESIGN-HANDOFF.md` | 「視覚契約」として扱い、実装判断に迷った場合は原本の挙動を優先 |

`WebUI/` は**参照専用**です（ビルド対象外。`eslint.config.mjs` / `tsconfig.json` で除外）。
レイアウト専用に追加したトークンは `--topbar-h` / `--statusbar-h` / `--detail-w` の 3 つのみで、
いずれも原本の寸法（60px / 38px / 396px）を定数化したものです。

---

## 8. API

| エンドポイント | 説明 |
|---|---|
| `GET /api/projects` | 工事一覧。`keyword` `category` `status` `municipality` `regulating` `at` `from` `to` `limit` |
| `GET /api/projects/{id}` | 工事詳細（id または slug）。`{ project, geometry, impacts }` |
| `GET /api/impacts` | 影響イベント一覧。`projectId` `type` `activeAt` |
| `GET /api/search` | 検索サジェスト。`q` |
| `GET /api/tilesets` | 利用可能な 3D Tiles 設定 |
| **`GET /api/geocode`** | **公的ジオコーダー（国土地理院 住所検索API）。`q` `limit`。号は解決しないため到達レベルを明示** |
| **`GET /api/ledger`** | **自社現場台帳検索。`keyword` `category` `status` `municipality` `owner` `contractor` `workType` `jv` `from` `to` `limit` `offset`** |
| **`GET /api/geo/nearby`** | **周辺の施工現場（PostGIS `ST_DWithin`）。`lng` `lat` `radius` `limit`** |
| **`GET /api/geo/contains`** | **地点を含む施工範囲（PostGIS `ST_Intersects`）。`lng` `lat` `kinds` `limit`** |
| **`GET /api/health`** | **構成状態（DB・ジオコーダー・ビューア・データ件数）。`probe=1` でジオコーダー到達確認** |

- **公開状態（`publicationState`）が `published` 以外の案件は一切返しません。**
- 不正なクエリは `400 { error }`、未発見は `404 { error }`。
- 新 API は応答に `source`（`postgis` / `static`）と `sourceLabel` を含み、
  PostGIS を使えなかった場合は `notice` に理由を入れます。画面にも同じ内容を表示します。

---

## 9. 主要機能

| ID | 機能 | 実装 |
|---|---|---|
| F-001 | 工事検索 | 工事件名・公開名称・自治体・住所・工種・目的・発注者を対象に、全角半角/大小文字を正規化した AND 検索 |
| F-002 | フィルタ | 工種（8 種）と施工状態（施工中 / 着工前 / 規制中 / 完成） |
| F-003 | 工事一覧 | 検索条件と連動。選択中を強調 |
| F-004 | 工事選択 | 一覧・地図・3D から選択 → 詳細カード表示 / カメラ移動 / 関連規制表示 |
| F-005 | 3D 表示 | **1現場 = 1つの3D**。現場スコープ（選択した1現場のみ）と地区スコープ（全体俯瞰）を切替 |
| — | 現場3D | 選択案件の BIM / CAD / 点群 / 3DGS / 撮影 / 点検 / 指摘ピン / 施工進捗を重ねて表示 |
| — | 現場ギャラリー | **24現場それぞれの3D**を一覧（1現場=1つの3D）+ サンプル写真 + クレジット |
| — | 2D フォールバック | MapLibre GL。外部タイル非依存のローカルスタイルで必ず描画 |
| — | 時間軸 | 「現在 / 指定日 / 完成予定」をスライダーで切替。指定日に有効な規制のみ強調 |
| — | 完成予想 | 8 種の手続き生成モデル。「現在 / 完成予想 / 比較（半透明）」 |
| — | 出典表示 | 情報提供元 / 公式 URL / 確認日時 / 最終更新日時 / 免責事項 |
| — | モバイル | 640px 以下は詳細をボトムシート化。横スクロールなし |

### 4 要素の統合（住所 → 現場 → 施工範囲）

| 機能 | 実装 |
|---|---|
| 統合検索 | 1 つの入力欄で「自社現場台帳」と「公的ジオコーダー」を同時に検索。候補は `[工事]` `[住所]` を区別して表示 |
| 住所検索 | 国土地理院 住所検索API。**号は原則解決しない**ため、到達した粒度（丁目 / 番地）を明示し、「◯◯までの一致です」と表示 |
| 住所から探す | 住所候補を選ぶと `GeoContextPanel` が開き、**周辺の施工現場**（PostGIS `ST_DWithin`、半径 200m〜2km 切替）と**その地点が含まれる施工範囲**（`ST_Intersects`）を表示 |
| 現場台帳検索 | 現場ID・発注番号・工事件名・発注者・元請・JV・工種・工期で検索（`/api/ledger`）。JV 案件のみの絞り込みも可能 |
| 空間検索の由来表示 | 応答の `source` が `postgis` / `static` のどちらかを画面に表示。「使っていないものを使用中と書かない」 |

### 3D レイヤー

```
Base Layer     都市モデル / 地形・地盤
Project Layer  工区(Polygon) / 工事位置(Point) / 完成予想モデル
Impact Layer   車線規制・通行止め / 迂回路 / 歩道切替
Data Layer     BIM / CAD / GIS / 点群 / 3DGS / スマホ / 写真 /
               施工進捗 / 点検 / 撮影軌跡 / AI・指摘ピン
```

レイヤーは個別に ON/OFF でき、3D・2D の双方に反映されます。
**データレイヤーの各項目はトグルで実際に3Dの見た目が変わります**（飾りではありません）。

### データレイヤーの内容

| レイヤー | 3D での表現 | データ |
|---|---|---|
| BIM | 柱・梁・床スラブの構造フレーム | 合成サンプル |
| CAD | 平面図（外形・中心線・通り芯）のオーバーレイ | 合成サンプル |
| GIS | 工区・車線規制・迂回路・歩道切替 | 実データ（GeoJSON） |
| 点群 | レーザースキャン相当の点群 | 合成サンプル |
| 3DGS | ガウシアンスプラッティング相当の半透明スプラット | 合成サンプル |
| スマホ | スマートフォン撮影位置のマーカー | 合成サンプル |
| 写真 | 撮影位置に立てる現場写真パネル（実素材をテクスチャ化） | 写真は Wikimedia Commons 実素材 |
| 施工進捗 | 工程ごとの区間を進捗率で色分け | 合成サンプル |
| 点検 | 点検位置のピン（良 / 要注意 / 要補修） | 合成サンプル |
| 撮影軌跡 | 撮影位置を結ぶ破線 | 合成サンプル |
| AI・指摘ピン | AI 検出・指摘事項の位置ピン | 合成サンプル |

> **重要**: 「合成サンプル」と記したレイヤーは、実データが未接続のため
> プロジェクトIDから**決定的に**生成した合成データです（同じ案件なら常に同じ形状）。
> 実データがあるかのように表示しません。実データを接続する場合は
> `lib/site/sceneData.ts` の戻り値を差し替えれば、描画側は変更不要です。

---

## 10. フォールバック設計

外部依存の失敗をアプリ全体の障害にしないことを設計原則としています。

```
3D 利用可           → Three.js / R3F ビューア（内蔵の手続き生成都市モデル）
PLATEAU 設定あり     → 3D Tiles を動的 import して描画。失敗/タイムアウト(8s) → 内蔵背景へ自動切替
WebGL 利用不可       → 「3Dを表示できません」+ 2D 切替ボタン（例外を投げない）
2D 地図              → 外部タイルに依存しないローカルスタイルで必ず描画
地図も失敗           → 工事一覧 + 詳細カードのみで情報閲覧は継続
```

**工事情報そのものを 3D 機能へ依存させていません。**

---

## 11. 既知の制約

### データ

- 収録している 24 案件は **開発用サンプルデータ**であり、実在の工事ではありません。
  位置・工期・規制内容は説明用に構成したものです。
- サンプル写真は Wikimedia Commons の実在素材で、当該工事の現場写真ではありません。
  ライセンス条件（CC BY / CC BY-SA / CC0）を満たすため、作者・ライセンス・原典 URL を表示しています。
- 自治体ポータルの URL は実在するページですが、**案件個別のページではありません**。
- 公開状態の管理（下書き / 公開待ち / 承認 / 公開 / 公開停止 / 再確認期限切れ）は
  スキーマ・PostGIS・API のフィルタとして実装していますが、**管理画面（CRUD UI）は MVP 対象外**です。
- **発注番号・JV・工種細分類は、サンプル案件に実データが無いため現場IDから決定的に生成した補完値**です
  （PostGIS の `ledger_is_sample = true`、画面にも注記を表示）。実データ接続時は
  `lib/schemas/ledger.ts` の生成関数と `scripts/db-ingest.mjs` の該当箇所を差し替えます。
- 監査ログのテーブル（`twin.audit_log`）はデータ投入時に記録していますが、
  公開・承認などの操作 UI は MVP 対象外です。

### 3D

- 主題ビューアは CesiumJS です。背景は地理院タイル（トークン不要）、地形は PLATEAU-Terrain（トークン不要）、
  3D建物は ion または PLATEAU 3D Tiles です。
- `NEXT_PUBLIC_CESIUM_ION_TOKEN` も `NEXT_PUBLIC_PLATEAU_TILESET_URL` も未設定の場合、
  **3D建物は表示されません**（地理院タイルの画像と施工範囲は表示されます）。画面にも未構成の理由を表示します。
  収録している 24 案件の自治体は大半が架空のため、PLATEAU のデータセットが引けないことが原因です。
- 完成予想モデルは、`visual.modelUrl`（glTF/GLB）がある案件のみ CesiumJS 上で描画します。
  サンプル 24 案件には GLB が無いため、完成予想は内蔵3Dビューアの手続き生成モデルで表示します。
- CesiumJS の初期化に失敗した場合（WebGL 不可・チャンク読込失敗など）は、
  自動的に内蔵の Three.js ビューアへ切り替わり、トーストで通知します。

### ジオコーダー

- 国土地理院 住所検索API は **号を原則として解決しません**（`東京都千代田区丸の内一丁目9番1号` → `…一丁目９番`）。
- 存在しない番地でも **エラーにならず親レベルの代表点を返します**。そのため本実装は到達レベルを入力と比較し、
  浅い場合は「◯◯までの一致です」と明示します（`lib/geo/address.ts` の `validateGeocode`）。
- 語句の部分一致で無関係な地点を返すことがあるため、都道府県＋市区町村の一致を必須にしています。
- **国土地理院に逆ジオコーディングAPIは存在しません**（2022年に uPlace REST API 終了）。本 MVP は逆ジオコーディングを実装していません。
- 住所の代表点は番地レベルの代表点であり、建物（号）の位置ではありません。施工範囲の確定には使用しないでください。

### ライセンス

- Cesium ion の Community プランは個人・非商用向けで、利用規約上「government project」では有償ライセンスが必要とされ、
  第三者へのサービス提供も制限されます。そのため **トークン不要の経路（地理院タイル + PLATEAU-Terrain + PLATEAU 3D Tiles）を既定**とし、
  ion（Japan 3D Buildings / Japan Regional Terrain）は `NEXT_PUBLIC_CESIUM_ION_TOKEN` を設定した場合のみ使用します。
- 出典表示は `docs/MVP-ENVIRONMENT.md` §7 の表に従い、**実際に読み込めた供給元のみ**を画面に表示します。

### 運用

- データストアは静的ファイル（`public/data/**`）と PostGIS（スキーマ `twin`）の二系統です。
  PostGIS が未構成・到達不能でもアプリは動作し、静的データで同じ検索意味を返します。
- 認証・権限（Viewer / Editor / Reviewer / Publisher / Administrator）は MVP 対象外です。

---

## 12. 開発の記録

ラウンドごとの Observe → Plan → Implement → Test → Decide は
[`docs/goal-progress.md`](docs/goal-progress.md) に記録しています。
実装契約（凍結インターフェース・担当スコープ）は [`docs/CONTRACTS.md`](docs/CONTRACTS.md) を参照してください。

---

## 13. 将来拡張

```
Phase 1  公開工事ポータル（本 MVP）
Phase 2  公開管理・承認・監査・CMS/API 連携
Phase 3  関係者限定 CDE
Phase 4  点群・施工進捗・工程を含む現場デジタルツイン
Phase 5  Construction World Model
Phase 6  AI エージェント
```

座標変換は `lib/geo/transform.ts` に、3D タイル設定は `lib/viewer/tileConfig.ts` に分離してあり、
将来 CesiumJS 等へ差し替えられる構造を維持しています。
