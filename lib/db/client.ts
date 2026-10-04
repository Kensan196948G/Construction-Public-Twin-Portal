/**
 * PostGIS 接続（サーバー専用）。
 *
 * 設計原則（docs/CONTRACTS.md §0-4）:
 *   **DB が無くてもアプリは動作する。** DATABASE_URL 未設定・接続失敗・クエリ失敗の
 *   いずれの場合も例外を投げず、呼び出し側がフォールバック（静的データ）へ
 *   切り替えられるように `DbOutcome` を返す。
 *
 * このモジュールは Route Handler / サーバーコンポーネントからのみ import すること。
 * クライアントコンポーネントから import すると pg がブラウザバンドルへ入る。
 */
import { Pool, type QueryResultRow } from "pg";

/** 結果の型。失敗しても例外にせず理由を返す。 */
export type DbOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_configured" | "unavailable"; message: string };

/** クエリ結果に付ける由来（画面に「PostGIS 由来」と表示するため） */
export const DB_SOURCE_LABEL = "PostGIS (construction_twin)";

declare global {
  // HMR / 複数リクエストで Pool を作り直さない
  var __constructionTwinPool: Pool | undefined;
}

export function isDbConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === "string" && url.trim().length > 0;
}

function createPool(url: string): Pool {
  const pool = new Pool({
    connectionString: url,
    // 画面応答を止めないための上限。超過したら静的データへフォールバックする。
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30_000,
    max: 5,
  });
  // Pool 由来の未処理エラーでプロセスを落とさない
  pool.on("error", () => {
    /* 接続断はクエリ単位で検出してフォールバックする */
  });
  return pool;
}

export function getPool(): Pool | null {
  if (!isDbConfigured()) return null;
  if (!globalThis.__constructionTwinPool) {
    globalThis.__constructionTwinPool = createPool(process.env.DATABASE_URL as string);
  }
  return globalThis.__constructionTwinPool;
}

/**
 * SQL を実行する。失敗は例外ではなく `{ ok: false }` で返す。
 */
export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<DbOutcome<T[]>> {
  const pool = getPool();
  if (!pool) {
    return {
      ok: false,
      reason: "not_configured",
      message: "DATABASE_URL が未設定のため、静的データで応答しています。",
    };
  }
  try {
    const result = await pool.query<T>(text, values);
    return { ok: true, data: result.rows };
  } catch (error) {
    return {
      ok: false,
      reason: "unavailable",
      message:
        error instanceof Error
          ? `PostGIS へ問い合わせできませんでした: ${error.message}`
          : "PostGIS へ問い合わせできませんでした。",
    };
  }
}

/* ------------------------------------------------------------------ *
 * ヘルスチェック（/api/health / 運用監視用）
 * ------------------------------------------------------------------ */

export interface DbHealth {
  configured: boolean;
  reachable: boolean;
  postgisVersion?: string;
  projectCount?: number;
  featureCount?: number;
  error?: string;
}

export async function dbHealth(): Promise<DbHealth> {
  if (!isDbConfigured()) return { configured: false, reachable: false };
  const result = await query<{
    postgis: string;
    project_count: string;
    feature_count: string;
  }>(`
    SELECT
      postgis_lib_version() AS postgis,
      (SELECT count(*) FROM twin.construction_projects) AS project_count,
      (SELECT count(*) FROM twin.construction_features) AS feature_count
  `);
  if (!result.ok) {
    return { configured: true, reachable: false, error: result.message };
  }
  const row = result.data[0];
  return {
    configured: true,
    reachable: true,
    postgisVersion: row?.postgis,
    projectCount: row ? Number(row.project_count) : undefined,
    featureCount: row ? Number(row.feature_count) : undefined,
  };
}
