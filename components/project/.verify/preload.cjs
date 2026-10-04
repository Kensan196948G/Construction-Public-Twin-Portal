/**
 * 一時検証用: CSS Modules の import をプロキシ（キー名をそのまま返す）に置き換える。
 * tsx 経由の CJS/ESM どちらでも default import がプロキシになるよう
 * `__esModule` を false にする。
 * （components/project/ 内の一時ファイル。検証後に削除する）
 */
const Module = require("module");

// tsx は tsconfig の "jsx": "preserve" を引き継いで classic transform になるため、
// 変換後の `React.createElement` が解決できるようにグローバルへ生やす。
globalThis.React = require("react");

function stylesStub() {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "__esModule") return false;
        if (typeof key === "string") return key;
        return undefined;
      },
    },
  );
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  if (typeof request === "string" && request.endsWith(".css")) {
    return stylesStub();
  }
  return originalLoad.call(this, request, ...rest);
};

require.extensions[".css"] = function cssExtension(module) {
  module.exports = stylesStub();
};
