"use client";

/**
 * 時間軸スライダー。
 *
 * 仕様書 #12 の「基準日」を動かし、その日に有効な規制だけを濃く表示する
 * （ImpactLayer / DetourLayer が isImpactActiveAt で判定する）。
 * 値はストア（setTimelineIndex）だけを通して更新する。
 */
import { useEffect, useMemo, useState } from "react";

import { publicProjects } from "@/lib/data/projects";
import {
  DEFAULT_TIMELINE_INDEX,
  TIMELINE_MAX,
  TIMELINE_MIN,
  dateToTimelineIndex,
  timelineIndexToDate,
  useAppStore,
} from "@/lib/store/useAppStore";

import styles from "./viewer.module.css";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 例: 2026年10月4日（日） */
function formatJapaneseDate(date: Date): string {
  const weekday = WEEKDAYS[date.getDay()] ?? "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
}

function formatShortDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function clampIndex(index: number): number {
  return Math.min(TIMELINE_MAX, Math.max(TIMELINE_MIN, index));
}

export function TimelineControl(): React.ReactElement {
  const viewTime = useAppStore((s) => s.viewTime);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setTimelineIndex = useAppStore((s) => s.setTimelineIndex);
  const [playing, setPlaying] = useState(false);

  const index = useMemo(
    () => clampIndex(dateToTimelineIndex(new Date(viewTime))),
    [viewTime],
  );
  const date = useMemo(() => timelineIndexToDate(index), [index]);

  /** 「完成予定」= 選択中案件の完成予定日（未選択なら期間末） */
  const completionIndex = useMemo(() => {
    if (!selectedProjectId) return TIMELINE_MAX;
    const project = publicProjects().find((p) => p.id === selectedProjectId);
    if (!project) return TIMELINE_MAX;
    const parsed = Date.parse(`${project.schedule.plannedEndDate}T00:00:00+09:00`);
    if (Number.isNaN(parsed)) return TIMELINE_MAX;
    return clampIndex(dateToTimelineIndex(new Date(parsed)));
  }, [selectedProjectId]);

  // 再生: 時間軸を一定間隔で進める（終端で自動停止）
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = index + 1;
      if (next > TIMELINE_MAX) {
        setPlaying(false);
        return;
      }
      setTimelineIndex(next);
    }, 320);
    return () => window.clearInterval(timer);
  }, [playing, index, setTimelineIndex]);

  return (
    <section className={`float ${styles.timeline}`} aria-label="時間軸">
      <div className={styles.tlHead}>
        <button
          type="button"
          className={styles.tlPlay}
          aria-label={playing ? "時間軸の再生を停止" : "時間軸を再生"}
          aria-pressed={playing}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? "❙❙" : "▶"}
        </button>
        <span className={styles.tlDate}>{formatJapaneseDate(date)}</span>
        <div className={styles.tlJumps}>
          <button
            type="button"
            className="chip-btn"
            onClick={() => {
              setPlaying(false);
              setTimelineIndex(DEFAULT_TIMELINE_INDEX);
            }}
          >
            現在
          </button>
          <button
            type="button"
            className="chip-btn"
            title="選択中の工事の完成予定日（未選択のときは期間末）"
            onClick={() => {
              setPlaying(false);
              setTimelineIndex(completionIndex);
            }}
          >
            完成予定
          </button>
        </div>
      </div>

      <input
        type="range"
        className={styles.tlSlider}
        min={TIMELINE_MIN}
        max={TIMELINE_MAX}
        step={1}
        value={index}
        aria-label="表示する日付"
        aria-valuetext={formatJapaneseDate(date)}
        onChange={(event) => {
          setPlaying(false);
          setTimelineIndex(Number(event.target.value));
        }}
      />

      <div className={styles.tlAxis} aria-hidden="true">
        <span>{formatShortDate(timelineIndexToDate(TIMELINE_MIN))}</span>
        <span>現在 {formatShortDate(timelineIndexToDate(DEFAULT_TIMELINE_INDEX))}</span>
        <span>{formatShortDate(timelineIndexToDate(TIMELINE_MAX))}</span>
      </div>
    </section>
  );
}
