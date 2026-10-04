/**
 * GET /api/projects
 *
 * 契約: docs/CONTRACTS.md §3.2
 *   { count, total, at, projects: ProjectSummary[] }
 *
 * - `count` … この応答に含まれる件数（limit 適用後）
 * - `total` … フィルタ条件に一致する全件数（limit 適用前）
 * - `at`    … 判定に使った基準日時（`at` クエリ。未指定なら現在時刻）
 *
 * 公開状態が published 以外の案件は `publicProjects()` の時点で除外される。
 */
import { filterProjects } from "@/lib/data/filter";
import { publicProjects, toSummary } from "@/lib/data/projects";
import { badRequest, ok, queryObject, toViewTime, zodErrorMessage } from "@/app/api/_lib/http";
import { projectsQuerySchema } from "@/app/api/_lib/schemas";

/** ビルド時に固定化させない（データ更新を即時反映する） */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsed = projectsQuerySchema.safeParse(queryObject(request));
  if (!parsed.success) {
    return badRequest(`クエリが不正です: ${zodErrorMessage(parsed.error)}`);
  }

  const { keyword, category, status, municipality, regulating, from, to, at, limit } = parsed.data;

  // 公開案件のみを母集団にする（非公開・下書き・公開停止はここで落ちる）
  const all = publicProjects();
  const viewTime = toViewTime(at, new Date());

  const filtered = filterProjects(all, {
    keyword: keyword?.trim() ? keyword.trim() : undefined,
    category: category ?? null,
    status: status ?? null,
    municipality: municipality?.trim() ? municipality.trim() : undefined,
    regulatingOnly: regulating === true,
    viewTime,
    from,
    to,
  });

  const page = typeof limit === "number" ? filtered.slice(0, limit) : filtered;

  return ok({
    count: page.length,
    total: filtered.length,
    at: viewTime.toISOString(),
    projects: page.map(toSummary),
  });
}
