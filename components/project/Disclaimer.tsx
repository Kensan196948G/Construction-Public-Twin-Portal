import { IconAlert } from "./icons";
import styles from "./project.module.css";

/**
 * ご注意（免責事項）。
 * デザインの固定文言（`WebUI/koji-mieru-map-3d.html` の .disclaimer）と、
 * 案件データの `project.disclaimer` を両方表示する。
 * サンプルデータであることが必ず読み取れるようにする。
 */
export function Disclaimer({ text }: { text: string }) {
  return (
    <div className={styles.disclaimer}>
      <IconAlert />
      <div>
        <p>
          規制内容・工期は変更される場合があります。現地の案内・標識を優先してください。
          本ページのデータは<strong>デモ用サンプル</strong>であり、実際の工事情報ではありません。
        </p>
        <p>{text}</p>
      </div>
    </div>
  );
}
