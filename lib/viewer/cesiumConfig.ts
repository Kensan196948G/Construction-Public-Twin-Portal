/**
 * CesiumJS ビューアの構成（背景・地形・3D建物・出典）。
 *
 * 方針:
 *   1. **トークン不要の経路を既定**とする。Cesium ion の Community プランは
 *      個人・非商用向けで、利用規約上「government project」には有償ライセンスが必要とされ、
 *      第三者へのサービス提供も制限される。公共工事ポータルでは既定にできない。
 *   2. ion のアクセストークンが設定されている場合のみ、
 *      Japan 3D Buildings（asset 2602291）と Japan Regional Terrain（2767062）を使う。
 *      これは Sandcastle の "Japan Buildings" サンプルと同じ構成。
 *      https://sandcastle.cesium.com/?id=japan-buildings
 *   3. 3D 背景が取得できなくても、工事情報と施工範囲の表示は継続する。
 *
 * 環境変数:
 *   NEXT_PUBLIC_CESIUM_ION_TOKEN        … ion アクセストークン（任意）
 *   NEXT_PUBLIC_PLATEAU_TILESET_URL     … PLATEAU 3D Tiles（任意・ion より優先）
 */

/* ------------------------------------------------------------------ *
 * 出典表示（ライセンス上、画面へ常時表示する）
 * ------------------------------------------------------------------ */

export const CESIUM_ATTRIBUTION = {
  cesium: "CesiumJS (Apache License 2.0) — Copyright 2011-2026 CesiumJS Contributors",
  gsi: "出典：国土地理院",
  gsiUrl: "https://maps.gsi.go.jp/development/ichiran.html",
  plateauTerrain: "PLATEAU | Mapterhorn | 国土地理院",
  plateau:
    "出典：国土交通省 PLATEAUウェブサイト（https://www.mlit.go.jp/plateau/）",
  ionJapanBuildings:
    "3D都市モデル（国土交通省)（https://www.geospatial.jp/ckan/dataset/plateau）を加工して作成",
} as const;

/* ------------------------------------------------------------------ *
 * Cesium ion アセット
 * ------------------------------------------------------------------ */

export const ION_ASSETS = {
  /** Japan 3D Buildings（PLATEAU CityGML を統合した全国3D建物） */
  japanBuildings: 2602291,
  /** Japan Regional Terrain（国土地理院 基盤地図情報ベースの地形） */
  japanTerrain: 2767062,
} as const;

/* ------------------------------------------------------------------ *
 * 地理院タイル / PLATEAU-Terrain（トークン不要）
 * ------------------------------------------------------------------ */

export const GSI_TILES = {
  /** 標準地図 */
  std: {
    id: "std",
    label: "標準地図",
    url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
    maximumLevel: 18,
    attribution: CESIUM_ATTRIBUTION.gsi,
  },
  /** 空中写真 */
  aerial: {
    id: "aerial",
    label: "空中写真",
    url: "https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg",
    maximumLevel: 18,
    attribution: CESIUM_ATTRIBUTION.gsi,
  },
} as const;

export type GsiTileId = keyof typeof GSI_TILES;

/**
 * PLATEAU-Terrain（国土交通省）。
 * quantized-mesh を配信しており、Cesium の `CesiumTerrainProvider` から直接読める。
 * **ion トークンは不要**（docs.plateauview.mlit.go.jp が明記）。
 */
export const PLATEAU_TERRAIN_URL = "https://tile.plateauview.mlit.go.jp/terrain";

/* ------------------------------------------------------------------ *
 * PLATEAU 3D Tiles（トークン不要・任意）
 * ------------------------------------------------------------------ */

/**
 * 政令指定都市・東京23区の一部について、PLATEAU の公開 3D Tiles データセット ID を持つ。
 * `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/<id>/tileset.json` で取得できる。
 *
 * 本 MVP のサンプル案件は架空の自治体が多いため、該当が無い場合は
 * 3D建物を表示せず「未構成」と画面に明示する（実データがあるように見せない）。
 */
