/**
 * 一時検証用スクリプト（components/project/ 内・検証後に削除する）。
 * 実際の ProjectDetailCard / SiteViewer を SSR レンダリングし、必須要件の文言・
 * クレジット・viewTime による active/inactive の切替を機械的に確認する。
 *
 * 注意: SSR の useSyncExternalStore は zustand の getInitialState() を読むため、
 * 初期状態オブジェクトを直接書き換えてスナップショットを作る。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { impactsForProject } from "../../../lib/data/impacts.ts";
import { publicProjects } from "../../../lib/data/projects.ts";
import { useAppStore, type AppState } from "../../../lib/store/useAppStore.ts";
import { ImpactPanel } from "../ImpactPanel.tsx";
import { ProjectDetailCard } from "../ProjectDetailCard.tsx";
import { SiteViewer } from "../SiteViewer.tsx";

const initial = useAppStore.getInitialState();
const snapshot = (patch: Partial<AppState>) => Object.assign(initial, patch);

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "OK " : "NG "} ${name}${extra ? ` — ${extra}` : ""}`);
}

function render(projectId: string): string {
  return renderToStaticMarkup(createElement(ProjectDetailCard, { projectId }));
}

const count = (s: string, needle: string) => s.split(needle).length - 1;
const ID = "tokyo-demo-002";
const SLUG = "denenchofu-station-plaza";
const ALL = publicProjects();
const INDEX = ALL.findIndex((p) => p.id === ID);

/* ------------------------------------------------------------------ *
 * 1. 未発見 → null（空文字）
 * ------------------------------------------------------------------ */
snapshot({ selectedProjectId: ID, viewTime: "2026-10-04T12:00:00+09:00" });
check("未発見の projectId は null を返す", render("no-such-project") === "");
check("空文字の projectId も null", render("") === "");

/* ------------------------------------------------------------------ *
 * 2. 詳細カードの必須項目（既定 viewTime = 2026-10-04）
 * ------------------------------------------------------------------ */
snapshot({
  viewTime: "2026-10-04T12:00:00+09:00",
  completionMode: "current",
  selectedImpactId: null,
  siteViewerOpen: false,
});
const html = render(ID);
const slugHtml = render(SLUG);
check("id でも slug でも同じ案件を解決する", html === slugHtml);

const required: [string, string][] = [
  ["住民向け名称(publicTitle)", "駅前広場を歩行者中心に整える工事"],
  ["正式工事件名(name)", "田園調布駅前広場整備工事"],
  ["工事目的(purpose)", "バリアフリー動線を確保します"],
  ["整備効果(benefits)", "緑陰・ベンチ・案内サインの整備"],
  ["発注者(owner)", "大田区 建設部 まちづくり課"],
  ["施工者(contractor)", "田園調布建設株式会社"],
  ["工期(start)", "2026年4月1日"],
  ["工期(end)", "2027年3月31日"],
  ["現在状態", "施工中"],
  ["現在工程(phase)", "広場舗装・植栽工事"],
  ["所在地(postalCode)", "145-0071"],
  ["所在地(address)", "東京都 大田区 田園調布本町 1-1-1"],
  ["最終更新(lastUpdatedAt)", "2026年10月4日 07:00"],
  ["情報提供元(provider)", "情報提供元"],
  ["公式URL(officialUrl)", "https://www.city.ota.tokyo.jp/"],
  ["公式リンク target/rel", 'target="_blank" rel="noopener noreferrer"'],
  ["確認日時(verifiedAt)", "確認日時"],
  ["免責(disclaimer)", "開発用サンプルデータ"],
  ["免責(サンプル明記)", "デモ用サンプル"],
  ["工区(自治体)", "大田区"],
  ["工区(座標)", "35.59300, 139.66800"],
  ["完成予想の切替ラベル", "完成予想"],
  ["完成予想 type ラベル", "駅前広場"],
  ["タイムライン見出し", "工事期間"],
  ["影響セクション見出し", "交通規制・影響"],
  ["写真クレジット: 作者", "Sammya Nig Ltd"],
  ["写真クレジット: ライセンス", "CC BY-SA 4.0"],
  [
    "写真クレジット: 原典URL",
    "https://commons.wikimedia.org/wiki/File:Asphalt_paver_working.jpg",
  ],
];
for (const [label, needle] of required) {
  check(`[詳細] ${label}`, html.includes(needle), needle);
}

/* ------------------------------------------------------------------ *
 * 3. viewTime による影響イベントの active / inactive 切替（AC-008）
 * ------------------------------------------------------------------ */
snapshot({ viewTime: "2026-10-04T12:00:00+09:00" });
const at1004 = render(ID);
snapshot({ viewTime: "2026-10-20T12:00:00+09:00" });
const at1020 = render(ID);
snapshot({ viewTime: "2028-01-01T12:00:00+09:00" });
const at2028 = render(ID);

