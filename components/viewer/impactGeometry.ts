/**
 * 影響レイヤー（規制・迂回路・歩道切替）の共通ロジック。
 * 内部ヘルパーであり React コンポーネントではない。
 *
 * - 同一案件・同一ジオメトリ種別に複数の Impact がぶら下がるため、
 *   描画に使う代表 Impact を選ぶ（有効なもの → 重要度が高いもの）。
 * - 時間軸（viewTime）に対して「実施中 / 予告 / 過去」を判定し、
 *   不透明度を変える（要件: 非アクティブな規制は低不透明度）。
 */
import {
  impactIsPast,
  impactIsUpcoming,
  isImpactActiveAt,
  type Impact,
  type ImpactSeverity,
} from "@/lib/schemas/impact";
import { SCENE_COLORS } from "@/lib/viewer/sceneBuilder";

/** 影響レイヤーのジオメトリ種別（Impact.geometryKind と一致） */
export type ImpactGeometryKindName = "regulation" | "detour" | "pedestrian";

/** 線の高さ（地面・工区の上） */
export const IMPACT_LINE_Y = 1.4;

export interface ImpactLineStyle {
  color: number;
  lineWidth: number;
  dashed: boolean;
  dashSize: number;
  gapSize: number;
}

/** レイヤーごとの見た目（凡例 LAYERS.swatch と同じ色を使う） */
export function impactLineStyle(kind: ImpactGeometryKindName): ImpactLineStyle {
  switch (kind) {
    case "regulation":
      return { color: SCENE_COLORS.regulation, lineWidth: 3.2, dashed: false, dashSize: 6, gapSize: 5 };
    case "detour":
      return { color: SCENE_COLORS.detour, lineWidth: 3, dashed: true, dashSize: 9, gapSize: 7 };
    case "pedestrian":
      return { color: SCENE_COLORS.pedestrian, lineWidth: 2.6, dashed: false, dashSize: 6, gapSize: 5 };
  }
}

function severityRank(severity: ImpactSeverity): number {
  if (severity === "warning") return 3;
  if (severity === "notice") return 2;
  return 1;
}

/**
 * 描画に使う代表 Impact。
 * 有効なもの → 将来のもの → 過去のみ、の順に優先し、同条件では重要度で選ぶ。
 */
export function pickRepresentative(
  impacts: readonly Impact[],
  viewTime: Date,
): Impact | null {
  if (impacts.length === 0) return null;
  const active = impacts.filter((i) => isImpactActiveAt(i, viewTime));
  const upcoming = impacts.filter((i) => impactIsUpcoming(i, viewTime));
  const pool = active.length > 0 ? active : upcoming.length > 0 ? upcoming : impacts;
  return [...pool].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0] ?? null;
}

export type ImpactTemporalState = "active" | "upcoming" | "past";

export function impactTemporalState(impact: Impact, viewTime: Date): ImpactTemporalState {
  if (isImpactActiveAt(impact, viewTime)) return "active";
  if (impactIsUpcoming(impact, viewTime)) return "upcoming";
  if (impactIsPast(impact, viewTime)) return "past";
  return "upcoming";
}

/**
 * 不透明度。時間軸から外れた規制は「消す」のではなく薄く残し、
 * 空間的な文脈（どこで規制が行われたか）を失わせない。
 */
export function impactOpacity(
  state: ImpactTemporalState,
  selected: boolean,
): number {
  if (selected) return 1;
  if (state === "active") return 0.95;
  if (state === "upcoming") return 0.3;
  return 0.14;
}
