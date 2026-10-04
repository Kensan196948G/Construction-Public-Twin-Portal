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

// NOTE: 既定を localhost にしているのは、Next 16 が 127.0.0.1 からの dev リソース
// アクセスを cross-origin としてブロックし、dev サーバーでは hydration が止まるため。
// （next.config.ts の allowedDevOrigins でも緩和しているが、既定はこちらに寄せる）
const BASE_URL = argValue("--url", process.env.BASE_URL ?? "http://localhost:3000");
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
      }, 120_000);
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

  // 一覧の行数を直接数える（body 全文の正規表現は他要素を拾って誤検出する）
  const beforeSearch = await count(LIST_ROW);
  const searchSelector = 'input[type="search"], input[aria-label*="検索"]';
  const typed = await setInputValue(searchSelector, "駅前広場");
  await sleep(1600);
  const afterSearch = await count(LIST_ROW);
  record(
    "検索で一覧が絞り込まれる",
    typed && afterSearch > 0 && afterSearch < beforeSearch,
    `${beforeSearch} → ${afterSearch} 件`,
  );
  await screenshot("02-search");

  // 検索をクリア
  await setInputValue(searchSelector, "");
  await sleep(1200);

  /* ---------- 住所検索（公的ジオコーダー → PostGIS 空間検索） ---------- */

  // サンプル地区（大田区田園調布）の住所。GSI は丁目レベルまで解決できる。
  const addressQuery = "東京都大田区田園調布一丁目";
  await setInputValue(searchSelector, addressQuery);
  await sleep(3000);

  const addressCandidates = await cdp.eval(`(() => {
    const buttons = [...document.querySelectorAll("[role='option'], [role='listbox'] button")];
    return buttons
      .map((b) => b.textContent.replace(/\\s+/g, " ").trim())
      .filter((t) => t.startsWith("住所") || t.includes("国土地理院"));
  })()`);
  record(
    "住所候補がジオコーダーから提示される",
    addressCandidates.length > 0,
    addressCandidates[0]?.slice(0, 90) || "候補なし",
  );

  const addressClicked = await cdp.eval(`(() => {
    const buttons = [...document.querySelectorAll("[role='option'], [role='listbox'] button")];
    const target = buttons.find((b) => b.textContent.includes("国土地理院"));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  await sleep(3500);

  const geoPanel = await cdp.eval(`(() => {
    const panel = document.querySelector('[aria-label="住所から探す"]');
    if (!panel) return null;
    const text = panel.innerText || "";
    return {
      text: text.replace(/\\s+/g, " ").slice(0, 220),
      hasSpatial: text.includes("周辺の施工現場"),
      source: text.includes("PostGIS 空間検索") ? "postgis" : text.includes("静的データ検索") ? "static" : "unknown",
      hasAttribution: text.includes("国土地理院"),
      projectButtons: panel.querySelectorAll("button[class*='item']").length,
    };
  })()`);
  record(
    "住所を選ぶと「住所から探す」パネルが開く",
    addressClicked && geoPanel !== null,
    geoPanel ? geoPanel.text.slice(0, 110) : "パネルなし",
  );
  record(
    "周辺の施工現場が PostGIS 空間検索で表示される",
    !!geoPanel && geoPanel.hasSpatial && geoPanel.source === "postgis" && geoPanel.projectButtons > 0,
    geoPanel ? `source=${geoPanel.source} 項目=${geoPanel.projectButtons}` : "n/a",
  );
  record(
    "住所検索の出典（国土地理院）が表示される",
    !!geoPanel && geoPanel.hasAttribution,
    geoPanel?.hasAttribution ? "出典表示あり" : "出典表示なし",
  );
  await screenshot("02b-geocode");

  // 住所パネルを閉じて検索をクリア
  await cdp.eval(`(() => {
    const panel = document.querySelector('[aria-label="住所から探す"]');
    const close = panel ? [...panel.querySelectorAll("button")].find((b) => b.textContent.trim() === "×") : null;
    if (close) close.click();
  })()`);
  await sleep(900);
  await setInputValue(searchSelector, "");
  await sleep(1200);

  /* ---------- フィルタ ---------- */

  const chipClicked = await clickByText("button[class*='fchip'], button.fchip", "着工前");
  await sleep(1200);
  const afterFilter = await count(LIST_ROW);
  record(
    "施工状態フィルタが機能する",
    chipClicked && afterFilter > 0 && afterFilter < 24,
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

  // スライダーの値そのものと、注記（MapNote）の日付で判定する
  const NOTE = '[class*="mapNote"]';
  const readTimeline = async () =>
    cdp.eval(`(() => {
      const slider = document.querySelector('input[type="range"]');
      const note = document.querySelector(${JSON.stringify(NOTE)});
      return { value: slider ? slider.value : "", note: note ? note.innerText : "" };
    })()`);

  const tlBefore = await readTimeline();
  const sliderChanged = await cdp.eval(`(() => {
    const el = document.querySelector('input[type="range"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(Number(el.value) + 60));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await sleep(1800);
  const tlAfter = await readTimeline();
  record(
    "時間軸の操作で基準日が変わる",
    sliderChanged && tlBefore.value !== tlAfter.value && tlAfter.note !== tlBefore.note,
    `スライダー ${tlBefore.value} → ${tlAfter.value}`,
  );
  await screenshot("04-timeline");

  /* ---------- 2D / 3D 切替 ---------- */

  const to2d = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "2D");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);

  // MapLibre は動的 import のため初期化に時間がかかる。コンテナが出るまで待つ。
  let mapBox = null;
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    mapBox = await cdp.eval(`(() => {
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
    if (mapBox) break;
  }

  // 失敗時は原因究明のため、FallbackMap のエラー表示文言を拾う
  const mapFallbackMessage = mapBox
    ? ""
    : await cdp.eval(
        `(() => {
          const alert = document.querySelector('[role="alert"]');
          return alert ? alert.innerText.slice(0, 200) : "(エラー表示なし)";
        })()`,
      );

  record(
    "2D地図へ切り替えられる",
    to2d && mapBox !== null,
    mapBox ? String(mapBox.className).slice(0, 60) : `MapLibre コンテナなし / ${mapFallbackMessage}`,
  );
  record(
    "2D地図のコンテナが実サイズを持つ",
    mapBox !== null && mapBox.w > 300 && mapBox.h > 200 && mapBox.canvasH > 200,
    mapBox ? `container ${mapBox.w}x${mapBox.h} / canvas ${mapBox.canvasW}x${mapBox.canvasH}` : "n/a",
  );

  // ビューポートのピクセルを採取し、デバッグ色（マゼンタ）が露出していないことを確認する。
  const { data: shot } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 300, y: 190, width: 320, height: 240, scale: 1 },
  });
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
    return [pick(0.25, 0.3), pick(0.5, 0.5), pick(0.75, 0.4), pick(0.4, 0.75)];
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

  /* ---------- 現場ごとの3D（表示スコープ） ---------- */

  /**
   * キャンバスの見た目を数値化して、レイヤー切替・スコープ切替の効果を測る。
   *
   * 画面全体のスクリーンショット（数百KB）をページ内でデコードすると
   * Runtime.evaluate がタイムアウトするため、**ビューポート中央の小さな領域だけ**を
   * クリップして取得し、32x24 へ縮小して全画素を比較する。
   *
   * NOTE: 以前は clip 内の6点だけを比較していたが、BIM のような細い柱・梁は
   * 6点がたまたま背景に落ちると差分0になり、偽陰性が出た（site3d が再現・反証）。
   * 全画素を縮小比較することでカメラ距離のわずかな差にも安定して反応する。
   */
  const sampleCanvasPixels = async () => {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 300, y: 190, width: 320, height: 240, scale: 1 },
    });
    return cdp.eval(`(async () => {
      const img = new Image();
      img.src = "data:image/png;base64,${data}";
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 24;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 32, 24);
      const d = ctx.getImageData(0, 0, 32, 24).data;
      const out = [];
      for (let i = 0; i < d.length; i += 4) out.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return out;
    })()`);
  };

  /** チャンネル差 3 超の画素を「変化した」とみなす */
  const diffCount = (a, b) =>
    a.reduce((n, v, i) => {
      const dr = Math.abs(((v >> 16) & 255) - ((b[i] >> 16) & 255));
      const dg = Math.abs(((v >> 8) & 255) - ((b[i] >> 8) & 255));
      const db = Math.abs((v & 255) - (b[i] & 255));
      return n + (dr > 3 || dg > 3 || db > 3 ? 1 : 0);
    }, 0);
  const SAMPLE_TOTAL = 32 * 24;

  // ここから先は **内蔵3Dビューア固有** の機能（現場/地区スコープ・データレイヤー）を検証する。
  // 既定の3Dエンジンは CesiumJS（日本3Dビル）なので、まず内蔵3Dへ切り替える。
  const toThree = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "内蔵3D");
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(4000);
  record(
    "内蔵3Dエンジンへ切り替えられる",
    toThree,
    toThree ? "内蔵3D" : "「内蔵3D」ボタンが見つからない",
  );

  // 表示スコープ（現場 / 地区全体）は 3D ビューア側のバーが持つ。
  // ストア状態は注記（MapNote）の文言で確認する。
  const noteText = await cdp.eval(`(document.querySelector('[class*="mapNote"]')?.innerText) ?? ""`);
  record(
    "既定が現場スコープ（1現場だけの3D）",
    noteText.includes("現場3D"),
    noteText.slice(0, 80) || "注記なし",
  );

  const scopeButtons = await cdp.eval(`(() => {
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent.trim());
    return { site: labels.includes("現場"), area: labels.some((l) => l.startsWith("地区")) };
  })()`);
  record(
    "現場／地区の表示スコープ切替がある",
    scopeButtons.site && scopeButtons.area,
    `現場=${scopeButtons.site} 地区=${scopeButtons.area}`,
  );

  const siteShot = await sampleCanvasPixels();
  await screenshot("09-site-scope");

  // 地区スコープへ切り替えると絵が変わる（＝集約表示と現場表示が別物）
  const toArea = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith("地区"));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(4000);
  const areaNote = await cdp.eval(`(document.querySelector('[class*="mapNote"]')?.innerText) ?? ""`);
  const areaShot = await sampleCanvasPixels();
  record(
    "地区スコープへ切替で3Dの内容が変わる",
    toArea && areaNote.includes("地区3D") && diffCount(siteShot, areaShot) > 0,
    `差分 ${diffCount(siteShot, areaShot)}/${siteShot.length} 点`,
  );

  // 現場へ戻す
  await cdp.eval(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "現場");
    if (b) b.click();
  })()`);
  await sleep(3500);

  /* ---------- データレイヤー ---------- */

  await clickByText("button[role='tab']", "レイヤー");
  await sleep(900);

  const dataLayerNames = await cdp.eval(`(() => {
    const wanted = ["BIM","CAD","GIS","点群","3DGS","スマホ","写真","施工進捗","点検","撮影軌跡","AI・指摘ピン"];
    const text = document.querySelector("section")?.innerText ?? document.body.innerText;
    return wanted.filter((w) => text.includes(w));
  })()`);
  record(
    "レイヤーパネルに11種のデータレイヤーが並ぶ",
    dataLayerNames.length === 11,
    `${dataLayerNames.length}/11: ${dataLayerNames.join(", ")}`,
  );

  const beforeLayer = await sampleCanvasPixels();
  const bimToggled = await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll("[class*='layerRow'], [class*='layer-row'], li, div")]
      .filter((n) => (n.textContent || "").trim().startsWith("BIM"));
    const target = rows[rows.length - 1];
    if (!target) return false;
    target.click();
    return true;
  })()`);
  await sleep(2600);
  const afterLayer = await sampleCanvasPixels();
  record(
    "データレイヤー（BIM）のON/OFFで3Dが変わる",
    bimToggled && diffCount(beforeLayer, afterLayer) > 0,
    `差分 ${diffCount(beforeLayer, afterLayer)}/${beforeLayer.length} 点`,
  );
  await screenshot("10-data-layer");

  // BIM を元に戻す
  await cdp.eval(`(() => {
    const rows = [...document.querySelectorAll("[class*='layerRow'], [class*='layer-row'], li, div")]
      .filter((n) => (n.textContent || "").trim().startsWith("BIM"));
    const target = rows[rows.length - 1];
    if (target) target.click();
  })()`);
  await sleep(1200);
  await clickByText("button[role='tab']", "工事一覧");
  await sleep(700);

  // 既定の CesiumJS ビューア（日本3Dビル）へ戻し、実際に描画されることを確認する。
  const backToCesium = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "日本3Dビル");
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(6000);
  const cesiumState = await cdp.eval(`(() => {
    const canvas = document.querySelector(".cesium-widget canvas") ?? document.querySelector("canvas");
    return {
      viewer: !!document.querySelector(".cesium-viewer"),
      canvas: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
      creditText: (document.body.innerText || "").includes("国土地理院"),
    };
  })()`);
  record(
    "CesiumJS（日本3Dビル）ビューアが既定で描画される",
    backToCesium && cesiumState.viewer && !!cesiumState.canvas,
    `viewer=${cesiumState.viewer} canvas=${JSON.stringify(cesiumState.canvas)}`,
  );
  record(
    "出典（国土地理院）が画面に表示される",
    cesiumState.creditText,
    cesiumState.creditText ? "出典表示あり" : "出典表示なし",
  );
  await screenshot("11-cesium-japan");

  /* ---------- 現場ギャラリー（24現場それぞれの3D） ---------- */

  const galleryOpened = await cdp.eval(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("現場ギャラリー"));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(2000);

  const galleryTitle = await cdp.eval(`document.body.innerText.includes("現場ギャラリー")`);
  record("現場ギャラリーが開く", galleryOpened && galleryTitle);

  // 3Dプレビューの生成完了を待つ（SwiftShader では時間がかかる）
  let generated = 0;
  for (let i = 0; i < 40; i++) {
    const tiles = await cdp.eval(`(() => {
      const imgs = [...document.querySelectorAll('img[src^="data:image/png"]')];
      return imgs.length;
    })()`);
    generated = tiles;
    if (generated >= 24) break;
    await sleep(1500);
  }
  record(
    "24現場すべてが3Dプレビューとして生成される",
    generated >= 24,
    `${generated}/24 枚が3Dキャプチャ`,
  );

  const tileInfo = await cdp.eval(`(() => {
    const imgs = [...document.querySelectorAll('img[src^="data:image/png"]')];
    const photoImgs = [...document.querySelectorAll('img[src^="/images/"]')];
    return { threed: imgs.length, photos: photoImgs.length };
  })()`);
  record(
    "各現場の3Dとサンプル写真が並んで表示される",
    tileInfo.threed >= 24 && tileInfo.photos >= 1,
    `3D ${tileInfo.threed} / 写真 ${tileInfo.photos}`,
  );

  const galleryOverflow = await cdp.eval(
    `({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`,
  );
  record(
    "ギャラリーで横スクロールが発生しない",
    galleryOverflow.sw <= galleryOverflow.cw + 2,
    `scrollWidth=${galleryOverflow.sw} clientWidth=${galleryOverflow.cw}`,
  );
  await screenshot("11-gallery");

  // 現場詳細タブ（大きい3D + 写真）
  await clickByText("button[role='tab']", "現場詳細");
  await sleep(4000);
  const detailTabOk = await cdp.eval(`(() => {
    const text = document.body.innerText;
    const hasPhoto = !!document.querySelector('img[src^="/images/"]');
    const has3d = !!document.querySelector("canvas");
    return { hasPhoto, has3d, hasCredit: /CC BY|CC0|Wikimedia/.test(text) };
  })()`);
  record(
    "現場詳細タブで3Dとサンプル写真とクレジットが出る",
    detailTabOk.has3d && detailTabOk.hasPhoto && detailTabOk.hasCredit,
    JSON.stringify(detailTabOk),
  );
  await screenshot("12-site-detail");

  // 閉じる
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(1500);

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
