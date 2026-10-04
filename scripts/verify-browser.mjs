#!/usr/bin/env node
/**
 * ブラウザ実操作による検証ハーネス（依存ゼロ / Chrome DevTools Protocol 直結）。
 *
 * headless Chrome を起動し、実際にページを読み込み・操作・スクリーンショット取得して
 * 「動作する MVP か」を機械的に判定する。
 *
 *   node scripts/verify-browser.mjs [--url http://127.0.0.1:3000] [--json out.json]
 *
 * 判定項目:
 *   - 主要 UI 要素の存在（トップ / 一覧 / 詳細 / タイムライン / 凡例）
 *   - 検索・フィルタ・工事選択が実際に表示を変えること
 *   - 2D / 3D の切替が動くこと
 *   - レイヤー切替・時間軸操作が動くこと
 *   - Console エラー / 未捕捉例外 / 失敗リクエストが 0 件であること
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE_URL = argValue("--url", process.env.BASE_URL ?? "http://127.0.0.1:3000");
const OUT_DIR = argValue("--outdir", "tmp-verify");
const JSON_OUT = argValue("--json", `${OUT_DIR}/browser-report.json`);
const CDP_PORT = Number(argValue("--port", "9333"));
const CHROME = argValue("--chrome", process.env.CHROME_PATH ?? "/usr/bin/google-chrome");

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass: Boolean(pass), detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ *
 * 最小 CDP クライアント
 * ------------------------------------------------------------------ */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        }
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params);
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 60_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    }
    return r.result.value;
  }
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`CDP endpoint did not become ready: ${url}`);
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

const chromeArgs = [
  "--headless=new",
  `--remote-debugging-port=${CDP_PORT}`,
  "--remote-allow-origins=*",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  // headless でも WebGL をソフトウェアラスタライザで有効化する
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--hide-scrollbars",
  "--window-size=1440,900",
  "--user-data-dir=/tmp/dsh-verify-chrome",
  "about:blank",
];

const chrome = spawn(CHROME, chromeArgs, { stdio: ["ignore", "pipe", "pipe"] });
let chromeStderr = "";
chrome.stderr.on("data", (d) => {
  chromeStderr += d.toString();
});

let exitCode = 0;
const consoleErrors = [];
const consoleWarnings = [];
const pageExceptions = [];
const failedRequests = [];