const impCount = impactsForProject(ID).length;
check("対象案件の影響イベントは 3 件", impCount === 3, String(impCount));
check(
  "2026-10-04: 期間外 2 件が inactive",
  count(at1004, "inactive") === 2,
  `inactive=${count(at1004, "inactive")}`,
);
check(
  "2026-10-20: すべて期間中（inactive 0）",
  count(at1020, "inactive") === 0,
  `inactive=${count(at1020, "inactive")}`,
);
check(
  "2026-10-04 は『実施予定』がある / 2026-10-20 は『実施予定』が消える",
  at1004.includes("実施予定") && !at1020.includes("実施予定") && at1020.includes("期間中"),
);
check(
  "全期間終了後は 3 件すべて inactive",
  count(at2028, "inactive") === 3,
  `inactive=${count(at2028, "inactive")}`,
);
check("全期間終了後は『終了』表示", at2028.includes("終了"));
check("2026-10-04 に規制中バッジが出る", at1004.includes("規制中"));

/* ------------------------------------------------------------------ *
 * 4. 影響ゼロ → 空メッセージ（props 直接）
 * ------------------------------------------------------------------ */
const emptyHtml = renderToStaticMarkup(
  createElement(ImpactPanel, {
    impacts: [],
    viewTime: "2026-10-04T12:00:00+09:00",
    selectedImpactId: null,
    onSelectImpact: () => {},
  }),
);
check(
  "影響 0 件で『現在、交通規制の情報はありません』",
  emptyHtml.includes("現在、交通規制の情報はありません"),
  emptyHtml,
);

/* ------------------------------------------------------------------ *
 * 5. 影響イベント選択のハイライト
 * ------------------------------------------------------------------ */
snapshot({ viewTime: "2026-10-04T12:00:00+09:00" });
const firstImpact = impactsForProject(ID)[0];
snapshot({ selectedImpactId: firstImpact.id });
const selectedHtml = render(ID);
check("選択した影響イベントが impSelected になる", selectedHtml.includes("impSelected"));
check("aria-pressed が true になる", selectedHtml.includes('aria-pressed="true"'));
snapshot({ selectedImpactId: null });

/* ------------------------------------------------------------------ *
 * 6. 全公開案件が例外なく描画でき、写真クレジットが必ず出る
 * ------------------------------------------------------------------ */
let rendered = 0;
const problems: string[] = [];
for (const p of ALL) {
  try {
    const h = render(p.id);
    rendered += 1;
    const credit = p.visual.thumbnailCredit;
    if (!h.includes(p.publicTitle)) problems.push(`${p.id}: publicTitle なし`);
    if (!h.includes(p.schedule.phase)) problems.push(`${p.id}: phase なし`);
    if (!h.includes("確認日時")) problems.push(`${p.id}: 確認日時なし`);
    if (credit) {
      if (!h.includes(credit.author)) problems.push(`${p.id}: credit.author なし`);
      if (!h.includes(credit.license)) problems.push(`${p.id}: credit.license なし`);
      if (!h.includes(credit.url)) problems.push(`${p.id}: credit.url なし`);
    } else {
      problems.push(`${p.id}: クレジット情報なし`);
    }
  } catch (error) {
    problems.push(`${p.id}: 例外 ${String(error)}`);
  }
}
check(
  `全 ${ALL.length} 件の公開案件が描画できる`,
  rendered === ALL.length && problems.length === 0,
  problems.slice(0, 5).join(" / "),
);

/* ------------------------------------------------------------------ *
 * 7. SiteViewer
 * ------------------------------------------------------------------ */
snapshot({ siteViewerOpen: false });
check("SiteViewer は閉じていると null", renderToStaticMarkup(createElement(SiteViewer)) === "");

snapshot({
  siteViewerOpen: true,
  siteViewerIndex: INDEX,
  selectedProjectId: ID,
  viewTime: "2026-10-04T12:00:00+09:00",
});
const svHtml = renderToStaticMarkup(createElement(SiteViewer));

const svRequired: [string, string][] = [
  ["見出し", "現場ビューア"],
  ["写真 src", "/images/sample-cu1.jpg"],
  ["クレジット作者", "Sammya Nig Ltd"],
  ["クレジットライセンス", "CC BY-SA 4.0"],
  ["クレジット原典URL", "commons.wikimedia.org"],
  ["正式名称", "田園調布駅前広場整備工事"],
  ["前へボタン", 'aria-label="前の現場"'],
  ["次へボタン", 'aria-label="次の現場"'],
  ["閉じるボタン", 'aria-label="閉じる"'],
  ["所在地", "東京都 大田区 田園調布本町 1-1-1"],
  ["発注者", "大田区 建設部 まちづくり課"],
  ["最終更新", "2026年10月4日 07:00"],
];
for (const [label, needle] of svRequired) {
  check(`[現場ビューア] ${label}`, svHtml.includes(needle), needle);
}
check(
  `[現場ビューア] 一覧は全 ${ALL.length} 件`,
  count(svHtml, "svItem") >= ALL.length,
  `svItem≈${count(svHtml, "svItem")}`,
);

snapshot({ siteViewerOpen: false });
check("closeSiteViewer で null に戻る", renderToStaticMarkup(createElement(SiteViewer)) === "");

console.log(`\n===== 失敗 ${failures} 件 =====`);
if (failures > 0) process.exitCode = 1;
