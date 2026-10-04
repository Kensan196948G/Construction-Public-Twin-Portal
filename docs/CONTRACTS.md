# 実装契約（FROZEN）/ Implementation Contracts

対象: 「工事みえるマップ 3D Beta」MVP WebUI
凍結日: 2026-10-04

この文書は **Agent Team の並列実装における唯一の基準** です。
ここに書かれたインターフェースを変更する場合は、必ず Lead の承認を得てください。

---

## 0. 絶対ルール

1. **担当ディレクトリ以外を書き換えない。** 担当範囲は §2 のとおり。
2. **新しい npm 依存を追加しない。** 追加が必要なら Lead に相談する。
   承認済みの追加依存: `3d-tiles-renderer@0.5.3`（PLATEAU 3D Tiles の実描画用。Lead が導入済み）。
   サブパスは `3d-tiles-renderer/three` / `3d-tiles-renderer/r3f` を使うこと
   （`/babylonjs` は Babylon の peer が必要なため使用禁止）。
   **必ず動的 `import()` + try/catch で読み込み、失敗しても画面を落とさないこと。**
3. ブラウザ API（`window`, `document`, `WebGL`, `fetch`, Zustand フック）を使うファイルは
   先頭に `"use client";` を置く。
4. **外部ネットワークが無くても主要機能が動くこと。** 3D Tiles・地図タイル・Web フォントは
   「あれば使う、無ければフォールバック」として扱う。外部依存の失敗で
   画面全体をエラーにしてはならない。
5. 見た目は `WebUI/koji-mieru-map-3d.html`（デザインハンドオフ）が正。
   色・角丸・余白・タイポグラフィは `app/globals.css` のトークンを必ず使う。
   独自の hex 直書きを増やさない。
6. 日本語 UI。エラー時も日本語のメッセージを出す。
7. `npm run typecheck` が通る状態を保つ。`any` で逃げない（やむを得ない場合は理由コメント）。

---

## 1. 凍結済みの共有基盤（Lead が実装済み・変更禁止）

| モジュール | 提供内容 |
|---|---|
| `app/globals.css` | デザイントークン（`:root`）と共有プリミティブのグローバルクラス |
| `lib/schemas/project.ts` | `Project`, `ProjectSummary`, `PROJECT_STATUS_LABEL`, `PROJECT_CATEGORIES`, `COMPLETION_TYPE_LABEL` ほか |
| `lib/schemas/impact.ts` | `Impact`, `ImpactType`, `IMPACT_TYPE_LABEL`, `IMPACT_SEVERITY_LABEL`, `isImpactActiveAt()` |
| `lib/geo/transform.ts` | `SCENE_ORIGIN`, `lngLatToScene()`, `sceneToLngLat()` |
| `lib/geo/geojson.ts` | `FeatureCollection`, `GeoJsonFeature`, `validateFeatureCollection()` |
| `lib/data/projects.ts` | `publicProjects()`, `getProjectById()`, `getProjectBySlug()`, `toSummary()`, `categoryCounts()`, `statusCounts()`, `municipalities()` |
| `lib/data/impacts.ts` | `publicImpacts()`, `impactsForProject()`, `impactsActiveAt()`, `getImpactById()` |
| `lib/data/filter.ts` | `filterProjects()`, `matchesKeyword()`, `searchSuggestions()` |
| `lib/data/source.ts` | `TIMELINE_START`, `TIMELINE_TODAY_INDEX`, `SAMPLE_DISCLAIMER` |
| `lib/store/useAppStore.ts` | `useAppStore`, `LAYERS`, `LAYER_GROUPS`, `timelineIndexToDate()`, `TIMELINE_MIN/MAX` |
| `lib/viewer/tileConfig.ts` | `PLATEAU_TILESET`, `LOCAL_CITY_TILESET`, `VIEWER_LIMITS`, `TILESET_LOAD_TIMEOUT_MS` |
| `public/data/**` | 生成済み JSON / GeoJSON（`npm run export:data` で再生成可能） |

### 所有権の補足（2026-10-04 追記）

- **TimelineControl のスタイルは `components/viewer/viewer.module.css` に自己完結**させる。
  `components/layout/layout.module.css` の `.timeline` 系は削除済み（二重定義回避）。
