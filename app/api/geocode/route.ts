/**
 * GET /api/geocode
 *
 * 公的ジオコーダー（国土地理院 住所検索API）で住所文字列を緯度経度へ変換する。
 *
 *   応答: { query, normalizedQuery, count, candidates[], filteredOut, attribution, source }
 *
 * 設計:
 *   ジオコーダーへは到達できないことがある（外部サービス）。その場合も 200 で
 *   `error` に日本語の説明を入れて返し、画面を壊さない（REQ-NF-005）。
 *   入力不正のみ 400。
 */
import { geocodeAddress } from "@/lib/geo/gsi";
import { badRequest, ok, queryObject, zodErrorMessage } from "@/app/api/_lib/http";
import { geocodeQuerySchema } from "@/app/api/_lib/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsed = geocodeQuerySchema.safeParse(queryObject(request));
  if (!parsed.success) {
    return badRequest(`クエリが不正です: ${zodErrorMessage(parsed.error)}`);
  }

  const outcome = await geocodeAddress(parsed.data.q, parsed.data.limit ?? 6);
  return ok(outcome);
}
