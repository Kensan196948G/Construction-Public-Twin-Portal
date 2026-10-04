/**
 * Route Handler 共通のレスポンスヘルパ（apidata 担当）。
 *
 * 契約: docs/CONTRACTS.md §3.2
 *   - 正常系は各エンドポイント固有の JSON 形。
 *   - 異常系は必ず `{ "error": string }` と適切な HTTP ステータス。
 *
 * `_lib` は App Router の private folder（先頭 `_`）なのでルーティング対象にならない。
 */

/** 200 OK の JSON レスポンス */
export function ok<T>(body: T): Response {
  return Response.json(body, { status: 200 });
}

/** 400 Bad Request（不正なクエリ） */
export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/** 404 Not Found */
export function notFound(message: string): Response {
  return Response.json({ error: message }, { status: 404 });
}

/** クエリ文字列を flat な object にする（同名キーは最後の値） */
export function queryObject(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

/** Zod の検証エラーを、そのまま `{ error }` に載せられる 1 行へ整形する */
export interface ZodIssueLike {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

export function zodErrorMessage(error: { issues: ReadonlyArray<ZodIssueLike> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((part) => String(part)).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join(" / ");
}

/** 日時・日付として解釈できない値を弾いたうえで Date を作る */
export function toViewTime(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