- **3D のカメラプリセット（俯瞰 / 真上 / リセット等）は viewer3d 側の UI** として実装する。
  `ViewportControls`（Lead 担当）は 2D/3D 切替・3D背景切替・現場ビューア起動のみを持つ。
- PLATEAU 3D Tiles を実描画する場合、**attribution の表示が必須**（CC BY 4.0）。
  `3d-tiles-renderer/r3f` の `TilesAttributionOverlay`、または `tileConfig` の `attribution` を使う。
- 取得できていないタイルを「表示中」と表示してはならない。状態は正直に出す。

### Zustand ストアの形（`useAppStore`）

```ts
selectedProjectId: string | null
searchKeyword: string
selectedCategory: ProjectCategory | null
selectedStatus: ProjectStatus | null
viewMode: "3d" | "2d"
viewTime: string            // ISO 文字列
visibleLayers: Record<LayerId, boolean>
selectedImpactId: string | null
regulatingOnly: boolean
sidebarTab: "projects" | "layers"
siteViewerOpen: boolean
siteViewerIndex: number
completionMode: "current" | "planned" | "compare"
base3dSource: "local" | "plateau"
mobileSheetOpen: boolean
toast: { id: number; message: string } | null
```

アクション: `selectProject(id)`, `setSearchKeyword(s)`, `setCategory(c)`, `setStatus(s)`,
`setViewMode(m)`, `setViewTime(iso)`, `setTimelineIndex(n)`, `toggleLayer(id)`,
`setLayerVisible(id, v)`, `setAllLayers(v)`, `selectImpact(id)`, `setRegulatingOnly(b)`,
`setSidebarTab(t)`, `openSiteViewer(i?)`, `closeSiteViewer()`, `setSiteViewerIndex(i)`,
`setCompletionMode(m)`, `setBase3dSource(s)`, `setMobileSheetOpen(b)`,
`showToast(msg)`, `clearToast()`

取得例:

```tsx
const viewTime = useAppStore((s) => s.viewTime);
const selectProject = useAppStore((s) => s.selectProject);
```

### CSS の流儀

- **共有プリミティブはグローバルクラス**をそのまま使う:
  `.float` `.pill`(`.planned/.active/.reg/.done/.cat/.solid`) `.sev-pill`(`.info/.notice/.warning`)
  `.fchip` `.tchip` `.chip-btn` `.top-btn` `.icon-btn` `.seg` `.switch` `.lg-head` `.grp-head`
  `.empty-note` `.toast` `.modal-bg` `.modal` `.spinner` `.mono` `.num`
- **レイアウト固有のスタイルは CSS Modules**（`*.module.css`）に書く。
  同じディレクトリ内のコンポーネント専用ファイルなので衝突しない。

---

## 2. 担当範囲（書き込みスコープ）

| 担当 | 書き込み可能パス |
|---|---|
| **Lead** | `app/layout.tsx`, `app/page.tsx`, `app/projects/**`, `app/globals.css`, `components/layout/**`, `lib/viewer/tileConfig.ts`, `README.md`, `docs/**` |
| **viewer3d** | `components/viewer/**`, `lib/viewer/cameraPresets.ts`, `lib/viewer/sceneBuilder.ts` |
| **map2d** | `components/map/**`, `lib/viewer/mapStyle.ts` |
| **projectui** | `components/project/**` |
| **apidata** | `app/api/**`, `tests/**`, `vitest.config.ts` |

この範囲外を触る必要が出たら、Lead にメッセージを送って調整すること。

---

## 3. 凍結インターフェース

### 3.1 Lead が呼び出すコンポーネント（**このシグネチャで実装すること**）

