# 工事みえるマップ 3D Beta
## システム仕様書

**文書種別:** 基本・機能仕様書  
**対象:** MVP  
**基準日:** 2026年10月4日

---

# 1. システム構成

## 1.1 基本構成

```text
Public Web UI
 Next.js / React / TypeScript
        │
        ├─ HTML UI
        │   ├─ 検索
        │   ├─ フィルタ
        │   ├─ 工事一覧
        │   └─ 工事詳細
        │
        └─ 3D Scene
            ├─ Three.js
            ├─ React Three Fiber
            ├─ 3d-tiles-renderer
            ├─ PLATEAU 3D Tiles
            ├─ GeoJSON Overlay
            └─ GLB
        │
        ▼
Public API / BFF
        │
        ▼
Public Data Store
```

---

# 2. 技術仕様

| 領域 | 採用技術 |
|---|---|
| Web | Next.js |
| UI | React |
| 言語 | TypeScript |
| 3D | Three.js |
| React/3D | React Three Fiber |
| 3D補助 | @react-three/drei |
| 3D Tiles | 3d-tiles-renderer |
| GLB | Three.js GLTFLoader |
| 地理演算 | Turf.js |
| 2D地図 | MapLibre GL JS |
| 状態管理 | Zustand |
| Schema | Zod |
| 工事データ | JSON / CSV |
| GIS | GeoJSON |
| 3D背景 | PLATEAU 3D Tiles |
| 完成予想 | glTF / GLB |
| API | REST |
| ファイル | Cloudflare R2またはS3互換 |
| 配信 | Cloudflare Pages / Workers等 |
| 監視 | Web Vitals / Sentry相当 |

---

# 3. 画面仕様

## SCR-001 トップ・検索画面

### 機能

- キーワード検索
- 住所検索
- 駅名検索
- 工事件名検索
- 工種フィルタ
- 状態フィルタ
- 規制状態フィルタ
- 期間フィルタ

### 表示

検索結果を、

- 3D地図
- 2D地図
- 工事一覧

と連動表示する。

---

# 4. メイン3D画面

```text
┌─────────────────────────────────────────────┐
│ 検索 / フィルタ / レイヤー / 2D-3D切替     │
├─────────────────────┬───────────────────────┤
│                     │ 工事情報カード        │
│    3D Viewer        │                       │
│                     │ 工事件名              │
│ PLATEAU              │ 工事目的              │
│ 工区                  │ 発注者                │
│ 規制                  │ 工期                  │
│ 完成予想              │ 状態                  │
│ 迂回路                │ 影響                  │
│                     │ 公式情報              │
├─────────────────────┴───────────────────────┤
│ 時間軸 / 現在 / 完成予定                   │
└─────────────────────────────────────────────┘
```

---

# 5. 3Dレイヤー仕様

## LYR-001 Base Layer

- PLATEAU 3D Tiles
- 地形
- 建物
- 必要に応じ航空写真

## LYR-002 Project Layer

- 工事代表点
- 工区Polygon
- 線状施工区間
- 完成予想GLB
- 施工状態

## LYR-003 Impact Layer

- 車線規制
- 通行止め
- 迂回路
- 歩道切替
- 夜間作業
- 騒音・振動等

## LYR-004 Information Layer

- 工事情報
- 更新日時
- 出典
- 公式URL
- 注意事項

---

# 6. 座標仕様

MVPでは地球全体をThree.jsで直接管理しない。

対象地域ごとに基準点を設定し、

```text
WGS84 / PLATEAU
    ↓
対象地区の基準点
    ↓
ローカル座標変換
    ↓
Three.js Scene
```

として処理する。

基本方向は、

- X：東西
- Y：高さ
- Z：南北

とする。

変換処理はUIコンポーネントから分離し、将来的なCesiumJS等への変更に備える。

---

# 7. GeoJSON表示仕様

