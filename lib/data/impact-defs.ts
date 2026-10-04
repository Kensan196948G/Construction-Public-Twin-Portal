/**
 * 影響イベントの原表を組み立てる純粋関数。
 *
 * projects.ts と impacts.ts の双方から参照されるため、
 * 循環 import を避けて独立モジュールに切り出している。
 */
import { CURATED_IMPACTS, SITE_DEFS, SITE_TMPL, type RawImpact } from "./source";

/**
 * プロトタイプ表記（日本語）の工種を、仕様書 #9 の英語キーへ対応付ける。
 * 表示用の日本語ラベルは IMPACT_TYPE_LABEL 側で保持する。
 */
export const RAW_TYPE_TO_ENUM: Record<string, string> = {
  車線規制: "lane_closure",
  片側交互通行: "lane_closure",
  通行止め: "road_closure",
  歩道切替: "sidewalk_switch",
  迂回路: "detour",
  夜間作業: "night_work",
  騒音: "noise",
  振動: "vibration",
  車両搬入規制: "access_restriction",
  事前周知: "advance_notice",
  完了: "completion",
};

/** 追加案件に付随する影響イベントを生成する（プロトタイプの makeSites 後半を移植） */
function buildGeneratedImpacts(): RawImpact[] {
  const out: RawImpact[] = [];

  for (const def of SITE_DEFS) {
    const t = SITE_TMPL[def.siteType];
    if (!t) throw new Error(`未知の siteType: ${def.siteType}`);
    const isArch = def.siteType.startsWith("arch");
    const shortTitle = def.publicTitle.replace("工事", "");

    out.push({
      id: `${def.id}-reg`,
      projectId: def.id,
      type: t.impType,
      severity: t.sev,
      title: `${t.impType}（${shortTitle}）`,
      desc: `${def.name}に伴い、${t.impType}を実施します。現地の誘導・標識に従ってください。`,
      from: def.start,
      to: def.end,
      rec: isArch ? "平日 8:00〜18:00" : "終日",
      geom: isArch ? "pedestrian" : "regulation",
    });

    if (t.completion === "tower" || t.completion === "road") {
      out.push({
        id: `${def.id}-night`,
        projectId: def.id,
        type: "夜間作業",
        severity: "warning",
        title: `夜間作業の実施（${shortTitle}）`,
        desc: "交通量の少ない夜間に、搬入・舗装などの作業を行います。",
        from: def.start,
        to: def.end,
        rec: "原則 平日 22:00〜翌5:00",
        geom: null,
      });
    }
  }

  return out;
}

export const RAW_IMPACTS: RawImpact[] = [...CURATED_IMPACTS, ...buildGeneratedImpacts()];

/** projectId → impact id 配列 */
export function impactIdsByProject(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const raw of RAW_IMPACTS) {
    const list = map.get(raw.projectId);
    if (list) list.push(raw.id);
    else map.set(raw.projectId, [raw.id]);
  }
  return map;
}
