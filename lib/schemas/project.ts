/**
 * 工事みえるマップ 3D Beta — 工事 (Project) スキーマ
 *
 * 仕様書「工事データ仕様」(#8) / 要件定義書 REQ-D-001〜REQ-D-007 に対応。
 * すべての工事データはこの Zod スキーマで検証する。
 */
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * 基本バリデータ
 * ------------------------------------------------------------------ */

/** http(s) URL。Zod v3/v4 双方で安定するよう refine で実装する。 */
export const httpUrlSchema = z
  .string()
  .refine((v) => /^https?:\/\//i.test(v), { message: "http(s) で始まる URL を指定してください" });

/** YYYY-MM-DD */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください")
  .refine((v) => !Number.isNaN(Date.parse(v)), "実在する日付を指定してください");

/** ISO 8601 日時 (タイムゾーン付きを推奨) */
export const isoDateTimeSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "日時として解釈できる文字列を指定してください");

/** 日付または日時 */
export const dateLikeSchema = z.union([isoDateTimeSchema, isoDateSchema]);

/** WGS84 経緯度 */
export const lngLatSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

/* ------------------------------------------------------------------ *
 * 列挙
 * ------------------------------------------------------------------ */

/** 施工状態 */
export const PROJECT_STATUSES = [
  "planned",
  "under_construction",
  "completed",
  "suspended",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: "着工前",
  under_construction: "施工中",
  completed: "完成・供用中",
  suspended: "一時中止",
};

/** 工種（大分類）。プロトタイプの実データ表記をそのまま保持する。 */
export const PROJECT_CATEGORIES = [
  "道路",
  "広場",
  "下水道",
  "公園",
  "建築・都市部",
  "建築・地方",
  "土木・都市部",
  "土木・地方",
] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

/**
 * 公開状態。仕様書 #14 のとおり `published` 以外は Public API に返してはならない。
 */
export const PUBLICATION_STATES = [
  "draft",
  "review",
  "approved",
  "published",
  "suspended",
  "expired",
] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const PUBLICATION_STATE_LABEL: Record<PublicationState, string> = {
  draft: "下書き",
  review: "公開待ち",
  approved: "承認済",
  published: "公開",
  suspended: "公開停止",
  expired: "再確認期限切れ",
};

/** 情報区分 (REQ-S-001) */
export const CLASSIFICATIONS = ["public", "limited", "internal", "private"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** 現場タイプ。3D背景・写真・完成モデルの生成方針を決める。 */
export const SITE_TYPES = [
  "arch-urban",
  "arch-rural",
  "civil-urban",
  "civil-rural",
] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  "arch-urban": "都市部建設",
  "arch-rural": "地方建設",
  "civil-urban": "都市部土木",
  "civil-rural": "地方土木",
};

/** 完成予想の手続き的モデル種別（GLB が無い MVP 用の代替） */
export const COMPLETION_TYPES = [
  "plaza",
  "sidewalk",
  "utility",
  "park",
  "tower",
  "rural",
  "road",
  "levee",
] as const;
export type CompletionType = (typeof COMPLETION_TYPES)[number];

export const COMPLETION_TYPE_LABEL: Record<CompletionType, string> = {
  plaza: "駅前広場",
  sidewalk: "歩道・バリアフリー",
  utility: "地下管路",
  park: "公園・防災広場",
  tower: "高層建築",
  rural: "低層施設",
  road: "道路改良",
  levee: "河川護岸",
};

/* ------------------------------------------------------------------ *
 * 主体・出典
 * ------------------------------------------------------------------ */

export const organizationSchema = z.object({
  name: z.string().min(1, "名称は必須です"),
});

export const sourceSchema = z.object({
  /** 情報提供元（発注者・自治体など） */
  provider: z.string().min(1),
  /** 公式情報への URL */
  officialUrl: httpUrlSchema,
  /** 情報を確認した日時 */
  verifiedAt: isoDateTimeSchema,
  /** データセット名（外部データの場合） */
  dataset: z.string().optional(),
  /** ライセンス表記 */
  license: z.string().optional(),
});

