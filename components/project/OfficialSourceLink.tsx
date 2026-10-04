import { formatDateTime } from "./format";
import { IconExt } from "./icons";
import styles from "./project.module.css";

export interface OfficialSourceLinkProps {
  /** 情報提供元（発注者・自治体など）: `project.source.provider` */
  provider: string;
  /** 公式情報の URL: `project.source.officialUrl` */
  officialUrl: string;
  /** 情報を確認した日時: `project.source.verifiedAt` */
  verifiedAt: string;
  /** データセット名（任意） */
  dataset?: string;
  /** ライセンス表記（任意） */
  license?: string;
}

/**
 * 出典の表示。情報提供元・公式 URL（新しいタブで開く）・確認日時を必ず示す（AC-014）。
 */
export function OfficialSourceLink({
  provider,
  officialUrl,
  verifiedAt,
  dataset,
  license,
}: OfficialSourceLinkProps) {
  return (
    <div className={styles.srcBlock}>
      <div className={styles.srcRow}>
        <span>
          情報提供元 <b>{provider}</b>
        </span>
        <a href={officialUrl} target="_blank" rel="noopener noreferrer">
          公式情報を見る
          <IconExt />
        </a>
      </div>

      <div className={`${styles.srcRow} ${styles.srcSub}`}>
        <span>確認日時</span>
        <span className="num">{formatDateTime(verifiedAt)}</span>
      </div>

      {dataset && (
        <div className={`${styles.srcRow} ${styles.srcSub}`}>
          <span>データセット</span>
          <span>{dataset}</span>
        </div>
      )}

      {license && (
        <div className={`${styles.srcRow} ${styles.srcSub}`}>
          <span>ライセンス</span>
          <span>{license}</span>
        </div>
      )}
    </div>
  );
}
