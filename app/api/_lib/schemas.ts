/**
 * API クエリの検証スキーマ（apidata 担当）。
 *
 * 共有基盤の `projectQuerySchema` を基礎にしつつ、
 * `category` / `status` を凍結済み enum に固定して不正値を 400 で弾く。
 */
import { z } from "zod";
import {
  PROJECT_CATEGORIES,
  PROJECT_STATUSES,
  dateLikeSchema,
  projectQuerySchema,
} from "@/lib/schemas/project";
import { IMPACT_TYPES } from "@/lib/schemas/impact";

/** GET /api/projects */
export const projectsQuerySchema = projectQuerySchema.extend({
  category: z.enum(PROJECT_CATEGORIES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});

export type ProjectsQuery = z.infer<typeof projectsQuerySchema>;

/** GET /api/impacts — `activeAt`（契約）と `at`（別名）の双方を受け付ける */
export const impactsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  type: z.enum(IMPACT_TYPES).optional(),
  activeAt: dateLikeSchema.optional(),
  at: dateLikeSchema.optional(),
});

export type ImpactsQuery = z.infer<typeof impactsQuerySchema>;

/** GET /api/search（契約上のクエリは `q` のみ。長すぎる入力だけ 400 で弾く） */
export const searchQuerySchema = z.object({
  q: z.string().max(200, "検索語は200文字以内で指定してください").optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
