/**
 * GET /api/search
 *
 * 契約: docs/CONTRACTS.md §3.2
 *   { query, count, suggestions: SearchSuggestion[] }
 *
 * 母集団は `publicProjects()`。空クエリは 400 ではなく「候補ゼロ」を返す
 * （入力途中の UI から毎回呼ばれるため）。
 */
import { searchSuggestions } from "@/lib/data/filter";
import { publicProjects } from "@/lib/data/projects";
import { badRequest, ok, queryObject, zodErrorMessage } from "@/app/api/_lib/http";
import { searchQuerySchema } from "@/app/api/_lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 8;

export async function GET(request: Request): Promise<Response> {
  const parsed = searchQuerySchema.safeParse(queryObject(request));
  if (!parsed.success) {
    return badRequest(`クエリが不正です: ${zodErrorMessage(parsed.error)}`);
  }

  const query = (parsed.data.q ?? "").trim();
  const suggestions = query ? searchSuggestions(query, publicProjects(), DEFAULT_LIMIT) : [];

  return ok({
    query,
    count: suggestions.length,
    suggestions,
  });
}
