"use client";

import { useEffect } from "react";

import styles from "./layout.module.css";

const ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "この地図は何を見るためのものですか？",
    a: (
      <>
        公共工事を「位置・目的・工期・完成像・交通規制・生活影響」の文脈で確認するための地図です。
        工事一覧から案件を選ぶと、地図・3D表示と詳細カードが連動します。
      </>
    ),
  },
  {
    q: "工事を探すには？",
    a: (
      <>
        上部の検索欄に<strong>工事件名・公開名称・自治体・住所・工種</strong>を入力してください。
        工種チップと状態チップでも絞り込めます。
      </>
    ),
  },
  {
    q: "2Dと3Dはどう使い分けますか？",
    a: (
      <>
        右上の切替で <code>3D</code> / <code>2D</code> を選べます。3Dが利用できない端末や
        WebGLが無効な環境では、自動的に2D地図または一覧表示へ切り替わります。
        工事情報そのものは3D機能に依存しません。
      </>
    ),
  },
  {
    q: "時間軸（現在／完成予定）とは？",
    a: (
      <>
        画面下部のスライダーで基準日を動かすと、その日付で有効な交通規制だけが表示されます。
        「現在」「完成予定」ボタンで素早く移動できます。
      </>
    ),
  },
  {
    q: "3Dの都市モデルは何ですか？",
    a: (
      <>
        PLATEAU 等の3D都市モデル（3D Tiles）が構成されている場合はそれを背景に表示します。
        未構成・取得失敗・タイムアウトの場合は、外部配信に依存しない
        <strong>簡易3D都市モデル</strong>へ自動的に切り替わります。どちらの場合も工事情報は変わりません。
      </>
    ),
  },
  {
    q: "情報の出典と更新日時はどこで確認できますか？",
    a: (
      <>
        案件を選ぶと詳細カードの最下部に
        <strong>情報提供元・確認日時・最終更新日時・公式情報へのリンク</strong>
        が表示されます。お出かけ前には必ず公式情報をご確認ください。
      </>
    ),
  },
  {
    q: "収録されている工事は実在しますか？",
    a: (
      <>
        収録している工事案件は <strong>MVP開発用のサンプルデータ</strong> です。実在の工事・公告ではありません。
        写真のみ Wikimedia Commons の実在素材を使用しており、作者・ライセンス・原典を各所に表示しています。
      </>
    ),
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-bg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <header>
          <h2 id="help-title">使い方と情報源について</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="body">
          {ITEMS.map((item, i) => (
            <div className={styles.qa} key={item.q}>
              <span className={styles.qn} aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className={styles.qt}>{item.q}</p>
                <p className={styles.qd}>{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
