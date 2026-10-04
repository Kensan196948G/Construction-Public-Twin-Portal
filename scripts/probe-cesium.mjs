#!/usr/bin/env node
/**
 * CesiumJS ビューアの起動診断（依存ゼロ / Chrome DevTools Protocol 直結）。
 *
 *   node scripts/probe-cesium.mjs [--url http://127.0.0.1:43100] [--wait 30000]
 *
 * 何を調べるか:
 *   - canvas が生成されたか / Cesium のコンテナができたか
 *   - WebGL が使えるか（headless では SwiftShader が必要）
 *   - コンソールエラー・例外・失敗リクエスト
 *   - 「内蔵3D」への自動フォールバックが起きたか
 *
 * verify-browser.mjs が canvas 待ちでタイムアウトした場合の原因切り分けに使う。
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const BASE_URL = arg("url", process.env.BASE_URL ?? "http://127.0.0.1:43100");
const WAIT_MS = Number(arg("wait", "30000"));
const CDP_PORT = Number(arg("port", "9444"));
const CHROME = arg("chrome", process.env.CHROME_PATH ?? "/usr/bin/google-chrome");

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--mute-audio",
    "--no-sandbox",
    "--window-size=1440,900",
    // headless で WebGL を有効にする（これが無いと Cesium は起動できない）
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--user-data-dir=/tmp/dsh-probe-cesium",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

let chromeStderr = "";
chrome.stderr.on("data", (chunk) => {
  chromeStderr += chunk.toString();
});

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function main() {
  let version = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      version = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error(`Chrome に接続できませんでした: ${chromeStderr.slice(-400)}`);

  const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const target = targets.find((t) => t.type === "page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  let nextId = 1;
  const pending = new Map();
  const console_ = [];
  const exceptions = [];
  const failedRequests = [];
  const scripts = [];

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(" ");
      console_.push(`${message.params.type}: ${text}`);
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails ?? {};
      exceptions.push(
        [
          details.exception?.description ?? details.text ?? "unknown",
          `url=${details.url ?? "?"}`,
          `line=${details.lineNumber ?? "?"}`,
          `col=${details.columnNumber ?? "?"}`,
        ].join(" | "),
      );
    }
    if (message.method === "Debugger.scriptParsed") {
      const url = message.params.url ?? "";
      if (/cesium/i.test(url)) scripts.push(url);
    }
    if (message.method === "Network.loadingFailed") {
      failedRequests.push(`${message.params.errorText} ${message.params.type}`);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Debugger.enable");

  console.log(`[probe] navigate ${BASE_URL}`);
  await send("Page.navigate", { url: BASE_URL });
  await sleep(WAIT_MS);

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result.result?.value;
  };

  const report = await evaluate(`(() => {
    const canvas = document.querySelector("canvas");
    const gl = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
      } catch (e) { return false; }
    })();
    return {
      webglAvailable: gl,
      canvasCount: document.querySelectorAll("canvas").length,
      canvasSize: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
      cesiumViewer: !!document.querySelector(".cesium-viewer"),
      cesiumWidget: !!document.querySelector(".cesium-widget"),
      cesiumCanvas: !!document.querySelector(".cesium-widget canvas"),
      spinnerVisible: !!document.querySelector(".spinner"),
      emptyNotes: Array.from(document.querySelectorAll(".empty-note")).map((n) => n.textContent.trim()).slice(0, 3),
      bodyTextHead: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 300),
    };
  })()`);

  console.log("[probe] === result ===");
  console.log(JSON.stringify(report, null, 2));
  console.log("[probe] === console (last 25) ===");
  console.log(console_.slice(-25).join("\n") || "(none)");
  console.log("[probe] === exceptions ===");
  console.log(exceptions.slice(-10).join("\n") || "(none)");
  console.log("[probe] === cesium scripts parsed ===");
  console.log(scripts.slice(-10).join("\n") || "(none)");
  console.log("[probe] === failed requests ===");
  console.log(failedRequests.slice(-10).join("\n") || "(none)");

  socket.close();
}

main()
  .catch((error) => {
    console.error("[probe] 失敗:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill("SIGKILL");
  });
