/**
 * Time Test — 時間条件（apidata 担当）。
 *
 * 仕様書 #12 / AC-008: `activeFrom <= viewTime <= activeTo` で表示を切り替える。
 * 日付のみの値は「その日の終端まで有効」として扱う。
 */
import { describe, expect, it } from "vitest";
import {
  impactIsPast,
  impactIsUpcoming,
  isImpactActiveAt,
} from "@/lib/schemas/impact";
import { impactsActiveAt, publicImpacts } from "@/lib/data/impacts";
import { validImpact } from "./fixtures/project";

/** ローカル時刻で Date を作る（isImpactActiveAt の startOfDay/endOfDay と揃える） */
function local(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(y, m - 1, d, h, min, s);
}

describe("isImpactActiveAt", () => {
  // activeFrom: 2026-06-01 / activeTo: 2026-06-30
  const impact = validImpact();

  it("期間内は true", () => {
    expect(isImpactActiveAt(impact, local(2026, 6, 1, 0, 0, 0))).toBe(true);
    expect(isImpactActiveAt(impact, local(2026, 6, 15, 12, 0, 0))).toBe(true);
    expect(isImpactActiveAt(impact, local(2026, 6, 30, 23, 59, 59))).toBe(true);
  });

  it("期間外は false（開始前日・終了翌日）", () => {
    expect(isImpactActiveAt(impact, local(2026, 5, 31, 23, 59, 59))).toBe(false);
    expect(isImpactActiveAt(impact, local(2026, 7, 1, 0, 0, 0))).toBe(false);
    expect(isImpactActiveAt(impact, local(2025, 6, 1))).toBe(false);
  });

  it("単日開催（activeFrom === activeTo）はその日だけ true", () => {
    const oneDay = { ...impact, activeFrom: "2026-06-10", activeTo: "2026-06-10" };
    expect(isImpactActiveAt(oneDay, local(2026, 6, 10, 0, 0, 0))).toBe(true);
    expect(isImpactActiveAt(oneDay, local(2026, 6, 10, 23, 59, 59))).toBe(true);
    expect(isImpactActiveAt(oneDay, local(2026, 6, 9, 23, 59, 59))).toBe(false);
    expect(isImpactActiveAt(oneDay, local(2026, 6, 11, 0, 0, 0))).toBe(false);
  });

  it("upcoming / past の判定が補集合になっている", () => {
    const before = local(2026, 5, 1);
    const during = local(2026, 6, 15);
    const after = local(2026, 7, 15);

    expect(impactIsUpcoming(impact, before)).toBe(true);
    expect(impactIsPast(impact, before)).toBe(false);
    expect(impactIsUpcoming(impact, during)).toBe(false);
    expect(impactIsPast(impact, during)).toBe(false);
    expect(impactIsUpcoming(impact, after)).toBe(false);
    expect(impactIsPast(impact, after)).toBe(true);

    for (const time of [before, during, after]) {
      const active = isImpactActiveAt(impact, time);
      expect(active).toBe(!impactIsUpcoming(impact, time) && !impactIsPast(impact, time));
    }
  });
});

describe("impactsActiveAt（実データ）", () => {
  const VIEW_TIME = new Date("2026-10-15T12:00:00+09:00");

  it("指定日時に有効な Impact だけを返す", () => {
    const active = impactsActiveAt(VIEW_TIME);
    const expected = publicImpacts().filter((i) => isImpactActiveAt(i, VIEW_TIME));
    expect(active.map((i) => i.id)).toEqual(expected.map((i) => i.id));
    expect(active.length).toBeGreaterThan(0);
    expect(active.length).toBeLessThan(publicImpacts().length);
  });

  it("projectId を指定するとその案件だけに絞られる", () => {
    const all = impactsActiveAt(VIEW_TIME);
    const projectId = all[0].projectId;
    const scoped = impactsActiveAt(VIEW_TIME, projectId);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((i) => i.projectId === projectId)).toBe(true);
  });

  it("全規制開始前（2025-01-01）は有効な Impact が無い", () => {
    expect(impactsActiveAt(new Date("2025-01-01T00:00:00+09:00"))).toEqual([]);
  });
});
