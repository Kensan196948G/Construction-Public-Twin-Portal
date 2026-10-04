# MVP 環境構築ガイド / MVP Environment

**対象:** 工事みえるマップ 3D Beta（Construction Public Twin Portal）MVP
**基準日:** 2026-10-04
**対象ホスト:** `kensan1969` (192.168.0.185) / `/home/kensan/Projects/Mirai-Admin-Platform/Construction-Public-Twin-Portal`

このドキュメントは、次の 4 つを組み合わせた MVP 環境の**構成・構築手順・検証方法**を定義します。

| # | 構成要素 | 役割 | 実装 |
|---|---|---|---|
| 1 | **CesiumJS + 日本3Dビル** | 3D 表示基盤。地形・3D建物・カメラ移動 | `components/viewer/CesiumJapanViewer.tsx` / `lib/viewer/cesiumConfig.ts` |
| 2 | **公的ジオコーダー** | 住所文字列 → 緯度経度（ナビゲーション） | `lib/geo/gsi.ts` / `GET /api/geocode` |
| 3 | **自社現場台帳検索** | 現場ID・工事件名・発注番号・発注者・元請・JV・工種・工期 | `twin.construction_projects` / `GET /api/ledger` |
| 4 | **PostGIS 施工範囲** | 工区・線形・規制・迂回路（工事管理上の正解） | `twin.construction_features` / `GET /api/geo/*` |

> **役割分担の原則**
> 住所検索は「その住所付近へ移動する」ための機能であり、
> 施工範囲（敷地境界・工区・搬入口）を保証するものではありません。
> **住所はジオコーダー、施工範囲は PostGIS** と明確に分離しています。

---

## 1. 全体構成

```text
ブラウザ
 ├─ 統合検索（住所 / 工事 / 現場ID / 発注番号）
 │    └─ GET /api/geocode   → 国土地理院 住所検索API（住所→緯度経度）
 │    └─ GET /api/search    → 自社現場台帳（工事件名・住所・工種）
 │
 ├─ CesiumJS ビューア（3D）
 │    ├─ 背景: 地理院タイル（標準地図 / 空中写真）
 │    ├─ 地形: PLATEAU-Terrain（トークン不要）
 │    ├─ 3D建物: Cesium ion Japan 3D Buildings（トークン設定時）
 │    │           または PLATEAU 3D Tiles
 │    └─ 重ね合わせ: 工区 / 規制 / 迂回路 / 歩道切替 / 完成予想
 │
 ├─ MapLibre 2D フォールバック
 └─ 住所から探す（GeoContextPanel）
      └─ GET /api/geo/nearby   → 周辺の施工現場（距離順）
      └─ GET /api/geo/contains → この地点が入る施工範囲

サーバー（Next.js Route Handlers）
 └─ PostgreSQL 16 + PostGIS 3.6
      schema: twin
        organizations / construction_projects / construction_features
        impact_events / data_provenance / source_registry / audit_log
      関数: nearby_projects() / features_containing() / impacts_active_at()
      ビュー: public_projects / public_features（公開承認済みのみ・250mメッシュ丸め）
```

**設計原則:** 外部サービス（地理院タイル・PLATEAU・ion・ジオコーダー）が停止しても、
工事情報そのものは閲覧できること。PostGIS が停止しても、静的データで同じ検索意味を返すこと。
API は応答に `source: "postgis" | "static"` を含み、**どちらで応答したかを画面に表示**します。

---

## 2. セットアップ

### 2.1 一式（推奨）

```bash
sudo bash scripts/mvp-setup.sh
```

内部で次の順に実行します（すべて冪等）。

| 手順 | スクリプト | 内容 |
|---|---|---|
| 1 | `npm install` | 依存（cesium / pg）を含む |
| 2 | `scripts/db-init.sh` | PostGIS ロール・DB・スキーマ・環境ファイル作成 |
| 3 | `scripts/service-env.sh` | systemd drop-in で環境ファイルをサービスへ渡す |
| 4 | `npm run export:data` | `public/data/**`（JSON / GeoJSON）生成 |
| 5 | `scripts/db-ingest.sh` | 工事データを PostGIS へ投入 |
| 6 | `scripts/deploy.sh` | 停止 → lint/typecheck/test → build → 起動 → 到達確認 |