```tsx
// --- map2d 担当 ---
// components/map/ProjectSearch.tsx
export function ProjectSearch(): React.ReactElement;
// 検索入力 + サジェスト。サジェスト選択で selectProject()、自治体/工種は setCategory/setSearchKeyword。

// components/map/ProjectFilter.tsx
export function ProjectFilter(): React.ReactElement;
// 施工状態チップ（すべて/施工中/着工前/規制中/完成）。data-f 属性で .fchip の色ドットを出す。

// components/map/ProjectList.tsx
export function ProjectList(): React.ReactElement;
// 検索・フィルタに連動した工事一覧。選択で selectProject()。件数 0 なら .empty-note を表示。

// components/map/FallbackMap.tsx
export function FallbackMap(): React.ReactElement;
// MapLibre GL の2D地図。工区・規制・迂回路・歩道切替・工事位置を描画。
// タイルが取得できなくても背景 + GeoJSON オーバーレイで必ず表示できること。

// --- viewer3d 担当 ---
// components/viewer/PublicTwinViewer.tsx
export function PublicTwinViewer(): React.ReactElement;
// Three.js / R3F の3Dシーン。WebGL 不可・初期化失敗時は
// 「3Dを表示できません」+ 2Dへ切り替えるボタンを出す（例外を投げない）。

// components/viewer/LayerControl.tsx
export function LayerControl(): React.ReactElement;
// LAYERS / LAYER_GROUPS を使ったレイヤー ON/OFF。toggleLayer()。

// components/viewer/TimelineControl.tsx
export function TimelineControl(): React.ReactElement;
// 時間軸スライダー。setTimelineIndex()。現在 / 完成予定 のジャンプボタン。

// --- projectui 担当 ---
// components/project/ProjectDetailCard.tsx
export function ProjectDetailCard({ projectId }: { projectId: string }): React.ReactElement | null;
// 工事詳細カード。projectId が null / 未発見なら null を返す（呼び出し側で空状態を出す）。
// 内部で ImpactPanel / ProjectTimeline / OfficialSourceLink / Disclaimer を組み合わせてよい。

// components/project/SiteViewer.tsx
export function SiteViewer(): React.ReactElement | null;
// 現場ビューア全画面。ストアの siteViewerOpen が false なら null。closeSiteViewer() で閉じる。

// --- apidata 担当 ---
// app/api/projects/route.ts        GET /api/projects
// app/api/projects/[id]/route.ts   GET /api/projects/:id
// app/api/impacts/route.ts         GET /api/impacts
// app/api/search/route.ts          GET /api/search
// app/api/tilesets/route.ts        GET /api/tilesets
```

### 3.2 API の応答形（apidata 担当が守ること）

```jsonc
// GET /api/projects?keyword=&category=&status=&municipality=&regulating=true&at=ISO&from=&to=&limit=
{ "count": 24, "total": 24, "at": "2026-10-04T...", "projects": [ /* ProjectSummary[] */ ] }

// GET /api/projects/:id  … id または slug を受け付ける
{ "project": { /* Project */ }, "geometry": { /* FeatureCollection（工区） */ },
  "impacts": [ /* Impact[] */ ] }
// 未発見は 404 { "error": "..." }

// GET /api/impacts?projectId=&type=&activeAt=
{ "count": 36, "at": "…", "impacts": [ /* Impact[] */ ] }

// GET /api/search?q=
{ "query": "…", "count": 5, "suggestions": [ /* SearchSuggestion[] */ ] }

// GET /api/tilesets
{ "defaultSource": "local", "tilesets": [ /* TilesetConfig[] */ ] }
```

- **公開状態が `published` 以外の案件は絶対に返さない**（`publicProjects()` を使う）。
- エラーは `{ "error": string }` と適切な HTTP ステータス。

---

## 4. 画面レイアウト（Lead が `app/page.tsx` で組み立てる）

```
┌──────────────────────────────────────────────────────────┐
│ TopBar: ブランド / ProjectSearch / ProjectFilter / 更新時刻 │
├───────────────────────────────┬──────────────────────────┤
│ Viewport                      │ 右パネル (396px)          │
│  viewMode=3d → PublicTwinViewer│  ProjectDetailCard        │
│  viewMode=2d → FallbackMap     │   （未選択なら案内表示）   │
│  ＋ Sidebar(float): ProjectList│                          │
│  ＋ LayerControl / Timeline    │                          │
├───────────────────────────────┴──────────────────────────┤
│ StatusBar: 件数 / 表示日 / 出典 / サンプル注記              │
└──────────────────────────────────────────────────────────┘
```

- 1080px 以下: 詳細パネルが下段へ移動（`WebUI` の `@media` を踏襲）
- 640px 以下: 詳細は `MobileProjectSheet` としてボトムシート化（Lead 担当）