export const PLATEAU_DATASETS: Record<string, string> = {
  千代田区: "13101-bldg-lod2-latest",
  中央区: "13102-bldg-lod2-latest",
  港区: "13103-bldg-lod2-latest",
  新宿区: "13104-bldg-lod2-latest",
  文京区: "13105-bldg-lod2-latest",
  台東区: "13106-bldg-lod2-latest",
  墨田区: "13107-bldg-lod2-latest",
  江東区: "13108-bldg-lod2-latest",
  品川区: "13109-bldg-lod2-latest",
  目黒区: "13110-bldg-lod2-latest",
  大田区: "13111-bldg-lod2-latest",
  世田谷区: "13112-bldg-lod2-latest",
  渋谷区: "13113-bldg-lod2-latest",
  中野区: "13114-bldg-lod2-latest",
  杉並区: "13115-bldg-lod2-latest",
  豊島区: "13116-bldg-lod2-latest",
  北区: "13117-bldg-lod2-latest",
  荒川区: "13118-bldg-lod2-latest",
  板橋区: "13119-bldg-lod2-latest",
  練馬区: "13120-bldg-lod2-latest",
  足立区: "13121-bldg-lod2-latest",
  葛飾区: "13122-bldg-lod2-latest",
  江戸川区: "13123-bldg-lod2-latest",
};

const PLATEAU_CATALOG_BASE = "https://api.plateauview.mlit.go.jp/datacatalog/3dtiles";

/** 自治体名から PLATEAU 3D Tiles の URL を引く。未登録なら null。 */
export function plateauTilesetUrlFor(municipality: string): string | null {
  const dataset = PLATEAU_DATASETS[municipality];
  return dataset ? `${PLATEAU_CATALOG_BASE}/${dataset}/tileset.json` : null;
}

/* ------------------------------------------------------------------ *
 * 3D建物レイヤーの解決（表示元を 1 か所で決める）
 * ------------------------------------------------------------------ */

export type BuildingSource = "ion" | "plateau" | "none";

export interface BuildingPlan {
  source: BuildingSource;
  /** tileset.json の URL（ion の場合は空） */
  url: string;
  /** ion アセット ID（plateau の場合は null） */
  ionAssetId: number | null;
  /** 画面に出す日本語の説明 */
  label: string;
  /** 表示しない理由（source === "none" のとき） */
  reason?: string;
}

export interface ViewerEnvironment {
  ionToken: string;
  /** 明示指定された PLATEAU 3D Tiles（最優先） */
  explicitPlateauUrl: string;
}

export function readViewerEnvironment(): ViewerEnvironment {
  return {
    ionToken: process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "",
    explicitPlateauUrl: process.env.NEXT_PUBLIC_PLATEAU_TILESET_URL ?? "",
  };
}

/**
 * 表示する3D建物の供給元を決める。
 * 優先順位: 明示指定 PLATEAU > ion（トークンあり） > 自治体の PLATEAU > なし
 */
export function planBuildings(
  environment: ViewerEnvironment,
  municipality: string | null,
): BuildingPlan {
  if (environment.explicitPlateauUrl) {
    return {
      source: "plateau",
      url: environment.explicitPlateauUrl,
      ionAssetId: null,
      label: "PLATEAU 3D都市モデル（環境変数で指定）",
    };
  }

  if (environment.ionToken) {
    return {
      source: "ion",
      url: "",
      ionAssetId: ION_ASSETS.japanBuildings,
      label: "Japan 3D Buildings（Cesium ion）",
    };
  }

  const plateauUrl = municipality ? plateauTilesetUrlFor(municipality) : null;
  if (plateauUrl) {
    return {
      source: "plateau",
      url: plateauUrl,
      ionAssetId: null,
      label: `PLATEAU 3D都市モデル（${municipality}）`,
    };
  }

  return {
    source: "none",
    url: "",
    ionAssetId: null,
    label: "3D建物 未構成",
    reason:
      "ion トークン未設定、かつ選択中の自治体の PLATEAU 3D Tiles が未登録のため、3D建物は表示していません。",
  };
}

/* ------------------------------------------------------------------ *
 * カメラ
 * ------------------------------------------------------------------ */

export const CESIUM_CAMERA = {
  /** 工区へ寄るときのカメラ距離（m） */
  focusRangeM: 620,
  /** 市内を俯瞰するときのカメラ距離（m） */
  cityRangeM: 3200,
  /** 移動アニメーションの秒数 */
  flightSeconds: 1.6,
  /** 検索地点へ寄るときの高さ（m） */
  pinHeightM: 900,
} as const;

/** 初期表示（サンプル地区: 田園調布周辺） */
export const CESIUM_HOME = {
  longitude: 139.668,
  latitude: 35.593,
  heightM: 2600,
} as const;

/** 外部サービス待ちの上限（ms）。超過したらそのレイヤーだけ諦める。 */
export const CESIUM_LOAD_TIMEOUT_MS = 12_000;