### 2.2 個別実行

```bash
sudo bash scripts/db-init.sh      # DB・ロール・スキーマ
sudo bash scripts/service-env.sh  # systemd へ環境ファイルを渡す
sudo bash scripts/db-ingest.sh    # 工事データ投入（db/seed.sql を生成して適用）
sudo bash scripts/deploy.sh       # ビルドとサービス再起動
```

`scripts/db-init.sh` はロールパスワードを自動生成し、`/etc/construction-public-twin-portal/env`
（root:kensan 0640）へ保存します。再実行時は既存値を再利用するため、接続情報が壊れません。
**このファイルは秘密情報を含むため、リポジトリへコミットしないでください。**

---

## 3. 環境変数

サービス用の値は `/etc/construction-public-twin-portal/env` に置きます（systemd `EnvironmentFile`）。

| 変数 | 必須 | 既定 | 説明 |
|---|---|---|---|
| `DATABASE_URL` | 任意 | （空） | PostGIS 接続文字列。未設定でも動作する（静的データへフォールバック）。`scripts/db-init.sh` が生成。 |
| `TWIN_DB_SCHEMA` | 任意 | `twin` | スキーマ名（記録用）。 |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | 任意 | （空） | Cesium ion のアクセストークン。**設定時のみ** Japan 3D Buildings（asset 2602291）と Japan Regional Terrain（2767062）を使用。**ビルド時に埋め込まれるため、変更後は再ビルドが必要。** |
| `NEXT_PUBLIC_PLATEAU_TILESET_URL` | 任意 | （空） | PLATEAU 3D Tiles の `tileset.json`。ion トークン無しで3D建物を表示したい場合に指定。 |
| `PORT` | 任意 | `43100` | 待受ポート（systemd ユニットで指定済み）。 |

### ion トークンを使わない理由（重要）

Cesium ion の Community プランは**個人・非商用**向けで、利用規約上
「government project」では有償ライセンスが必要とされ、第三者へのサービス提供も制限されます。
また ion のロゴ表示義務があります。
そのため本 MVP は **トークン不要の経路を既定**とし、ion は任意の追加選択肢として実装しています。

| 層 | トークン無し（既定） | ion トークン設定時 |
|---|---|---|
| 画像 | 地理院タイル（標準地図 / 空中写真） | 同左 |
| 地形 | PLATEAU-Terrain `https://tile.plateauview.mlit.go.jp/terrain` | Japan Regional Terrain（asset 2767062） |
| 3D建物 | `NEXT_PUBLIC_PLATEAU_TILESET_URL` があれば PLATEAU 3D Tiles | Japan 3D Buildings（asset 2602291） |

---

## 4. データモデル（PostGIS）

スキーマ定義: `db/schema.sql` / 投入: `scripts/db-ingest.mjs`

| テーブル | 内容 | 対応要件 |
|---|---|---|
| `twin.organizations` | 発注者・元請・JV | REQ-D-002 |
| `twin.construction_projects` | 現場台帳（現場ID・発注番号・工事件名・工種・工期・住所・代表点・工区） | REQ-D-001〜003, REQ-F-010 |
| `twin.construction_features` | 施工範囲（工区 Polygon / 規制・迂回路 LineString / 搬入口 Point） | REQ-D-004, REQ-F-002/005 |
| `twin.impact_events` | 影響イベント（いつ・どこで・何が） | REQ-D-005, REQ-F-006 |
| `twin.data_provenance` | 外部データの来歴・ライセンス | REQ-D-007 |
| `twin.source_registry` | 出典（提供元・公式URL・attribution） | REQ-F-009 |
| `twin.audit_log` | 監査ログ | REQ-F-012, REQ-S-005 |

### 空間検索関数

```sql
-- 指定地点の近傍現場（距離順）
SELECT * FROM twin.nearby_projects(139.668, 35.593, 500, 20);

-- 指定地点を含む施工範囲
SELECT * FROM twin.features_containing(139.668, 35.593, ARRAY['workzone'], 50);

-- 指定日に有効な影響イベント
SELECT * FROM twin.impacts_active_at('2026-10-15', NULL);
```

### 公開精度の制御

