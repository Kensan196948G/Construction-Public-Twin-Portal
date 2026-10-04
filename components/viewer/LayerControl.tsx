"use client";

/**
 * レイヤー ON/OFF。
 *
 * LAYERS / LAYER_GROUPS（lib/store/useAppStore.ts）だけを情報源として描画し、
 * 独自のレイヤー一覧を持たない。スウォッチ色も LAYERS.swatch を使う。
 */
import { useMemo } from "react";

import { publicImpacts } from "@/lib/data/impacts";
import { publicProjectRecords } from "@/lib/data/projects";
import {
  LAYERS,
  LAYER_GROUPS,
  useAppStore,
  type LayerId,
  type LayerMeta,
} from "@/lib/store/useAppStore";

import styles from "./viewer.module.css";

const GROUP_ORDER: LayerMeta["group"][] = ["base", "project", "impact"];

/** 凡例と同じ見た目のスウォッチ */
function Mark({ layer }: { layer: LayerMeta }) {
  if (layer.render === "line") {
    return (
      <span
        className={styles.layerMarkLine}
        style={{ borderTopColor: layer.swatch }}
        aria-hidden="true"
      />
    );
  }
  if (layer.render === "line-dashed") {
    return (
      <span
        className={styles.layerMarkLineDashed}
        style={{ borderTopColor: layer.swatch }}
        aria-hidden="true"
      />
    );
  }
  if (layer.render === "point") {
    return (
      <span
        className={styles.layerMarkPoint}
        style={{ background: layer.swatch }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span className={styles.layerMark} style={{ background: layer.swatch }} aria-hidden="true" />
  );
}

export function LayerControl(): React.ReactElement {
  const visibleLayers = useAppStore((s) => s.visibleLayers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const setAllLayers = useAppStore((s) => s.setAllLayers);

  /** 各レイヤーに表示対象が何件あるか（凡例の補助情報） */
  const counts = useMemo<Partial<Record<LayerId, number>>>(() => {
    const projectCount = publicProjectRecords().length;
    const impacts = publicImpacts();
    return {
      workzone: projectCount,
      markers: projectCount,
      completion: projectCount,
      regulation: impacts.filter((impact) => impact.geometryKind === "regulation").length,
      detour: impacts.filter((impact) => impact.geometryKind === "detour").length,
      pedestrian: impacts.filter((impact) => impact.geometryKind === "pedestrian").length,
    };
  }, []);

  return (
    <div className={styles.layerPanel} aria-label="レイヤーの表示切替">
      <div className={styles.layerActions}>
        <button type="button" className="chip-btn" onClick={() => setAllLayers(true)}>
          すべて表示
        </button>
        <button type="button" className="chip-btn" onClick={() => setAllLayers(false)}>
          すべて非表示
        </button>
      </div>

      {GROUP_ORDER.map((group) => {
        const layers = LAYERS.filter((layer) => layer.group === group);
        if (layers.length === 0) return null;
        return (
          <div key={group} className={styles.layerGroup}>
            <p className="lg-head">{LAYER_GROUPS[group]}</p>
            {layers.map((layer) => {
              const on = visibleLayers[layer.id];
              const count = counts[layer.id];
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={styles.layerRow}
                  aria-pressed={on}
                  onClick={() => toggleLayer(layer.id)}
                >
                  <Mark layer={layer} />
                  <span className={styles.layerName}>{layer.name}</span>
                  <span className={styles.layerCount}>
                    {count !== undefined ? count : layer.threeOnly ? "3D" : ""}
                  </span>
                  <span className={`switch ${on ? "on" : ""}`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        );
      })}

      <p className={styles.layerNote}>
        「都市モデル」「地形・地盤」は 3D 表示でのみ効果があります。
      </p>
    </div>
  );
}
