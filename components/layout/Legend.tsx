"use client";

import {
  DATA_LAYERS,
  LAYERS,
  LAYER_GROUPS,
  useAppStore,
  type DataLayerMeta,
  type LayerMeta,
} from "@/lib/store/useAppStore";
import styles from "./layout.module.css";

function Mark({ layer }: { layer: LayerMeta }) {
  if (layer.render === "point") {
    return <span className={styles.lgDot} style={{ background: layer.swatch }} aria-hidden="true" />;
  }
  if (layer.render === "line") {
    return (
      <span className={styles.lgLineSolid} style={{ borderTopColor: layer.swatch }} aria-hidden="true" />
    );
  }
  if (layer.render === "line-dashed") {
    return (
      <span className={styles.lgLine} style={{ borderTopColor: layer.swatch }} aria-hidden="true" />
    );
  }
  return <span className={styles.lgMark} style={{ background: layer.swatch }} aria-hidden="true" />;
}

/** データレイヤーの描画プリミティブに対応する凡例マーク */
function DataMark({ layer }: { layer: DataLayerMeta }) {
  switch (layer.render) {
    case "point":
    case "pin":
      return <span className={styles.lgDot} style={{ background: layer.swatch }} aria-hidden="true" />;
    case "points":
      return (
        <span
          className={styles.lgDot}
          style={{
            background: `radial-gradient(circle, ${layer.swatch} 35%, transparent 36%)`,
            boxShadow: `0 0 0 1px ${layer.swatch}55`,
          }}
          aria-hidden="true"
        />
      );
    case "splat":
      return (
        <span
          className={styles.lgDot}
          style={{
            background: `radial-gradient(circle, ${layer.swatch} 10%, ${layer.swatch}66 65%, transparent 70%)`,
          }}
          aria-hidden="true"
        />
      );
    case "line":
      return (
        <span className={styles.lgLineSolid} style={{ borderTopColor: layer.swatch }} aria-hidden="true" />
      );
    case "line-dashed":
      return (
        <span className={styles.lgLine} style={{ borderTopColor: layer.swatch }} aria-hidden="true" />
      );
    case "billboard":
      return (
        <span
          className={styles.lgMark}
          style={{ background: layer.swatch, height: 10, borderRadius: 1 }}
          aria-hidden="true"
        />
      );
    default:
      return <span className={styles.lgMark} style={{ background: layer.swatch }} aria-hidden="true" />;
  }
}

/** ビューポート右下の凡例。表示中のレイヤーだけを並べる。 */
export function Legend() {
  const visibleLayers = useAppStore((s) => s.visibleLayers);
  const dataLayers = useAppStore((s) => s.dataLayers);
  const viewMode = useAppStore((s) => s.viewMode);

  const groups: LayerMeta["group"][] = ["base", "project", "impact"];
  const activeDataLayers = DATA_LAYERS.filter((l) => dataLayers[l.id]);

  return (
    <aside className={`float ${styles.legend}`} aria-label="凡例">
      <h4>凡例</h4>

      {groups.map((group) => {
        const layers = LAYERS.filter((l) => l.group === group && visibleLayers[l.id]);
        if (layers.length === 0) return null;
        return (
          <div key={group}>
            <p className={styles.legendSub}>{LAYER_GROUPS[group]}</p>
            <ul>
              {layers.map((layer) => (
                <li key={layer.id}>
                  <Mark layer={layer} />
                  <span>{layer.name}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <p className={styles.legendSub}>データレイヤー</p>
      {activeDataLayers.length === 0 ? (
        <p className={styles.legendEmpty}>表示中のデータレイヤーはありません</p>
      ) : (
        <ul>
          {activeDataLayers.map((layer) => (
            <li key={layer.id}>
              <DataMark layer={layer} />
              <span>{layer.name}</span>
            </li>
          ))}
        </ul>
      )}

      {viewMode === "3d" && (
        <>
          <p className={styles.legendSub}>影響の重要度</p>
          <ul>
            <li>
              <span className="sev-pill info">参考</span>
              <span>案内・周知</span>
            </li>
            <li>
              <span className="sev-pill notice">注意</span>
              <span>通行方法の変更</span>
            </li>
            <li>
              <span className="sev-pill warning">重要</span>
              <span>通行止め・夜間規制</span>
            </li>
          </ul>
        </>
      )}
    </aside>
  );
}