`twin.public_projects` / `twin.public_features` は
`publication_state = 'published'` かつ `classification = 'public'` のみを返し、
代表点・工区を **250m メッシュ相当（0.0025度）へ丸めた** `public_*` 列を提供します。
原本ジオメトリ（`precise_*`）は認可された利用者だけに返す設計です。

---

## 5. API

| エンドポイント | 説明 | 主なクエリ |
|---|---|---|
| `GET /api/geocode` | 公的ジオコーダー（住所→緯度経度） | `q` `limit` |
| `GET /api/ledger` | 自社現場台帳検索 | `keyword` `category` `status` `municipality` `owner` `contractor` `workType` `jv` `from` `to` `limit` `offset` |
| `GET /api/geo/nearby` | 周辺の施工現場（PostGIS `ST_DWithin`） | `lng` `lat` `radius` `limit` |
| `GET /api/geo/contains` | 地点を含む施工範囲（PostGIS `ST_Intersects`） | `lng` `lat` `kinds` `limit` |
| `GET /api/health` | 構成状態（DB・ジオコーダー・ビューア・データ件数） | `probe=1` でジオコーダー到達確認 |
| `GET /api/projects` ほか | 既存の工事 API（変更なし） | 既存どおり |

応答には `source`（`postgis` / `static`）と `sourceLabel` が含まれます。
DB を使えなかった場合は `notice` に理由が入り、画面にも表示されます。

---

## 6. 検証

```bash
# 静的検証
npm run lint
npm run typecheck
npm test

# 本番ビルド
npm run build

# 到達確認（デプロイ後）
curl -s http://192.168.0.185:43100/api/health | jq .
curl -s "http://192.168.0.185:43100/api/geocode?q=東京都千代田区丸の内一丁目9番" | jq .
curl -s "http://192.168.0.185:43100/api/ledger?keyword=田園調布" | jq '.total, .source'
curl -s "http://192.168.0.185:43100/api/geo/nearby?lng=139.668&lat=35.593&radius=500" | jq '.count, .projects[0]'
curl -s "http://192.168.0.185:43100/api/geo/contains?lng=139.6679&lat=35.593" | jq '.features[0]'
```

`/api/health` は次を返します。

```jsonc
{
  "status": "ok",                       // すべて正常 / "degraded"
  "degraded": [],                       // 利用できない構成要素の id
  "database": { "configured": true, "reachable": true, "postgisVersion": "3.6.4", "projectCount": 24 },
  "geocoder": { "configured": true, "reachable": null },   // probe=1 で true/false
  "viewer": { "cesiumIonTokenConfigured": false, "plateauTilesetConfigured": false },
  "data": { "projects": 24, "impacts": 36, "geoJsonFeatures": 71 }
}
```

---

## 7. データ出典・ライセンス

| データ | 提供元 | ライセンス | 必須の出典表示 |
|---|---|---|---|
| 地理院タイル（標準地図・空中写真） | 国土地理院 | 公共データ利用規約 第1.0版 | `出典：国土地理院`（https://maps.gsi.go.jp/development/ichiran.html へのリンク） |
| 国土地理院 住所検索API | 国土地理院 | 公共データ利用規約 第1.0版 | `出典：国土地理院ウェブサイト（https://msearch.gsi.go.jp/address-search/AddressSearch）（国土地理院の住所検索結果を加工して作成）` |
| PLATEAU-Terrain | 国土交通省 | PDL1.0 | `PLATEAU \| Mapterhorn \| 国土地理院`（layer.json の指定） |
| PLATEAU 3D都市モデル | 国土交通省 Project PLATEAU | PDL1.0（CC BY 4.0 互換） | `出典：国土交通省 PLATEAUウェブサイト` |
| Cesium ion Japan 3D Buildings | Cesium GS, Inc. | Cesium ion 利用規約 | `3D都市モデル（国土交通省)（https://www.geospatial.jp/ckan/dataset/plateau）を加工して作成` |
| CesiumJS | CesiumJS Contributors | Apache License 2.0 | `Copyright 2011-2026 CesiumJS Contributors` |
| サンプル写真 | Wikimedia Commons | CC BY / CC BY-SA / CC0 | 作者・ライセンス・原典URL（画面表示済み） |

機械可読な台帳は PostGIS の `twin.data_provenance` / `twin.source_registry` に投入されています。

---

## 8. 既知の制約

