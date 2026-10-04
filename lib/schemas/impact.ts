/**
 * 工事みえるマップ 3D Beta — 影響イベント (Impact) スキーマ
 *
 * 仕様書 #9 のとおり、交通規制等は Project とは別エンティティとして扱う。
 * 「いつ・どこで・何が発生するか」を持つ。
 */
import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema, httpUrlSchema, sourceSchema } from "./project";

/* ------------------------------------------------------------------ *
 * 列挙
 * ------------------------------------------------------------------ */

/** 仕様書 #9 の type 例に準拠 */
export const IMPACT_TYPES = [
  "lane_closure",
  "road_closure",
  "sidewalk_switch",
  "detour",
  "night_work",
  "noise",
  "vibration",
  "access_restriction",
  "advance_notice",
  "completion",
] as const;
export type ImpactType = (typeof IMPACT_TYPES)[number];

/** 画面表示用の日本語ラベル（プロトタイプの実文言を保持） */
export const IMPACT_TYPE_LABEL: Record<ImpactType, string> = {
  lane_closure: "車線規制",
  road_closure: "通行止め",
  sidewalk_switch: "歩道切替",
  detour: "迂回路",
  night_work: "夜間作業",
  noise: "騒音",
  vibration: "振動",
  access_restriction: "車両搬入規制",
  advance_notice: "事前周知",
  completion: "完了",
};

export const IMPACT_SEVERITIES = ["info", "notice", "warning"] as const;
export type ImpactSeverity = (typeof IMPACT_SEVERITIES)[number];

export const IMPACT_SEVERITY_LABEL: Record<ImpactSeverity, string> = {
  info: "参考",
  notice: "注意",
  warning: "重要",
};

/** 3D/2D 上でどのジオメトリ層として描画するか */
export const IMPACT_GEOMETRIES = ["regulation", "detour", "pedestrian"] as const;
export type ImpactGeometryKind = (typeof IMPACT_GEOMETRIES)[number];

/* ------------------------------------------------------------------ *
 * Impact
 * ------------------------------------------------------------------ */

export const impactSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    type: z.enum(IMPACT_TYPES),
    severity: z.enum(IMPACT_SEVERITIES),
    title: z.string().min(1),
    description: z.string().min(1),

    /** 規制・影響の発生期間 */
    activeFrom: isoDateSchema,
    activeTo: isoDateSchema,
    /** 繰り返し条件（例: 「平日 21:00〜翌5:00」「終日」） */
    recurrence: z.string().min(1),

    /** GeoJSON の取得先 */
    geometryUrl: z.string().min(1).optional(),
    /** この Impact が描画に使う工区内ジオメトリの種別 */
    geometryKind: z.enum(IMPACT_GEOMETRIES).nullable(),
    /** 迂回路 GeoJSON の取得先 */
    detourUrl: z.string().min(1).optional(),

    source: sourceSchema,
  })
  .refine((i) => Date.parse(i.activeTo) >= Date.parse(i.activeFrom), {
    message: "終了日は開始日以降である必要があります",
    path: ["activeTo"],
  });

export type Impact = z.infer<typeof impactSchema>;

export const impactQuerySchema = z.object({
  projectId: z.string().optional(),
  type: z.string().optional(),
  at: z.string().optional(),
  activeAt: z.string().optional(),
  severity: z.string().optional(),
});

export type ImpactQuery = z.infer<typeof impactQuerySchema>;

/* ------------------------------------------------------------------ *
 * 時間判定
 * ------------------------------------------------------------------ */

/**
 * 指定日時に有効な Impact かどうか。
 * 仕様書 #12: `activeFrom <= viewTime <= activeTo`
 * 日付のみの値はその日の終端まで有効として扱う。
 */
export function isImpactActiveAt(impact: Impact, viewTime: Date): boolean {
  const t = viewTime.getTime();
  const from = startOfDay(impact.activeFrom);
  const to = endOfDay(impact.activeTo);
  return t >= from && t <= to;
}

function startOfDay(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(iso: string): number {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** 施工状態の表示に使う派生情報 */
export function impactIsUpcoming(impact: Impact, viewTime: Date): boolean {
  return viewTime.getTime() < startOfDay(impact.activeFrom);
}

export function impactIsPast(impact: Impact, viewTime: Date): boolean {
  return viewTime.getTime() > endOfDay(impact.activeTo);
}

/* ------------------------------------------------------------------ *
 * 出典の既定値
 * ------------------------------------------------------------------ */

export const DEFAULT_VERIFIED_AT = "2026-10-04T07:00:00+09:00";
export const impactSourceSchema = sourceSchema;
export { isoDateTimeSchema, httpUrlSchema };
