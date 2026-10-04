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
  isoDateSchema,
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

/* ------------------------------------------------------------------ *
 * 公的ジオコーダー・現場台帳・空間検索
 * ------------------------------------------------------------------ */

/** GET /api/geocode — 住所文字列（空は許容しない。サジェストは /api/search が担う） */
export const geocodeQuerySchema = z.object({
  q: z
    .string()
    .min(1, "住所を指定してください")
    .max(200, "住所は200文字以内で指定してください"),
  limit: z.coerce.number().int().positive().max(20).optional(),
});

export type GeocodeQuery = z.infer<typeof geocodeQuerySchema>;

/** GET /api/ledger — 自社現場台帳の検索 */
export const ledgerQuerySchema = z.object({
  keyword: z.string().max(200).optional(),
  category: z.string().max(50).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  municipality: z.string().max(100).optional(),
  owner: z.string().max(200).optional(),
  contractor: z.string().max(200).optional(),
  workType: z.string().max(100).optional(),
  jv: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === true || v === "true"),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
});

export type LedgerQueryInput = z.infer<typeof ledgerQuerySchema>;

/** 経緯度（空間検索の共通部分） */
const lngLatQuery = {
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
};

/** GET /api/geo/nearby */
export const nearbyQuerySchema = z.object({
  ...lngLatQuery,
  radius: z.coerce.number().positive().max(50_000).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export type NearbyQueryInput = z.infer<typeof nearbyQuerySchema>;

/** GET /api/geo/contains */
export const containsQuerySchema = z.object({
  ...lngLatQuery,
  /** カンマ区切りの feature kind（workzone,regulation,detour,pedestrian） */
  kinds: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export type ContainsQueryInput = z.infer<typeof containsQuerySchema>;