### ジオコーダー

- 国土地理院 住所検索API は **号を原則として解決しません**（`東京都千代田区丸の内一丁目9番1号` → `…一丁目９番`）。
- 存在しない番地を投げても **エラーにならず親レベルの代表点を返します**。そのため本実装は
  到達したレベルを入力と比較し、浅い場合は「◯◯までの一致です」と明示します（`validateGeocode`）。
- 語句の部分一致で無関係な地点を返すことがあるため、都道府県＋市区町村の一致を必須にしています。
- **国土地理院に逆ジオコーディングAPIは存在しません**（2022年に uPlace REST API 終了）。本 MVP は逆ジオコーディングを実装していません。
- 入力される住所の粒度により、同じ住所でも代表点が数十メートルずれることがあります。施工範囲の確定には使用しないでください。

### 3D

- Cesium ion の Japan 3D Buildings / Japan Regional Terrain は**トークン設定時のみ**使用します。
- トークン未設定時の3D建物は `NEXT_PUBLIC_PLATEAU_TILESET_URL` の有無に依存します。
  未設定の場合、3D建物は表示されません（地理院タイルの画像と施工範囲は表示されます）。画面にもその旨を表示します。
- 完成予想モデルは、`visual.modelUrl`（glTF/GLB）がある案件のみ描画します。
  サンプル24案件には GLB が無いため、完成予想は手続き生成モデル（Three.js ビューア）で表示します。

#### CesiumJS を npm から import してはいけない（重要・実測済み）

CesiumJS は WASM バイナリを **タグ付きテンプレート**として埋め込んでいます。

```js
wasmBytes ?? (wasmBytes = decode(`\0asm\x01\0\0\0…`));
```

タグ付きテンプレートは ES2018 の仕様で不正なエスケープ（`\0` などの8進）が許容されますが、
**タグが外れると構文エラー**になります。Next.js 16 の既定バンドラ Turbopack は
タグ関数をインライン化する際にタグを落とすため、バンドル後のコードが

```text
SyntaxError: Octal escape sequences are not allowed in template strings.
```

となり、CesiumJS が起動しません（headless Chrome で実測。`scripts/probe-cesium.mjs` で再現可能）。

そのため本実装は、バンドラを通さず `scripts/copy-cesium.mjs` が複製した
**`public/cesium/Cesium.js`（UMD ビルド）を `<script>` で読み込み**、
グローバルの `window.Cesium` を使用します（`loadCesium()` in `CesiumJapanViewer.tsx`）。
型は `typeof import("cesium")`（型のみ）で取得するため、ランタイム依存は増えません。

この回避策を外して `import("cesium")` に戻すと、ビルドは成功するのに
ブラウザで 3D が起動しません。`npm run build` の成功だけでは検出できないため、
**必ず `node scripts/probe-cesium.mjs` で実ブラウザ確認を行ってください。**

### データ

- 収録している 24 案件は **開発用サンプルデータ**であり、実在の工事ではありません。
- 発注番号・JV・工種細分類は、サンプル案件に実データが無いため**現場IDから決定的に生成した補完値**です
  （`ledger_is_sample = true`、画面にも注記を表示）。
- 原本 BIM/CIM・点群は保持していません（REQ-S-002 により公開対象外）。

### 運用

- 認証・権限（Viewer / Editor / Reviewer / Publisher / Administrator）と管理画面（CRUD UI）は MVP 対象外です。
  公開状態はスキーマ・API のフィルタとして実装しています。
- 監査ログのテーブルは用意し、データ投入時に記録しますが、公開操作の UI は未実装です。

---

## 9. 将来拡張

```
Phase 1  公開工事ポータル（本 MVP）
Phase 2  公開管理・承認・監査・CMS/API 連携   ← audit_log / publication_state は準備済み
Phase 3  関係者限定 CDE                       ← classification / public_features で分離済み
Phase 4  点群・施工進捗を含む現場デジタルツイン
Phase 5  Construction World Model
Phase 6  AI エージェント
```

座標変換は `lib/geo/`、3D タイル設定は `lib/viewer/`、DB アクセスは `lib/db/` に分離してあり、
ビューア（Three.js / CesiumJS）やデータストア（静的 / PostGIS）を差し替えられる構造を維持しています。
