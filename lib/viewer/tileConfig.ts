/**
 * 3D Tiles（PLATEAU 等）の設定。
 *
 * 方針（仕様書 #19/#23）:
 *   3D 背景が取得できなくても、工事情報サービス全体を停止させない。
 *
 * MVP の既定背景は `local`（手続き生成の簡易都市モデル）とし、
 * PLATEAU の 3D Tiles URL はデプロイ環境が環境変数で供給する。
 *   NEXT_PUBLIC_PLATEAU_TILESET_URL
 *
 * URL が未設定・取得失敗・タイムアウトのいずれでも、
 * ビューアは local 背景へ自動フォールバックする。
 */

export interface TilesetConfig {
  id: string;
  /** 表示名 */
  name: string;
  /** 供給元 */
  provider: string;
  /** 対象地域 */
  area: string;
  /** データセット名 */
  dataset: string;
  /** ライセンス */
  license: string;
  /** attribution（著作権表示） */
  attribution: string;
  /** tileset.json の URL。空文字は「未構成」。 */
  url: string;
  /** 実際に読み込める構成か */
  configured: boolean;
  /**
   * URL の到達性・内容をこのリポジトリで検証済みか。
   * 未検証の外部エンドポイントを「動作確認済み」と表現しないためのフラグ。
   */
  verified: boolean;
  /** 注意書き */
  note?: string;
}

/** PLATEAU 3D Tiles（環境変数で供給） */
const plateauUrl = process.env.NEXT_PUBLIC_PLATEAU_TILESET_URL ?? "";

export const PLATEAU_TILESET: TilesetConfig = {
  id: "plateau-denenchofu",
  name: "PLATEAU 3D都市モデル（田園調布周辺）",
  provider: "国土交通省 Project PLATEAU",
  area: "東京都 大田区 田園調布",
  dataset: "3D都市モデル (CityGML / 3D Tiles)",
  license: "CC BY 4.0（PLATEAU オープンデータ）",
  attribution: "国土交通省 Project PLATEAU",
  url: plateauUrl,
  configured: plateauUrl.length > 0,
  verified: false,
  note: plateauUrl
    ? "デプロイ環境変数 NEXT_PUBLIC_PLATEAU_TILESET_URL から供給されています。取得に失敗した場合はローカル背景へ自動的に切り替わります。"
    : "NEXT_PUBLIC_PLATEAU_TILESET_URL が未設定のため、MVP では手続き生成のローカル都市背景を使用します。",
};

/** MVP 内蔵のローカル背景（外部依存なし） */
export const LOCAL_CITY_TILESET: TilesetConfig = {
  id: "local-procedural",
  name: "簡易3D都市モデル（MVP内蔵）",
  provider: "本アプリ内で手続き生成",
  area: "基準点 周辺 ±900m",
  dataset: "procedural-city",
  license: "本アプリのサンプルデータ",
  attribution: "工事みえるマップ 3D Beta（サンプル）",
  url: "",
  configured: true,
  verified: true,
  note: "外部タイル配信に依存しないため、常に表示できます。",
};

export const TILESETS: TilesetConfig[] = [LOCAL_CITY_TILESET, PLATEAU_TILESET];

/** チルト・最大/最小ピッチなどのビューア制約（カメラプリセットと共有） */
export const VIEWER_LIMITS = {
  minPitchDeg: 5,
  maxPitchDeg: 85,
  minDistanceM: 40,
  maxDistanceM: 2200,
  /** 工区へフォーカスするときの距離 */
  focusDistanceM: 260,
} as const;

/** 3D Tiles の読み込みタイムアウト（ms）。超過したらローカル背景へ切替。 */
export const TILESET_LOAD_TIMEOUT_MS = 8000;
