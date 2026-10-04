/**
 * GET /api/projects/[id]
 *
 * 契約: docs/CONTRACTS.md §3.2
 *   { project, geometry: FeatureCollection(工区), impacts: Impact[] }
 *   未発見は 404 { error }
 *
 * `id` は案件 id でも slug でもよい（getProjectById → getProjectBySlug の順で解決）。
 * どちらのアクセサも `publicProjects()` 経由のため、非公開案件は解決できない。
 */
import { buildProjectCollection } from "@/lib/data/geometry";
import { impactsForProject } from "@/lib/data/impacts";
import { getProjectById, getProjectBySlug } from "@/lib/data/projects";
import { notFound, ok } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Next.js 16 の Route Handler では params が Promise になった。
  const { id } = await params;

  const project = getProjectById(id) ?? getProjectBySlug(id);
  if (!project) {
    return notFound(`工事が見つかりません: ${id}`);
  }

  return ok({
    project,
    // 工区（Polygon）の FeatureCollection。クライアントはそのまま地図・3D に載せられる。
    geometry: buildProjectCollection(project.slug, ["workzone"]),
    impacts: impactsForProject(project.id),
  });
}