try {
  await mkdir(OUT_DIR, { recursive: true });

  const version = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  // Chrome は /json/new に PUT を要求するため、起動時に開いた about:blank ターゲットを使う。
  const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("CDP の page ターゲットが見つかりません");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);

  cdp.on("Runtime.consoleAPICalled", (p) => {
    const text = (p.args ?? [])
      .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
      .join(" ");
    if (p.type === "error") consoleErrors.push(text);
    else if (p.type === "warning") consoleWarnings.push(text);
  });
  cdp.on("Runtime.exceptionThrown", (p) => {
    pageExceptions.push(
      p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "unknown",
    );
  });
  cdp.on("Network.loadingFailed", (p) => {
    // 意図的なアボート（ナビゲーション起因）は除外する
    if (p.canceled) return;
    failedRequests.push(`${p.type} ${p.errorText} ${p.requestId}`);
  });
  cdp.on("Log.entryAdded", (p) => {
    const e = p.entry;
    if (e.level === "error") {
      consoleErrors.push(`[${e.source}] ${e.text}${e.url ? ` (${e.url})` : ""}`);
    }
  });

  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");

  /* ---------- helpers ---------- */

  const waitFor = async (expression, timeoutMs = 30_000, label = expression) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await cdp.eval(expression)) return true;
      } catch {
        /* keep polling */
      }
      await sleep(400);
    }
    throw new Error(`waitFor timeout: ${label}`);
  };

  const count = (selector) => cdp.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

  const screenshot = async (name) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(`${OUT_DIR}/${name}.png`, Buffer.from(data, "base64"));
  };

  /** React の制御入力を正しく更新する */
  const setInputValue = (selector, value) => cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);

  /** テキスト一致でクリックする */
  const clickByText = (selector, text) => cdp.eval(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = nodes.find((n) => (n.textContent || "").includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);

  /* ---------- load ---------- */

  await cdp.send("Page.navigate", { url: BASE_URL });
  await waitFor(`document.readyState === "complete"`, 60_000, "document complete");
  await sleep(2500);

  const title = await cdp.eval("document.title");
  record("トップページが読み込まれる", title.includes("工事みえるマップ"), `title=${title}`);

  const bodyText = await cdp.eval("document.body.innerText");
  record("ブランド名が表示される", bodyText.includes("工事みえるマップ 3D Beta"));

  /* ---------- 3D ビューア ---------- */

  await waitFor(`document.querySelectorAll("canvas").length > 0`, 40_000, "3D canvas");
  const canvas3d = await cdp.eval(`(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
  })()`);
  record(
    "3Dビューアのキャンバスが描画される",
    canvas3d && canvas3d.cw > 200 && canvas3d.ch > 200,
    JSON.stringify(canvas3d),
  );
  await screenshot("01-3d-default");

  /* ---------- 一覧・詳細 ---------- */

  // 一覧の行は CSS Modules のハッシュ付きクラス（…__card）を持つ button。
  const LIST_ROW = 'button[class*="__card"]';
  // 詳細パネルは Lead が付けた aria-label で特定する（Legend も <aside> のため）。
  const DETAIL_PANE = 'aside[aria-label="工事の詳細"]';

  const detailTextOf = () =>
    cdp.eval(`(document.querySelector(${JSON.stringify(DETAIL_PANE)})?.innerText) ?? ""`);
  const detailTitleOf = () =>
    cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(DETAIL_PANE)} + ' [class*="__title"], ' +
        ${JSON.stringify(DETAIL_PANE)} + ' [class*="__dTitle"]');
      return el ? el.textContent.trim() : "";
    })()`);

  const listCount = await count(LIST_ROW);
  record("工事一覧が表示される", listCount > 0, `${listCount} 行`);
  await screenshot("01b-list");

  const detailTitle = await detailTitleOf();
  record("初期選択の工事詳細が表示される", detailTitle.length > 0, detailTitle);

  const detailText = await detailTextOf();
  record(
    "工事詳細に出典・更新日時が含まれる",
    detailText.includes("情報提供元") &&
      (detailText.includes("最終更新") || detailText.includes("更新")),
    detailText.length ? `${detailText.length} 文字` : "詳細パネルが空",
  );
  record(
    "工事詳細に公式リンクがある",
    await cdp.eval(`!!document.querySelector(${JSON.stringify(DETAIL_PANE)} + ' a[target="_blank"]')`),
  );
  record("工事詳細に写真クレジットがある", /CC BY|CC0|Wikimedia/.test(detailText));

  /* ---------- 検索 ---------- */

  const beforeSearch = await cdp.eval(`document.body.innerText.match(/表示中\\s*(\\d+)\\s*件/)?.[1] ?? ""`);
  const searchSelector = 'input[type="search"], input[aria-label*="検索"]';
  const typed = await setInputValue(searchSelector, "駅前広場");
  await sleep(1600);
  const afterSearch = await cdp.eval(`document.body.innerText.match(/表示中\\s*(\\d+)\\s*件/)?.[1] ?? ""`);
  record(
    "検索で一覧が絞り込まれる",
    typed && Number(afterSearch) > 0 && Number(afterSearch) < Number(beforeSearch),
    `${beforeSearch} → ${afterSearch} 件`,
  );
  await screenshot("02-search");

  // 検索をクリア
  await setInputValue(searchSelector, "");
  await sleep(1200);

  /* ---------- フィルタ ---------- */

  const chipClicked = await clickByText("button[class*='fchip'], button.fchip", "着工前");
  await sleep(1200);
  const afterFilter = await cdp.eval(`document.body.innerText.match(/表示中\\s*(\\d+)\\s*件/)?.[1] ?? ""`);
  record(
    "施工状態フィルタが機能する",
    chipClicked && Number(afterFilter) > 0 && Number(afterFilter) < 24,
    `着工前 → ${afterFilter} 件`,
  );

  // フィルタ解除
  await clickByText("button[class*='fchip'], button.fchip", "すべて");
  await sleep(1200);

  /* ---------- 工事選択（一覧クリック） ---------- */

  const clicked = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll(${JSON.stringify(LIST_ROW)})];
    if (rows.length < 2) return false;
    rows[1].click();
    return true;
  })()`);
  await sleep(2200);
  const detailTitle2 = await detailTitleOf();
  record(
    "一覧から工事を選択すると詳細が切り替わる",
    clicked && detailTitle2.length > 0 && detailTitle2 !== detailTitle,
    `${detailTitle} → ${detailTitle2}`,
  );
  await screenshot("03-selected");

  /* ---------- 影響イベント（規制） ---------- */

  const impactText = await detailTextOf();
  record(
    "交通規制・影響イベントが表示される",
    /車線規制|迂回路|歩道切替|通行止め|夜間作業|搬入規制|事前周知|完了/.test(impactText),
  );

  /* ---------- レイヤー切替 ---------- */

  const layerTab = await clickByText("button[role='tab']", "レイヤー");
  await sleep(900);
  const swatchCount = await count("[class*='switch']");
  const toggled = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll("[class*='layerRow'], [class*='layer-row']")];
    if (!rows.length) return false;
    rows[0].click();
    return true;
  })()`);
  await sleep(900);
  record(
    "レイヤーパネルが表示され切替できる",
    layerTab && swatchCount > 0 && toggled,
    `スイッチ ${swatchCount} 個`,
  );

  await clickByText("button[role='tab']", "工事一覧");
  await sleep(700);

  /* ---------- 時間軸 ---------- */

  const timelineBefore = await cdp.eval(`document.body.innerText.match(/(\\d{4})年(\\d{1,2})月(\\d{1,2})日/)?.[0] ?? ""`);
  const sliderChanged = await cdp.eval(`(() => {
    const el = document.querySelector('input[type="range"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(Number(el.value) + 60));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(1500);
  const timelineAfter = await cdp.eval(`document.body.innerText.match(/(\\d{4})年(\\d{1,2})月(\\d{1,2})日/)?.[0] ?? ""`);
  record(
    "時間軸の操作で基準日が変わる",
    sliderChanged && timelineBefore !== timelineAfter && timelineAfter.length > 0,
    `${timelineBefore} → ${timelineAfter}`,
  );
  await screenshot("04-timeline");

  /* ---------- 2D / 3D 切替 ---------- */

  const to2d = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "2D");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(6000);

  // MapLibre のコンテナが実際に高さを持っているか。
  // （maplibre-gl.css の `.maplibregl-map{position:relative}` が
  //   `position:absolute; inset:0` を上書きすると高さ 0 に潰れ、
  //   工区は描画されるのに地図が見えなくなる。過去に実際に発生した。）
  const mapBox = await cdp.eval(`(() => {
    const el = document.querySelector('[class*="maplibregl-map"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const c = el.querySelector("canvas");
    return {
      className: el.className,
      w: Math.round(r.width),
      h: Math.round(r.height),
      canvasH: c ? c.clientHeight : 0,
      canvasW: c ? c.clientWidth : 0,
    };
  })()`);
  record(
    "2D地図へ切り替えられる",
    to2d && mapBox !== null,
    mapBox ? String(mapBox.className).slice(0, 60) : "MapLibre コンテナなし",
  );
  record(
    "2D地図のコンテナが実サイズを持つ",
    mapBox !== null && mapBox.w > 300 && mapBox.h > 200 && mapBox.canvasH > 200,
    mapBox ? `container ${mapBox.w}x${mapBox.h} / canvas ${mapBox.canvasW}x${mapBox.canvasH}` : "n/a",
  );

  // ビューポートのピクセルを採取し、デバッグ色（マゼンタ）が露出していないことを確認する。
  const { data: shot } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const pixels = await cdp.eval(`(async () => {
    const img = new Image();
    img.src = "data:image/png;base64,${shot}";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const pick = (fx, fy) => {
      const d = ctx.getImageData(Math.floor(img.width * fx), Math.floor(img.height * fy), 1, 1).data;
      return ((d[0] << 16) | (d[1] << 8) | d[2]).toString(16).padStart(6, "0");
    };
    return [pick(0.45, 0.45), pick(0.35, 0.6), pick(0.55, 0.3), pick(0.4, 0.75)];
  })()`);
  const magentaCount = pixels.filter((p) => p.toLowerCase() === "ff00ff").length;
  record(
    "2D地図にデバッグ色（マゼンタ）が露出していない",
    magentaCount === 0,
    `採取色: ${pixels.map((p) => `#${p}`).join(", ")}`,
  );

  await screenshot("05-2d");

  const to3d = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "3D");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(5000);
  const canvas3dBack = await count("canvas");
  record("3D表示へ戻せる", to3d && canvas3dBack > 0, `canvas ${canvas3dBack}`);

  /* ---------- 現場ビューア ---------- */

  const svOpen = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("現場ビューア"));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(1800);
  const svText = await cdp.eval(`document.body.innerText`);
  record(
    "現場ビューアが開き写真クレジットを表示する",
    svOpen && /CC BY|CC0|Wikimedia/.test(svText),
  );
  await screenshot("06-siteviewer");

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(1200);

  /* ---------- モバイル ---------- */

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(2500);
  const overflow = await cdp.eval(
    `({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`,
  );
  record(
    "モバイル幅で横スクロールが発生しない",
    overflow.sw <= overflow.cw + 2,
    `scrollWidth=${overflow.sw} clientWidth=${overflow.cw}`,
  );
  const mobileInfo = await cdp.eval(`document.body.innerText.includes("工事みえるマップ 3D Beta")`);
  record("モバイル幅でも工事情報が表示される", mobileInfo);
  await screenshot("07-mobile");

  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await sleep(1500);

  /* ---------- エラー検査 ---------- */

  // 3D Tiles 未構成時の警告など、想定内のメッセージを除外
  const IGNORABLE = [
    /favicon/i,
    /Download the React DevTools/i,
    /PLATEAU/i,
    /WebGL/i,
    /THREE\./i,
  ];
  const realConsoleErrors = consoleErrors.filter((m) => !IGNORABLE.some((re) => re.test(m)));
  const realExceptions = pageExceptions.filter((m) => !IGNORABLE.some((re) => re.test(m)));

  record(
    "致命的な Console エラーがない",
    realConsoleErrors.length === 0,
    realConsoleErrors.slice(0, 4).join(" || ") || "0 件",
  );
  record(
    "未捕捉の例外がない",
    realExceptions.length === 0,
    realExceptions.slice(0, 3).join(" || ") || "0 件",
  );
  record(
    "失敗したネットワークリクエストがない",
    failedRequests.length === 0,
    failedRequests.slice(0, 4).join(" || ") || "0 件",
  );

  await cdp.send("Page.navigate", { url: `${BASE_URL}/projects/denenchofu-station-plaza` });
  await waitFor(`document.readyState === "complete"`, 45_000, "project page");
  await sleep(1500);
  const projectPageText = await cdp.eval("document.body.innerText");
  record(
    "工事個別ページが表示される",
    projectPageText.includes("田園調布駅前広場整備工事") ||
      projectPageText.includes("駅前広場を歩行者中心に整える工事"),
  );
  record("工事個別ページに出典がある", projectPageText.includes("情報提供元"));
  await screenshot("08-project-page");

  const report = {
    url: BASE_URL,
    chrome: version.Browser,
    generatedAt: new Date().toISOString(),
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    consoleErrors,
    consoleWarnings: consoleWarnings.slice(0, 20),
    exceptions: pageExceptions,
    failedRequests,
    results,
  };
  await writeFile(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `\n=== ブラウザ検証: ${report.passed} PASS / ${report.failed} FAIL ===`,
  );
  if (report.failed > 0) exitCode = 1;
} catch (error) {
  console.error("\n[verify-browser] 検証中にエラー:", error?.message ?? error);
  if (chromeStderr) console.error(chromeStderr.split("\n").slice(-12).join("\n"));
  exitCode = 2;
} finally {
  chrome.kill("SIGKILL");
}

process.exit(exitCode);
