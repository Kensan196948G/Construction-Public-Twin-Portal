/**
 * Schema Test — Project / Impact の Zod スキーマ検証（apidata 担当）。
 *
 * 要件: 正常データが parse でき、必須項目欠落・不正日付・終了日<開始日 を検出する。
 */
import { describe, expect, it } from "vitest";
import { impactSchema } from "@/lib/schemas/impact";
import { isoDateSchema, projectSchema } from "@/lib/schemas/project";
import { impactCandidate, projectCandidate, validImpact, validProject } from "./fixtures/project";

type Obj = Record<string, unknown>;

function omit(base: Obj, key: string): Obj {
  const copy = { ...base };
  delete copy[key];
  return copy;
}

function withNested(base: Obj, key: string, patch: Obj): Obj {
  return { ...base, [key]: { ...(base[key] as Obj), ...patch } };
}

describe("projectSchema", () => {
  it("正常な Project を parse できる", () => {
    const project = validProject();
    expect(project.id).toBe("test-project-0001");
    expect(project.schedule.startDate).toBe("2026-04-01");
    expect(project.visibility.publicationState).toBe("published");
    expect(projectSchema.safeParse(projectCandidate()).success).toBe(true);
  });

  it("必須項目（name / purpose / disclaimer）の欠落を検出する", () => {
    for (const key of ["name", "publicTitle", "purpose", "disclaimer", "slug"]) {
      const result = projectSchema.safeParse(omit(projectCandidate(), key));
      expect(result.success, `${key} 欠落は失敗するはず`).toBe(false);
    }
  });

  it("benefits が空配列なら失敗する", () => {
    const result = projectSchema.safeParse({ ...projectCandidate(), benefits: [] });
    expect(result.success).toBe(false);
  });

  it("不正な日付（存在しない日・形式違い）を検出する", () => {
    for (const bad of ["2026-13-45", "2026/04/01", "令和8年4月1日"]) {
      const result = projectSchema.safeParse(withNested(projectCandidate(), "schedule", { startDate: bad }));
      expect(result.success, `${bad} は失敗するはず`).toBe(false);
    }
  });

  it("完成予定日 < 着工日 を検出する", () => {
    const result = projectSchema.safeParse(
      withNested(projectCandidate(), "schedule", {
        startDate: "2027-03-31",
        plannedEndDate: "2026-04-01",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "schedule.plannedEndDate")).toBe(true);
    }
  });

  it("slug 形式違反を検出する", () => {
    for (const bad of ["Test Project", "テスト", "UPPER", "-leading"]) {
      const result = projectSchema.safeParse({ ...projectCandidate(), slug: bad });
      expect(result.success, `${bad} は失敗するはず`).toBe(false);
    }
  });

  it("公開区分が public 以外の案件は published にできない", () => {
    const result = projectSchema.safeParse(
      withNested(projectCandidate(), "visibility", {
        classification: "internal",
        publicationState: "published",
      }),
    );
    expect(result.success).toBe(false);

    // 非公開区分でも published でなければ valid
    const draft = projectSchema.safeParse(
      withNested(projectCandidate(), "visibility", {
        classification: "internal",
        publicationState: "draft",
      }),
    );
    expect(draft.success).toBe(true);
  });

  it("座標が WGS84 の範囲外なら失敗する", () => {
    const result = projectSchema.safeParse(
      withNested(projectCandidate(), "location", {
        center: { longitude: 200, latitude: 35.593 },
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("impactSchema", () => {
  it("正常な Impact を parse できる", () => {
    const impact = validImpact();
    expect(impact.type).toBe("lane_closure");
    expect(impact.geometryKind).toBe("regulation");
    expect(impactSchema.safeParse(impactCandidate()).success).toBe(true);
  });

  it("必須項目（title / description / recurrence）の欠落を検出する", () => {
    for (const key of ["title", "description", "recurrence", "projectId"]) {
      const result = impactSchema.safeParse(omit(impactCandidate(), key));
      expect(result.success, `${key} 欠落は失敗するはず`).toBe(false);
    }
  });

  it("終了日 < 開始日 を検出する", () => {
    const result = impactSchema.safeParse({
      ...impactCandidate(),
      activeFrom: "2026-06-30",
      activeTo: "2026-06-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "activeTo")).toBe(true);
    }
  });

  it("不正な日付を検出する", () => {
    for (const bad of ["2026-13-45", "2026/06/01", "令和8年6月1日"]) {
      const result = impactSchema.safeParse({ ...impactCandidate(), activeFrom: bad });
      expect(result.success, `${bad} は失敗するはず`).toBe(false);
    }
  });

  it("月末をまたぐ不正日（2026-02-30 / 2026-04-31）を検出する", () => {
    // isoDateSchema は YYYY-MM-DD の正規表現に加えて暦日のラウンドトリップを検証する。
    // Date.parse だけでは 2026-02-30 が 2026-03-02 に繰り上がって通ってしまうため。
    for (const bad of ["2026-02-30", "2026-04-31", "2026-06-31", "2027-02-29"]) {
      expect(isoDateSchema.safeParse(bad).success, `${bad} は失敗するはず`).toBe(false);
    }
    // うるう年の 2/29 は正しく通る
    expect(isoDateSchema.safeParse("2028-02-29").success).toBe(true);

    // Impact スキーマ経由でも弾かれる（期間整合の refinement と独立に検証される）
    expect(
      impactSchema.safeParse({ ...impactCandidate(), activeFrom: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      impactSchema.safeParse({ ...impactCandidate(), activeTo: "2026-04-31" }).success,
    ).toBe(false);
  });

  it("未知の type / severity を検出する", () => {
    expect(impactSchema.safeParse({ ...impactCandidate(), type: "unknown_type" }).success).toBe(false);
    expect(impactSchema.safeParse({ ...impactCandidate(), severity: "critical" }).success).toBe(false);
  });

  it("geometryKind は null を許容する", () => {
    const result = impactSchema.safeParse({ ...impactCandidate(), geometryKind: null });
    expect(result.success).toBe(true);
  });
});