---

## 5. 完了条件（各担当）

- `npm run typecheck` が通る
- `npm run lint` が通る
- 自分のコンポーネントが外部ネットワーク無しでも致命的エラーを出さない
- 主要な操作（検索・選択・レイヤー切替・時間切替）がストアを通じて実際に動く
- 作業完了時、Lead に「変更ファイル / 動作確認方法 / 既知の制約」を報告する

---

# 第2次契約（現場ごとの3D / データレイヤー / 3Dギャラリー）

追加日: 2026-10-04
目的: 「1現場 = 1つの3D」への作り替えと、建設デジタルツインのデータレイヤー群の追加。

## 6. 追加した共有基盤（Lead が実装済み・変更禁止）

| モジュール | 提供内容 |
|---|---|
| `lib/store/useAppStore.ts` | `viewScope`(`"site"｜"area"`) / `DATA_LAYER_IDS`(11種) / `DATA_LAYERS` / `dataLayers` / `toggleDataLayer` / `setDataLayerVisible` / `setAllDataLayers` / `setViewScope` |
| `lib/site/sceneData.ts` | `buildSiteModelData(project)` が現場ごとの `SiteModelData`（BIM/CAD/点群/3DGS/撮影/軌跡/点検/指摘ピン/施工進捗）を**決定的に**生成。`SITE_LAYER_NOTE` |

### データレイヤー11種（`DATA_LAYERS`）

`bim` `cad` `gis` `pointcloud` `gaussian` `smartphone` `photo` `progress` `inspection` `trajectory` `aiPin`

- `gis` は既存の `workzone` / `regulation` / `detour` / `pedestrian` をまとめて制御する。
- `sample: true` のレイヤーは**合成サンプルデータ**。UI 上でその旨を必ず明示すること。
- 各レイヤーはトグルで**実際に3Dの見た目が変わる**こと（見た目が変わらない飾りは禁止）。

## 7. 第2次で凍結するインターフェース

```tsx
// components/viewer/SiteScene.tsx   … site3d 担当
// <Canvas> を含まない「シーンの中身」。呼び出し側が Canvas とカメラ操作を用意する。
export function SiteScene(props: {
  projectId: string;
  /** "full" = 通常表示 / "thumbnail" = ギャラリー用の軽量表示 */
  variant?: "full" | "thumbnail";
}): React.ReactElement | null;

// lib/viewer/cameraPresets.ts       … site3d 担当
export function siteCameraFor(projectId: string): {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
};

// components/gallery/Site3DGallery.tsx … gallery3d 担当
export function Site3DGallery(props: {
  onSelect?: (projectId: string) => void;
  selectedProjectId?: string | null;
}): React.ReactElement;
```

### `SiteScene` の責務（重要）

| 含める | 含めない |
|---|---|
| ライト / フォグ / 背景色 | `<Canvas>` |
| 地面・現場モデル・完成予想 | カメラ操作（OrbitControls 等） |
| GIS レイヤー・データレイヤー | カメラ初期位置 |
| `dataLayers` に応じた描画 | DOM UI（バッジ・凡例） |

理由: gallery3d が24現場を順に描画して画像化するため、操作系があると撮影が不安定になる。

## 8. 第2次の担当スコープ

| 担当 | 書き込み可能パス |
|---|---|
| **Lead** | `app/**`, `components/layout/**`, `components/project/SiteViewer.tsx`, `components/project/SiteViewer.module.css`, `lib/store/**`, `lib/site/**`, `docs/**`, `README.md` |
| **site3d** | `components/viewer/**`, `lib/viewer/siteScene.ts`, `lib/viewer/cameraPresets.ts` |
| **gallery3d** | `components/gallery/**` |

## 9. 性能上の必須要件（gallery3d）

**24個の `<Canvas>` を同時に生成してはならない。** ブラウザの WebGL コンテキスト上限（概ね16）を超える。
1つの `<Canvas>`（`gl={{ preserveDrawingBuffer: true }}`）で24現場を順に描画し、
`gl.domElement.toDataURL()` で画像化 → 24枚の `<img>` として表示する。
画像化に失敗したタイルは `visual.thumbnailUrl`（サンプル写真）へフォールバックし、必ず何か表示する。

