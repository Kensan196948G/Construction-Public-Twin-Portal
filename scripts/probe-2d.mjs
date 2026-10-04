#!/usr/bin/env node
/**
 * 2D 地図（MapLibre）の描画状態をピクセルレベルで診断する使い捨てプローブ。
 *
 *   node scripts/probe-2d.mjs [--url http://127.0.0.1:43100]
 *
 * 行うこと:
 *   1. headless Chrome でページを開き 2D に切り替える
 *   2. ビューポート中央付近のピクセル色を、スクリーンショットを 2D canvas で
 *      デコードして取得する（WebGL の preserveDrawingBuffer に依存しない）
 *   3. マップ要素のサイズ・スタイル・MapLibre の内部状態を可能な範囲で報告する
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const argValue = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const BASE_URL = argValue("--url", "http://127.0.0.1:43100");
const CDP_PORT = Number(argValue("--port", "9334"));
const OUT_DIR = "tmp-verify";

const chrome = spawn(
  "/usr/bin/google-chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-allow-origins=*",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--hide-scrollbars",
    "--window-size=1440,900",
    "--user-data-dir=/tmp/dsh-probe-chrome",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

let stderr = "";
chrome.stderr.on("data", (d) => (stderr += d.toString()));

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`not ready: ${url}`);
}

try {
  await mkdir(OUT_DIR, { recursive: true });
  await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const page = targets.find((t) => t.type === "page");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval error");
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: BASE_URL });

  const waitFor = async (expr, ms = 45000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await evaluate(expr)) return true;
      } catch {
        /* retry */
      }
      await sleep(400);
    }
    return false;
  };

  await waitFor(`document.readyState === "complete"`);
  await sleep(2500);

  // 2D へ切り替え
  await evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "2D");
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(8000);

  const dom = await evaluate(`(() => {
    const el = document.querySelector('[class*="maplibregl-map"]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const canvas = el.querySelector("canvas");
    const cs = canvas ? getComputedStyle(canvas) : null;
    return {
      found: true,
      className: el.className,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      canvas: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            display: cs.display,
            visibility: cs.visibility,
            opacity: cs.opacity,
            background: cs.backgroundColor,
          }
        : null,
    };
  })()`);
  console.log("=== MapLibre DOM ===");
  console.log(JSON.stringify(dom, null, 2));

  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${OUT_DIR}/probe-2d.png`, Buffer.from(data, "base64"));

  // スクリーンショットをページ内で 2D canvas にデコードしてピクセルを採取する
  const pixels = await evaluate(`(async () => {
    const img = new Image();
    img.src = "data:image/png;base64,${data}";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const pts = [
      ["center", Math.floor(img.width/2), Math.floor(img.height/2)],
      ["left-map", Math.floor(img.width*0.35), Math.floor(img.height*0.5)],
      ["right-map", Math.floor(img.width*0.62), Math.floor(img.height*0.5)],
      ["top-map", Math.floor(img.width*0.5), Math.floor(img.height*0.2)],
      ["bottom-map", Math.floor(img.width*0.5), Math.floor(img.height*0.75)],
    ];
    const out = {};
    for (const [name, x, y] of pts) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      out[name] = "#" + [d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,"0")).join("");
    }
    // 画像全体の色ヒストグラム（上位）
    const all = ctx.getImageData(0,0,img.width,img.height).data;
    const hist = new Map();
    for (let i = 0; i < all.length; i += 4 * 97) {
      const k = ((all[i]>>4)<<8) | ((all[i+1]>>4)<<4) | (all[i+2]>>4);
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    const top = [...hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,n]) => {
      const r = ((k>>8)&15)*17, g=((k>>4)&15)*17, b=(k&15)*17;
      return "#" + [r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("") + " x" + n;
    });
    return { points: out, topColors: top, size: { w: img.width, h: img.height } };
  })()`);

  console.log("=== ピクセル測定 ===");
  console.log(JSON.stringify(pixels, null, 2));

  const magenta = Object.values(pixels.points).filter((c) => /^#ff00ff$/i.test(c)).length;
  console.log(
    `\n判定: 測定点 ${Object.keys(pixels.points).length} 中 ${magenta} 点が完全なマゼンタ(#ff00ff)`,
  );
  console.log(
    `上位色: ${pixels.topColors.join(", ")}`,
  );
} catch (error) {
  console.error("[probe-2d] 失敗:", error?.message ?? error);
  if (stderr) console.error(stderr.split("\n").slice(-8).join("\n"));
  process.exitCode = 1;
} finally {
  chrome.kill("SIGKILL");
}
