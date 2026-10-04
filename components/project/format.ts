/**
 * 工事詳細 UI の日付・日時整形（日本語表示）。
 *
 * - `YYYY-MM-DD` のみの値はローカル 0 時として解釈する。
 *   タイムゾーンによって「前日」にずれるのを避けるため、UTC 解釈の
 *   `new Date("2026-04-01")` は使わない。
 * - オフセット付きの日時（lastUpdatedAt / verifiedAt）は端末のローカル時刻で表示する。
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` はローカル日付、それ以外は Date の標準解釈。 */
export function parseDateValue(value: string): Date {
  const m = DATE_ONLY.exec(value);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
}

function pad2(n: number): number | string {
  return n < 10 ? `0${n}` : n;
}

/** 例: 2026年4月1日 */
export function formatDate(value: string): string {
  const d = parseDateValue(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 例: 2026年10月4日 07:00 */
export function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** タイムライン軸用。例: 2026/04 */
export function formatMonthTick(date: Date): string {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}`;
}

/** 連番表示（現場ビューアの 01 / 24 など）。 */
export function pad2String(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
