"use client";

/**
 * レイヤー ON/OFF。
 *
 * 2つのグループを情報源そのままに描画する（独自の一覧を持たない）:
 *   1. 基本表示 … `LAYERS` / `LAYER_GROUPS`（3Dの骨格）
 *   2. データレイヤー … `DATA_LAYERS`（現場ごとの情報ソース。BIM / CAD / 点群 / 3DGS …）
 *
 * スウォッチ色も各メタデータの `swatch` を使う。
 * データレイヤーの形状は実データではなくサンプル（合成）データのため、
 * `sample: true` のものには「サンプル」バッジを付ける（`SITE_LAYER_NOTE`）。
 */
import { useMemo } from "react";

import { publicImpacts } from "@/lib/data/impacts";
import { publicProjectRecords } from "@/lib/data/projects";
import { SITE_LAYER_NOTE } from "@/lib/site/sceneData";
import {
  DATA_LAYERS,
  LAYERS,
  LAYER_GROUPS,
  useAppStore,
  type DataLayerId,
  type DataLayerMeta,
  type LayerId,
  type LayerMeta,
} from "@/lib/store/useAppStore";

import styles from "./viewer.module.css";

const GROUP_ORDER: LayerMeta["group"][] = ["base", "project", "impact"];

/** 基本レイヤーのスウォッチ（render の種類で見た目を変える） */
function LayerMark({ layer }: { layer: LayerMeta }) {
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

/** データレイヤーのスウォッチ（描画プリミティブごとに形を変える） */
function DataLayerMark({ layer }: { layer: DataLayerMeta }) {
  switch (layer.render) {
    case "line":
      return (
        <span
          className={styles.layerMarkLine}
          style={{ borderTopColor: layer.swatch }}
          aria-hidden="true"
        />
      );
    case "line-dashed":
      return (
        <span
          className={styles.layerMarkLineDashed}
          style={{ borderTopColor: layer.swatch }}
          aria-hidden="true"
        />
      );
    case "point":
      return (
        <span
          className={styles.layerMarkPoint}
          style={{ background: layer.swatch }}
          aria-hidden="true"
        />
      );
    case "points":
      return (
        <span
          className={styles.layerMarkDots}
          style={{ color: layer.swatch }}
          aria-hidden="true"
        />
      );
    case "splat":
      return (
        <span
          className={styles.layerMarkSplat}
          style={{ backgroundColor: layer.swatch, color: layer.swatch }}
          aria-hidden="true"
        />
      );
    case "billboard":
      return (
        <span
          className={styles.layerMarkBillboard}
          style={{ borderColor: layer.swatch }}
          aria-hidden="true"
        />
      );
    case "pin":
      return (
        <span
          className={styles.layerMarkPin}
          style={{ background: layer.swatch }}
          aria-hidden="true"
        />
      );
    case "mesh":
      return (
        <span
          className={styles.layerMarkMesh}
          style={{ background: layer.swatch }}
          aria-hidden="true"
        />
      );
  }
}

export function LayerControl(): React.ReactElement {
  const visibleLayers = useAppStore((s) => s.visibleLayers);
  const dataLayers = useAppStore((s) => s.dataLayers);
  const viewScope = useAppStore((s) => s.viewScope);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const toggleDataLayer = useAppStore((s) => s.toggleDataLayer);
  const setAllLayers = useAppStore((s) => s.setAllLayers);
  const setAllDataLayers = useAppStore((s) => s.setAllDataLayers);

  /** 各レイヤーの対象件数（凡例の補助情報） */
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

  const siteScope = viewScope === "site";
  const dataLayerOnCount = DATA_LAYERS.filter((layer) => dataLayers[layer.id]).length;

  const showAll = () => {
    setAllLayers(true);
    setAllDataLayers(true);
  };
  const hideAll = () => {
    setAllLayers(false);
    setAllDataLayers(false);
  };

  return (
    <div className={styles.layerPanel} aria-label="レイヤーの表示切替">
      <div className={styles.layerActions}>
        <button type="button" className="chip-btn" onClick={showAll}>
          すべてON
        </button>
        <button type="button" className="chip-btn" onClick={hideAll}>
          すべてOFF
        </button>
      </div>

      {/* --- 1. 基本表示（LAYERS） --- */}
      <section className={styles.layerSection}>
        <p className="lg-head">基本表示</p>
        {GROUP_ORDER.map((group) => {
          const layers = LAYERS.filter((layer) => layer.group === group);
          if (layers.length === 0) return null;
          return (
            <div key={group} className={styles.layerGroup}>
              <p className={styles.layerSubHead}>{LAYER_GROUPS[group]}</p>
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
                    <LayerMark layer={layer} />
                    <span className={styles.layerText}>
                      <span className={styles.layerName}>{layer.name}</span>
                    </span>
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
          「都市モデル」「地形・地盤」「工区」などは3D表示でのみ効果があります。
          {siteScope
            ? "現場3Dでは選択中の1現場だけを描画します。"
            : "地区全体表示では全案件を俯瞰します。"}
        </p>
      </section>

      {/* --- 2. データレイヤー（DATA_LAYERS） --- */}
      <section className={styles.layerSection}>
        <p className="lg-head">
          データレイヤー
          <span className={styles.layerHeadCount}>
            {dataLayerOnCount}/{DATA_LAYERS.length}
          </span>
        </p>
        <div className={styles.layerGroup}>
          {DATA_LAYERS.map((layer) => {
            const on = dataLayers[layer.id];
            return (
              <button
                key={layer.id}
                type="button"
                className={styles.layerRow}
                aria-pressed={on}
                title={layer.description}
                onClick={() => toggleDataLayer(layer.id as DataLayerId)}
              >
                <DataLayerMark layer={layer} />
                <span className={styles.layerText}>
                  <span className={styles.layerName}>
                    {layer.name}
                    {layer.sample ? <span className={styles.sampleBadge}>サンプル</span> : null}
                  </span>
                  <span className={styles.layerDesc}>{layer.description}</span>
                </span>
                <span className={`switch ${on ? "on" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <p className={styles.layerNote}>
          「GIS」は工区・車線規制・迂回路・歩道切替をまとめて切り替えます。{SITE_LAYER_NOTE}
        </p>
      </section>
    </div>
  );
}