| 情報 | Geometry |
|---|---|
| 工区 | Polygon / MultiPolygon |
| 道路工事 | LineString |
| 河川工事 | LineString |
| 工事入口 | Point |
| 車線規制 | LineString |
| 歩道切替 | Polygon |
| 立入制限 | Polygon |
| 迂回路 | LineString |
| 騒音等影響 | Polygon |

GeoJSON Featureには最低限、

```text
id
projectId
type
name
validFrom
validTo
source
updatedAt
```

を保持可能とする。

---

# 8. 工事データ仕様

```json
{
  "id": "project-id",
  "slug": "project-slug",
  "status": "under_construction",
  "category": "road",
  "name": "正式工事件名",
  "publicTitle": "住民向け名称",
  "purpose": "工事目的",
  "benefits": [],
  "owner": {},
  "contractor": {},
  "schedule": {},
  "location": {},
  "visual": {},
  "impacts": [],
  "visibility": {},
  "disclaimer": {}
}
```

## 必須属性

- id
- status
- category
- name
- publicTitle
- purpose
- owner
- schedule
- location
- visibility
- lastUpdatedAt

Zod Schemaによる入力検証を行う。

---

# 9. 影響イベント仕様

交通規制等はProjectとは別エンティティとして管理する。

```json
{
  "id": "impact-id",
  "projectId": "project-id",
  "type": "lane_closure",
  "severity": "notice",
  "title": "夜間の片側交互通行",
  "description": "",
  "activeFrom": "",
  "activeTo": "",
  "recurrence": {},
  "geometryUrl": "",
  "detourUrl": "",
  "source": {}
}
```

## type例

```text
lane_closure
road_closure
sidewalk_switch
detour
night_work
noise
vibration
access_restriction
```

---

# 10. API仕様

## GET /api/projects

工事一覧を取得する。

### Query

```text
keyword
category
status
municipality
from
to
```

---

## GET /api/projects/{id}

工事詳細を取得する。

---

## GET /api/impacts

影響イベント一覧を取得する。

### Query

```text
projectId
type
activeAt
```

---

## GET /api/search

住所、駅、工事件名等から検索する。

---

## GET /api/tilesets

対象地区で利用する3D Tiles設定を取得する。

---

# 11. 工事選択動作

利用者が3D空間または一覧から工事を選択した場合、

1. selectedProjectIdを状態管理へ保存
2. 対象工区を強調
3. カメラを工区へ移動
4. ProjectDetailCardを表示
5. 関連Impactをロード
6. 時間条件に一致するImpactを表示
7. 公式URLを表示

する。

---

# 12. 時間軸仕様

以下のモードを提供する。

```text
現在
指定日
今週
今月
完成予定
```

指定日時を`viewTime`として保持する。

Impactについて、

```text
activeFrom <= viewTime <= activeTo
```

を基本条件として表示判定する。

---

# 13. 完成予想仕様

完成予想モデルはGLBを標準とする。

### 表示モード

```text
現在
完成予想
比較
```

比較モードはMVPでは、

- ON/OFF
- 透明度切替

等の簡易比較でよい。

BIM/CIM原本を直接ロードしない。

---

# 14. 公開状態仕様

```text
draft
review
approved
published
suspended
expired
```

基本遷移:

```text
draft
 ↓
review
 ↓
approved
 ↓
published
 ↓
suspended / expired
```

`published`以外をPublic APIへ返してはならない。

---

# 15. 公開検証

公開前に最低限以下をチェックする。

- 必須フィールド
- 工期形式
- GeoJSON形式
- 公式URL
- 出典
- 更新日時
- 公開区分
- 公開期限
- 3Dファイル存在
- 画像公開可否

将来的には画像の、

- 顔
- ナンバープレート
- EXIF

等の検証も追加する。

---

# 16. 権限

MVP管理系では最低限、

```text
Viewer
Editor
Reviewer
Publisher
Administrator
```

を想定する。

公開操作はPublisherまたはAdministratorのみ許可する。

将来的にはEntra ID / OIDC、RBAC＋ABACへ移行可能な設計とする。

---

# 17. ログ仕様

以下を記録する。

