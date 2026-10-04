import type { ProjectStatus } from "@/lib/schemas/project";

/**
 * 施工状態 → グローバルな `.pill` の色クラス（app/globals.css）。
 * 契約 §1 の pill.active / pill.planned / pill.done / pill.cat に対応する。
 */
export const STATUS_PILL_CLASS: Record<ProjectStatus, string> = {
  planned: "planned",
  under_construction: "active",
  completed: "done",
  suspended: "cat",
};
