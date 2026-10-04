/**
 * GET /api/ledger
 *
 * 自社現場台帳の検索。現場ID・工事件名・発注番号・発注者・元請・JV・工種・工期で絞り込む。
 *
 *   Query: keyword category status municipality owner contractor workType
 *          jv from to limit offset
 *   応答:  { count, total, offset, limit, source, sourceLabel, notice?, note,
 *            entries: SiteLedgerEntry[], facets }
 *
 * PostGIS（twin.construction_projects）を優先し、未構成・到達不能の場合は
 * 静的データ（public/data）で同じ検索意味を提供する。
 */
import {
  queryLedger,
  queryLedgerFacets,
  type LedgerQuery,
  type LedgerQueryResult,
} from "@/lib/db/queries";
import { searchStaticLedger, staticLedgerFacets } from "@/lib/data/ledger";
import { LEDGER_SAMPLE_NOTE } from "@/lib/schemas/ledger";
import { badRequest, ok, queryObject, zodErrorMessage } from "@/app/api/_lib/http";
import { ledgerQuerySchema } from "@/app/api/_lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;

export async function GET(request: Request): Promise<Response> {
  const parsed = ledgerQuerySchema.safeParse(queryObject(request));
  if (!parsed.success) {
    return badRequest(`クエリが不正です: ${zodErrorMessage(parsed.error)}`);
  }

  const input = parsed.data;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = input.offset ?? 0;

  const query: LedgerQuery = {
    keyword: input.keyword?.trim() || undefined,
    category: input.category,
    status: input.status,
    municipality: input.municipality,
    owner: input.owner,
    contractor: input.contractor,
    workType: input.workType,
    jvOnly: input.jv,
    from: input.from,
    to: input.to,
    limit,
    offset,
  };

  const dbResult = await queryLedger(query);
  const usingDb = dbResult.ok;
  const result: LedgerQueryResult = dbResult.ok ? dbResult.data : searchStaticLedger(query);

  // ファセット（フィルタ候補）は本文と独立に取得する。失敗しても致命的ではない。
  const dbFacets = usingDb ? await queryLedgerFacets() : null;
  const facets = dbFacets?.ok ? dbFacets.data : staticLedgerFacets();

  return ok({
    count: result.entries.length,
    total: result.total,
    offset,
    limit,
    source: usingDb ? "postgis" : "static",
    sourceLabel: usingDb ? "PostGIS (construction_twin)" : "静的データ（public/data）",
    notice: usingDb ? undefined : dbResult.message,
    note: LEDGER_SAMPLE_NOTE,
    entries: result.entries,
    facets,
  });
}