```text
timestamp
userId
action
projectId
oldVersion
newVersion
result
clientIp
requestId
```

対象操作：

- 新規作成
- 更新
- 承認
- 公開
- 非公開
- 公開停止
- 削除
- ファイル更新

---

# 18. 3D性能対策

3D Tilesについて、

- View Frustum
- LOD
- 距離
- Screen Space Error相当

を利用してロード量を制御する。

GLBについて、

- Mesh圧縮
- Texture圧縮
- LOD
- WebP等

を検討する。

すべての工事GLBを初期ロードしてはならない。

選択案件または近傍案件を中心に遅延ロードする。

---

# 19. フォールバック

## Level 1

3D利用可能

→ Three.js 3D表示

## Level 2

3D性能不足

→ MapLibre 2D表示

## Level 3

低帯域・アクセシビリティ優先

→ テキスト＋工事カード

工事情報そのものを3D機能へ依存させてはならない。

---

# 20. ディレクトリ仕様

```text
app/
  page.tsx
  projects/
  api/

components/
  layout/
  map/
  viewer/
  project/

lib/
  schemas/
  geo/
  data/
  viewer/

public/
  data/
    projects/
    impacts/
  models/
    projects/
  images/
```

---

# 21. 管理機能仕様

MVPでは管理者が以下を実施可能とする。

- 工事登録
- 工事編集
- GeoJSON登録
- GLB登録
- サムネイル登録
- 公式URL登録
- 出典登録
- 公開プレビュー
- 公開申請
- 公開
- 公開停止

初期段階ではJSON/CSVインポートを許容する。

---

# 22. 監視

最低限、

- JavaScriptエラー
- APIエラー
- 3D Tilesロードエラー
- GLBロードエラー
- Web Vitals
- API応答時間

を監視する。

---

# 23. 外部データ障害

PLATEAU等の外部3Dデータが取得できない場合、

```text
3D背景取得失敗
      ↓
工事データはそのまま表示
      ↓
2D地図へフォールバック
```

とする。

外部サービス障害を工事情報サービス全体の障害にしてはならない。

---

# 24. テスト仕様

## TST-001 データ

- 必須項目欠落を検出できること
- 不正日付を検出できること
- 不正GeoJSONを検出できること

## TST-002 UI

- 検索結果が正しく表示されること
- 3Dと情報カードが同期すること
- レイヤーON/OFFが機能すること

## TST-003 時間

指定日に該当する規制のみ表示されること。

## TST-004 3D

- PLATEAUを表示できる
- GLBを表示できる
- 工区を正しい位置に表示できる

## TST-005 フォールバック

WebGL利用不可でも工事情報を閲覧できること。

## TST-006 セキュリティ

非公開案件がPublic APIから取得できないこと。

## TST-007 監査

公開操作が監査ログに残ること。

---

# 25. MVP完了条件

以下を満たした場合、MVPを完成と判定する。

- 5件以上の工事を登録済み
- 検索可能
- 2D／3D表示可能
- PLATEAU表示可能
- GeoJSON工区表示可能
- 規制・迂回路表示可能
- GLB完成予想表示可能
- 時間条件による表示可能
- 工事詳細表示可能
- 出典・更新日時表示可能
- 管理画面から更新可能
- 公開状態制御可能
- 監査ログ取得可能
- 2Dフォールバック可能
- モバイル閲覧可能

---

# 26. 将来互換性

MVPではThree.jsを採用するが、

```text
データ層
       ↓
3D Tiles / GeoJSON / GLB
       ↓
Viewer Adapter
       ↓
Three.js
```

という分離構造とする。

これにより将来、

```text
Three.js
   +
CesiumJS
   +
BIM専用Viewer
```

の二層・三層構成へ発展できるものとする。

最終的には、

```text
Public Twin Portal
        ↓
公開・承認基盤
        ↓
Project CDE
        ↓
Construction Twin
        ↓
Construction World Model
        ↓
AI Agent
```

へ接続可能な設計を維持する。