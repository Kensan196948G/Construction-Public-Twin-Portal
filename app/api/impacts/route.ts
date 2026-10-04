/**
 * GET /api/impacts
 *
 * 契約: docs/CONTRACTS.md §3.2
 *   { count, at, impacts: Impact[] }
 *
 * クエリ: projectId / type / activeAt（別名 `at`）
 *   - activeAt を指定した場合、`isImpactActiveAt()` で有効なものだけに絞る。
 *   - `at` は判定に使った基準日時（未指定なら現在時刻）をそのまま返す。
 *
 * 母集団は `publicImpacts()`（= 公開案件に紐づく影響イベントのみ）。
 */
import { isImpactActiveAt } from "@/lib/schemas/impact";
import { impactsForProject, publicImpacts } from "@/lib/data/impacts";
import { badRequest, ok, queryObject, toViewTime, zodErrorMessage } from "@/app/api/_lib/http";
import { impactsQuerySchema } from "@/app/api/_lib/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsed = impactsQuerySchema.safeParse(queryObject(request));
  if (!parsed.success) {
    return badRequest(`クエリが不正です: ${zodErrorMessage(parsed.error)}`);
  }

  const { projectId, type, activeAt, at } = parsed.data;
  const activeAtValue = activeAt ?? at;

  // 公開案件に紐づくものだけを母集団にする
  let impacts = projectId ? impactsForProject(projectId) : publicImpacts();
  if (type) impacts = impacts.filter((impact) => impact.type === type);

  const viewTime = toViewTime(activeAtValue, new Date());
  if (activeAtValue) {
    impacts = impacts.filter((impact) => isImpactActiveAt(impact, viewTime));
  }

  return ok({
    count: impacts.length,
    at: viewTime.toISOString(),
    impacts,
  });
}
