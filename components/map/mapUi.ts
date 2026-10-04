/**
 * components/map 内で共有する表示ロジック（状態ラベル・色・日付書式）。
 *
 * デザインの正は `WebUI/koji-mieru-map-3d.html`:
 *   - `.pill` のクラス対応（active / planned / done）
 *   - `fmtDate()` = `YYYY/MM/DD`
 * 色は `lib/viewer/mapStyle.ts` の `MAP_COLORS`（globals.css のトークン由来）を使う。
 */
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/lib/schemas/project";
import { MAP_COLORS } from "@/lib/viewer/mapStyle";

/** 一覧の並び順（プロトタイプの STATUS_GROUPS と同じ） */
export const STATUS_GROUP_ORDER: readonly ProjectStatus[] = [
  "under_construction",
  "planned",
  "completed",
  "suspended",
];

/** 施工状態 → グローバル `.pill` のクラス */
export function statusPillClass(status: ProjectStatus): string {
  switch (status) {
    case "under_construction":
      return "pill active";
    case "planned":
      return "pill planned";
    case "completed":
      return "pill done";
    default:
      return "pill cat";
  }
}

export function statusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_LABEL[status];
}

/** グループ見出しの色ドット（`.grp-head .gd`） */
export function statusGroupColor(status: ProjectStatus): string {
  switch (status) {
    case "under_construction":
      return MAP_COLORS.statusActive;
    case "planned":
      return MAP_COLORS.statusPlanned;
    case "completed":
      return MAP_COLORS.statusDone;
    default:
      return MAP_COLORS.statusHold;
  }
}

/**
 * `YYYY-MM-DD` / ISO 日時 → `YYYY/MM/DD`。
 * `toLocaleDateString` はサーバーとブラウザで結果が変わり得るため使わない
 * （hydration mismatch を避ける）。
 */
export function formatIsoDate(value: string): string {
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return value;
  return `${year}/${month}/${day}`;
}

/** 工期の表示（例: `2027/01/10 〜 2027/03/31`） */
export function formatPeriod(startDate: string, endDate: string): string {
  return `${formatIsoDate(startDate)} 〜 ${formatIsoDate(endDate)}`;
}