/* ------------------------------------------------------------------ *
 * Project
 * ------------------------------------------------------------------ */

export const projectSchema = z
  .object({
    id: z.string().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug は小文字英数字とハイフンのみ使用できます"),

    /* --- 分類 --- */
    status: z.enum(PROJECT_STATUSES),
    category: z.enum(PROJECT_CATEGORIES),
    siteType: z.enum(SITE_TYPES),

    /* --- 名称・目的 --- */
    name: z.string().min(1, "正式工事件名は必須です"),
    publicTitle: z.string().min(1, "住民向け名称は必須です"),
    purpose: z.string().min(1, "工事目的は必須です"),
    benefits: z.array(z.string().min(1)).min(1, "整備効果を1件以上指定してください"),

    /* --- 関係者 --- */
    owner: organizationSchema,
    contractor: organizationSchema,

    /* --- 工期 --- */
    schedule: z
      .object({
        startDate: isoDateSchema,
        plannedEndDate: isoDateSchema,
        phase: z.string().min(1, "現在工程は必須です"),
        lastUpdatedAt: isoDateTimeSchema,
      })
      .refine((s) => Date.parse(s.plannedEndDate) >= Date.parse(s.startDate), {
        message: "完成予定日は着工日以降である必要があります",
        path: ["plannedEndDate"],
      }),

    /* --- 位置 --- */
    location: z.object({
      postalCode: z.string().optional(),
      prefecture: z.string().min(1),
      /** 政令市・郡部などの市区町村。該当しない場合は空文字。 */
      city: z.string(),
      /** 東京23区などの行政区。該当しない場合は空文字。 */
      ward: z.string(),
      town: z.string().min(1),
      /** 表示用に連結済みの住所 */
      address: z.string().min(1),
      municipality: z.string().min(1, "自治体名は必須です"),
      center: lngLatSchema,
      /** 工区 GeoJSON の取得先 */
      workZoneGeoJsonUrl: z.string().min(1),
    }),

    /* --- 表示物 --- */
    visual: z.object({
      /** GLB の URL。MVP では未指定が多く、その場合は手続き的モデルを使う。 */
      modelUrl: z.string().optional(),
      thumbnailUrl: z.string().min(1),
      thumbnailCredit: z
        .object({
          author: z.string(),
          license: z.string(),
          url: httpUrlSchema,
        })
        .optional(),
      completionType: z.enum(COMPLETION_TYPES),
      /** 3D 手続き生成のための概略寸法 (m) */
      siteWidthM: z.number().positive(),
      siteDepthM: z.number().positive(),
      floors: z.number().int().min(0),
    }),

    /* --- 関連 --- */
    impacts: z.array(z.string()),

    /* --- 公開管理 --- */
    visibility: z.object({
      classification: z.enum(CLASSIFICATIONS),
      publicationState: z.enum(PUBLICATION_STATES),
      /** 再確認期限 */
      reviewDueAt: isoDateSchema.optional(),
    }),

    /* --- 出典・注意 --- */
    source: sourceSchema,
    disclaimer: z.string().min(1),
  })
  .refine((p) => p.visibility.classification === "public" || p.visibility.publicationState !== "published", {
    message: "公開区分が public 以外の案件は published にできません",
    path: ["visibility", "publicationState"],
  });

export type Project = z.infer<typeof projectSchema>;

/** 一覧表示・API 応答に使う軽量表現 */
export type ProjectSummary = Pick<
  Project,
  "id" | "slug" | "name" | "publicTitle" | "status" | "category" | "siteType"
> & {
  municipality: string;
  address: string;
  center: Project["location"]["center"];
  startDate: string;
  plannedEndDate: string;
  lastUpdatedAt: string;
  thumbnailUrl: string;
  impactCount: number;
};

/* ------------------------------------------------------------------ *
 * 検索クエリ
 * ------------------------------------------------------------------ */

export const projectQuerySchema = z.object({
  keyword: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  municipality: z.string().optional(),
  /** 規制中のみ */
  regulating: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === true || v === "true"),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  at: dateLikeSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export type ProjectQuery = z.infer<typeof projectQuerySchema>;
