/**
 * 一時検証用: CSS Modules の import を空のプロキシに置き換える Node ローダ。
 * （components/project/ 内の一時ファイル。検証後に削除する）
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    return {
      format: "module",
      shortCircuit: true,
      source:
        "const styles = new Proxy({}, { get: (_target, key) => String(key) }); export default styles;",
    };
  }
  return nextLoad(url, context);
}
