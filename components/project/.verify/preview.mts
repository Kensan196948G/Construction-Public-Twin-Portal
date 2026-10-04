/**
 * 一時検証用: 詳細カード / 現場ビューアを静的 HTML として書き出し、
 * ブラウザで実際のレイアウト（CSS 適用後）を確認するためのスクリプト。
 * CSS Modules のクラス名は検証用スタブによりハッシュ化されないため、
 * project.module.css をそのまま <style> に流し込める。
 * （components/project/ 内の一時ファイル。検証後に削除する）
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { publicProjects } from "../../../lib/data/projects.ts";
import { impactsForProject } from "../../../lib/data/impacts.ts";
import { useAppStore, type AppState } from "../../../lib/store/useAppStore.ts";
import { ProjectDetailCard } from "../ProjectDetailCard.tsx";
import { ProjectTimeline } from "../ProjectTimeline.tsx";
import { SiteViewer } from "../SiteViewer.tsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const globalsCss = readFileSync(path.join(root, "app/globals.css"), "utf8");
const moduleCss = readFileSync(path.join(root, "components/project/project.module.css"), "utf8");

const initial = useAppStore.getInitialState();
const snapshot = (patch: Partial<AppState>) => Object.assign(initial, patch);

const ID = "tokyo-demo-002";
const all = publicProjects();
const index = all.findIndex((p) => p.id === ID);

snapshot({
  selectedProjectId: ID,
  viewTime: "2026-10-04T12:00:00+09:00",
  selectedImpactId: null,
  completionMode: "current",
  siteViewerOpen: false,
});
const detail = renderToStaticMarkup(createElement(ProjectDetailCard, { projectId: ID }));

snapshot({ siteViewerOpen: true, siteViewerIndex: index });
const viewer = renderToStaticMarkup(createElement(SiteViewer));

// 画像は file:// で読めるよう絶対パスへ置換する
const fixImages = (s: string) =>
  s.replaceAll('src="/images/', `src="file://${path.join(root, "public/images")}/`);

function page(title: string, body: string, wrap = ""): string {
  const content = wrap ? wrap.replace("<!--BODY-->", body) : body;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>
<style>
${globalsCss}
${moduleCss}
</style></head>
<body style="overflow:auto;height:auto">${content}</body></html>`;
}

writeFileSync(
  path.join(here, "detail.html"),
  page(
    "detail",
    "<!--BODY-->",
    `<div style="width:396px;height:100vh;overflow:auto;border-right:1px solid #d5d8de;margin:0 auto">${fixImages(detail)}</div>`,
  ),
);

writeFileSync(
  path.join(here, "detail-1020.html"),
  page(
    "detail-1020",
    "<!--BODY-->",
    `<div style="width:396px;height:100vh;overflow:auto;border-right:1px solid #d5d8de;margin:0 auto">${fixImages(
      (() => {
        snapshot({ viewTime: "2026-10-20T12:00:00+09:00" });
        return renderToStaticMarkup(createElement(ProjectDetailCard, { projectId: ID }));
      })(),
    )}</div>`,
  ),
);

writeFileSync(path.join(here, "siteviewer.html"), page("siteviewer", fixImages(viewer)));

/* レイアウト計測用（--dump-dom で読み取る） */
const metricsScript = `<script>
window.addEventListener('load', function () {
  function rect(el) {
    if (!el) return null;
    var b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  function css(el, prop) { return el ? getComputedStyle(el)[prop] : null; }
  var photo = document.querySelector('.photoCard img');
  var out = {
    viewportW: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    card: rect(document.querySelector('article')),
    titleFont: css(document.querySelector('h1'), 'fontSize'),
    photo: rect(photo),
    photoAspectRatio: css(photo, 'aspectRatio'),
    photoObjectFit: css(photo, 'objectFit'),
    tlTrack: rect(document.querySelector('.tlTrack')),
    tlWork: rect(document.querySelector('.tlWork')),
    tlBands: Array.prototype.map.call(document.querySelectorAll('.tlBand'), rect),
    tlNow: rect(document.querySelector('.tlNow')),
    tlAxis: Array.prototype.map.call(document.querySelectorAll('.tlAxis span'), function (e) { return e.textContent; }),
    impacts: Array.prototype.map.call(document.querySelectorAll('.impItem'), function (e) {
      return { title: (e.querySelector('.impTitle') || {}).textContent, opacity: getComputedStyle(e).opacity };
    }),
    segmented: Array.prototype.map.call(document.querySelectorAll('.seg button'), function (e) {
      return { label: e.textContent, active: e.className };
    }),
    svListItems: document.querySelectorAll('.svItem').length,
    svPhoto: rect(document.querySelector('.svPhotoImg img')),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
  };
  var pre = document.createElement('pre');
  pre.id = 'metrics';
  pre.textContent = 'METRICS_JSON:' + JSON.stringify(out);
  document.body.prepend(pre);
});
</script>`;

writeFileSync(
  path.join(here, "metrics.html"),
  page(
    "metrics",
    `${metricsScript}<div style="width:396px;height:100vh;overflow:auto;border-right:1px solid #d5d8de;margin:0 auto">${fixImages(
      (() => {
        snapshot({ viewTime: "2026-10-04T12:00:00+09:00" });
        return renderToStaticMarkup(createElement(ProjectDetailCard, { projectId: ID }));
      })(),
    )}</div>`,
  ),
);

writeFileSync(
  path.join(here, "metrics-sv.html"),
  page("metrics-sv", `${metricsScript}${fixImages(
    (() => {
      snapshot({ siteViewerOpen: true, siteViewerIndex: index });
      return renderToStaticMarkup(createElement(SiteViewer));
    })(),
  )}`),
);

/* タイムライン単体の拡大確認用 */
const project = all.find((p) => p.id === ID)!;
const timelineHtml = renderToStaticMarkup(
  createElement(ProjectTimeline, {
    project,
    impacts: impactsForProject(ID),
    viewTime: "2026-10-04T12:00:00+09:00",
  }),
);
writeFileSync(
  path.join(here, "timeline.html"),
  page(
    "timeline",
    `<div style="width:396px;padding:16px 18px;background:#fff">${timelineHtml}</div>`,
  ),
);

console.log("preview written to", here);
