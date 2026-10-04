"use client";

/**
 * 住所検索の文脈パネル。
 *
 * 公的ジオコーダーで得た地点（`geocodePin`）を起点に、
 *   1) PostGIS の近傍検索で「周辺の施工現場」を距離順に表示
 *   2) PostGIS の包含判定で「この地点が入る施工範囲」を表示
 * する。住所検索（ナビゲーション）と施工範囲（工事管理上の正解）を
 * 1 画面で結び付けるのがこのパネルの役割。
 *
 * PostGIS が使えない場合は API が静的データで同じ意味の結果を返し、
 * その旨を必ず画面に表示する（使っていないものを「使用中」と書かない）。
 */
import { useEffect, useState, type ReactElement } from "react";

import { ADDRESS_PRECISION_LABEL, type AddressPrecision } from "@/lib/geo/address";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/lib/schemas/project";
import { useAppStore } from "@/lib/store/useAppStore";

import { statusPillClass } from "./mapUi";
import styles from "./GeoContextPanel.module.css";

const RADIUS_OPTIONS = [200, 500, 1000, 2000] as const;
const DEFAULT_RADIUS = 500;

interface NearbyProject {
  projectId: string;
  officialName: string;
  publicTitle: string;
  category: string;
  status: string;
  statusLabel: string;
  municipality: string;
  address: string;
  distanceM: number;
  insideWorkZone: boolean;
}

interface NearbyResponse {
  radiusM: number;
  count: number;
  source: "postgis" | "static";
  sourceLabel: string;
  notice?: string;
  projects: NearbyProject[];
}

interface ContainingFeature {
  featureId: string;
  projectId: string;
  featureKind: string;
  featureKindLabel: string;
  name: string;
  geometryType: string;
  distanceM: number;
}

interface ContainingResponse {
  count: number;
  source: "postgis" | "static";
  sourceLabel: string;
  notice?: string;
  features: ContainingFeature[];
}

function distanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/** 取得結果。`key` が一致するときだけ「現在の検索結果」として扱う。 */
interface SpatialResult {
  key: string;
  nearby: NearbyResponse | null;
  containing: ContainingResponse | null;
  error: string | null;
}

function spatialKey(
  pin: { longitude: number; latitude: number },
  radius: number,
): string {
  return `${pin.longitude},${pin.latitude},${radius}`;
}

export function GeoContextPanel(): ReactElement | null {
  const pin = useAppStore((s) => s.geocodePin);
  const setGeocodePin = useAppStore((s) => s.setGeocodePin);
  const selectProject = useAppStore((s) => s.selectProject);

  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS);
  const [result, setResult] = useState<SpatialResult | null>(null);

  const key = pin ? spatialKey(pin, radius) : "";
  // key が一致しない間は「読み込み中」として扱う（effect 内で同期 setState しない）
  const current = result && result.key === key ? result : null;
  const loading = Boolean(pin) && current === null;

  useEffect(() => {
    if (!pin) return;

    const controller = new AbortController();
    const requestedKey = spatialKey(pin, radius);
    const query = `lng=${pin.longitude}&lat=${pin.latitude}`;

    Promise.all([
      fetch(`/api/geo/nearby?${query}&radius=${radius}&limit=10`, { signal: controller.signal }),
      fetch(`/api/geo/contains?${query}&limit=10`, { signal: controller.signal }),
    ])
      .then(async ([nearbyResponse, containingResponse]) => {
        if (!nearbyResponse.ok || !containingResponse.ok) {
          throw new Error("spatial query failed");
        }
        const [nearbyData, containingData] = (await Promise.all([
          nearbyResponse.json(),
          containingResponse.json(),
        ])) as [NearbyResponse, ContainingResponse];
        setResult({
          key: requestedKey,
          nearby: nearbyData,
          containing: containingData,
          error: null,
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setResult({
          key: requestedKey,
          nearby: null,
          containing: null,
          error: "空間検索に失敗しました。時間をおいて再度お試しください。",
        });
      });

    return () => controller.abort();
  }, [pin, radius]);

  if (!pin) return null;

  const precisionLabel =
    ADDRESS_PRECISION_LABEL[pin.precision as AddressPrecision] ?? "住所";
  const nearby = current?.nearby ?? null;
  const containing = current?.containing ?? null;
  const error = current?.error ?? null;
  const source = nearby?.source ?? null;
  const notice = nearby?.notice ?? containing?.notice;

  return (
    <section className={`float ${styles.panel}`} aria-label="住所から探す">
      <header className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.eyebrow}>住所から探す</span>
          <h2 className={styles.address}>{pin.label}</h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setGeocodePin(null)}
          aria-label="住所検索の結果を閉じる"
          title="閉じる"
        >
          ×
        </button>
      </header>

      <div className={styles.meta}>
        <span className="pill cat">{precisionLabel}まで</span>
        {source && (
          <span className={`${styles.sourceBadge} ${source === "postgis" ? styles.sourceDb : ""}`}>
            {source === "postgis" ? "PostGIS 空間検索" : "静的データ検索"}
          </span>
        )}
      </div>

      <div className={styles.radiusRow} role="group" aria-label="検索半径">
        <span className={styles.radiusLabel}>半径</span>
        {RADIUS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`chip-btn ${option === radius ? "on" : ""}`}
            aria-pressed={option === radius}
            onClick={() => setRadius(option)}
          >
            {option >= 1000 ? `${option / 1000}km` : `${option}m`}
          </button>
        ))}
      </div>

      {loading && <p className={styles.note}>空間検索を実行しています…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.note}>{notice}</p>}

      {nearby && (
        <div className={styles.section}>
          <h3 className={styles.sectionHead}>
            周辺の施工現場 <span className="num">{nearby.count}</span> 件
          </h3>
          {nearby.projects.length === 0 ? (
            <p className="empty-note">この半径に公開中の施工現場はありません。</p>
          ) : (
            <ul className={styles.list}>
              {nearby.projects.map((project) => (
                <li key={project.projectId}>
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => selectProject(project.projectId)}
                  >
                    <span className={statusPillClass(project.status as ProjectStatus)}>
                      {project.statusLabel}
                    </span>
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{project.publicTitle}</span>
                      <span className={styles.itemSub}>
                        {project.municipality}／{distanceLabel(project.distanceM)}
                        {project.insideWorkZone ? "／工区の内側" : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {containing && containing.features.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionHead}>この地点が含まれる施工範囲</h3>
          <ul className={styles.list}>
            {containing.features.map((feature) => (
              <li key={feature.featureId}>
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => selectProject(feature.projectId)}
                >
                  <span className="pill cat">{feature.featureKindLabel}</span>
                  <span className={styles.itemText}>
                    <span className={styles.itemTitle}>{feature.name}</span>
                    <span className={styles.itemSub}>{feature.geometryType}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className={styles.foot}>
        <span>
          {pin.attribution}
          {source === "static" ? "／空間検索は静的データ" : ""}
        </span>
        <span>住所検索と施工範囲は別機能です</span>
      </footer>
    </section>
  );
}
