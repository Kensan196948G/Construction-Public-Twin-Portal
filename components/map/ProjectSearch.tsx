"use client";

/**
 * トップバーの統合検索（F-001 検索 / サジェスト + 公的ジオコーダー）。
 *
 * 設計の正: `WebUI/koji-mieru-map-3d.html` の `.search` / `.search-results` / `.sr-item`。
 *
 * 1つの入力欄で次の 2 種類を同時に扱う（バックエンドで振り分ける）:
 *   1) 自社現場台帳（工事件名・公開名称・自治体・住所・工種）… `searchSuggestions()`
 *   2) 公的ジオコーダー（国土地理院 住所検索API）… `/api/geocode`
 *
 * 住所候補を選ぶと `setGeocodePin()` により地図・3D がその地点へ移動し、
 * 周辺の施工現場（PostGIS の近傍検索）が表示される。
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { searchSuggestions, type SearchSuggestion } from "@/lib/data/filter";
import { getProjectById, publicProjects } from "@/lib/data/projects";
import type { AddressPrecision } from "@/lib/geo/address";
import { PROJECT_CATEGORIES } from "@/lib/schemas/project";
import { useAppStore } from "@/lib/store/useAppStore";

import { statusLabel, statusPillClass } from "./mapUi";
import styles from "./ProjectSearch.module.css";

const SUGGESTION_LIMIT = 8;
const GEOCODE_LIMIT = 4;
const GEOCODE_DEBOUNCE_MS = 350;
/** これ未満の文字数ではジオコーダーを呼ばない（入力途中の無駄な問い合わせを避ける） */
const GEOCODE_MIN_LENGTH = 4;

const KIND_LABEL: Record<SearchSuggestion["kind"], string> = {
  name: "工事",
  address: "住所",
  municipality: "自治体",
  category: "工種",
};

/** ジオコーダー候補（/api/geocode の応答要素） */
interface GeocodeCandidate {
  id: string;
  title: string;
  longitude: number;
  latitude: number;
  precision: AddressPrecision;
  precisionLabel: string;
  resolvedToRequested: boolean;
  note?: string;
}

interface GeocodeResponse {
  query: string;
  count: number;
  candidates: GeocodeCandidate[];
  error?: string;
  filteredOut: number;
}

/** 住所らしい入力か（ジオコーダーを呼ぶかの判断） */
function looksLikeAddress(value: string): boolean {
  return /[都道府県市区町村郡]|丁目|番地|番|号|[0-9０-９]/.test(value);
}

/** 候補リストの 1 行 */
type Entry =
  | { key: string; kind: "suggestion"; suggestion: SearchSuggestion }
  | { key: string; kind: "geocode"; candidate: GeocodeCandidate };

/** ジオコーダーの取得結果。`query` が現在の入力と一致するときだけ有効。 */
interface GeocodeState {
  query: string;
  candidates: GeocodeCandidate[];
  error: string | null;
  done: boolean;
}

export function ProjectSearch(): ReactElement {
  const keyword = useAppStore((s) => s.searchKeyword);
  const setSearchKeyword = useAppStore((s) => s.setSearchKeyword);
  const setCategory = useAppStore((s) => s.setCategory);
  const selectProject = useAppStore((s) => s.selectProject);
  const setGeocodePin = useAppStore((s) => s.setGeocodePin);
  const showToast = useAppStore((s) => s.showToast);

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [geocodeState, setGeocodeState] = useState<GeocodeState>({
    query: "",
    candidates: [],
    error: null,
    done: false,
  });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const suggestions = useMemo(
    () => searchSuggestions(keyword, publicProjects(), SUGGESTION_LIMIT),
    [keyword],
  );

  const trimmed = keyword.trim();
  const geocodeActive = trimmed.length >= GEOCODE_MIN_LENGTH && looksLikeAddress(trimmed);

  /* --- 公的ジオコーダー（デバウンス + 中断） --- */
  useEffect(() => {
    if (trimmed.length < GEOCODE_MIN_LENGTH || !looksLikeAddress(trimmed)) return;

    const controller = new AbortController();
    const requested = trimmed;
    const timer = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(requested)}&limit=${GEOCODE_LIMIT}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
        .then((data: GeocodeResponse) => {
          setGeocodeState({
            query: requested,
            candidates: data.candidates ?? [],
            error: data.error ?? null,
            done: true,
          });
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setGeocodeState({
            query: requested,
            candidates: [],
            error: "住所検索サービスに接続できませんでした。",
            done: true,
          });
        });
    }, GEOCODE_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed]);

  const geocodeSettled = geocodeActive && geocodeState.query === trimmed && geocodeState.done;
  const geocode = useMemo(
    () => (geocodeSettled ? geocodeState.candidates : []),
    [geocodeSettled, geocodeState.candidates],
  );
  const geocodeError = geocodeSettled ? geocodeState.error : null;
  const geocodeLoading = geocodeActive && !geocodeSettled;

  /* --- 候補の統合（現場 → 住所 の順） --- */
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = suggestions.map((suggestion, index) => ({
      key: `s-${suggestion.kind}-${suggestion.title}-${suggestion.projectId}-${index}`,
      kind: "suggestion",
      suggestion,
    }));
    for (const candidate of geocode) {
      list.push({ key: `g-${candidate.id}`, kind: "geocode", candidate });
    }
    return list;
  }, [suggestions, geocode]);

  const visible = open && trimmed.length > 0;
  /** 候補数が減っても安全なように、描画時にインデックスを丸める */
  const activeIndex = entries.length > 0 ? Math.min(highlight, entries.length - 1) : 0;

  /* 外側クリックで閉じる */
  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [visible]);

  function applyEntry(entry: Entry) {
    setOpen(false);

    if (entry.kind === "geocode") {
      const { candidate } = entry;
      setGeocodePin({
        longitude: candidate.longitude,
        latitude: candidate.latitude,
        label: candidate.title,
        precision: candidate.precision,
        attribution: "出典：国土地理院 住所検索API",
      });
      setSearchKeyword(candidate.title);
      showToast(
        candidate.resolvedToRequested
          ? `住所を表示しました：${candidate.title}`
          : `${candidate.precisionLabel}までの一致です：${candidate.title}`,
      );
      inputRef.current?.focus();
      return;
    }

    const { suggestion } = entry;
    switch (suggestion.kind) {
      case "municipality":
        // 自治体候補はキーワード絞り込みとして反映する
        setCategory(null);
        setSearchKeyword(suggestion.title);
        break;
      case "category": {
        // 工種候補はストアの工種フィルタとして反映する
        const category = PROJECT_CATEGORIES.find((c) => c === suggestion.title);
        setSearchKeyword("");
        if (category) setCategory(category);
        break;
      }
      default:
        // 工事・住所候補は案件を選択し、一覧もその語で絞る
        selectProject(suggestion.projectId);
        setSearchKeyword(suggestion.title);
        break;
    }
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!visible || entries.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlight((activeIndex + 1) % entries.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlight((activeIndex - 1 + entries.length) % entries.length);
        break;
      case "Enter": {
        const entry = entries[activeIndex];
        if (entry) {
          event.preventDefault();
          applyEntry(entry);
        }
        break;
      }
      default:
        break;
    }
  }

  const activeId = visible && entries.length > 0 ? `${listId}-option-${activeIndex}` : undefined;
  const noResult = entries.length === 0 && !geocodeLoading;

  return (
    <div className={styles.search} role="search" ref={wrapRef}>
      <svg
        className={styles.icon}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        ref={inputRef}
        className={styles.input}
        type="search"
        value={keyword}
        placeholder="住所・駅・工事件名・現場IDで検索"
        aria-label="住所または工事を検索"
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        onChange={(event) => {
          setSearchKeyword(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => {
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      {visible && (
        <div className={styles.results} id={listId} role="listbox" aria-label="検索候補">
          {entries.map((entry, index) => {
            if (entry.kind === "geocode") {
              const { candidate } = entry;
              return (
                <button
                  key={entry.key}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`${styles.item} ${index === activeIndex ? styles.itemHl : ""}`}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyEntry(entry)}
                >
                  <span className="pill cat">住所</span>
                  <span className={styles.text}>
                    <span className={styles.title}>{candidate.title}</span>
                    <span className={styles.sub}>
                      {candidate.precisionLabel}まで
                      {candidate.resolvedToRequested ? "" : "（番地・号は未特定）"}／国土地理院
                    </span>
                  </span>
                </button>
              );
            }

            const { suggestion } = entry;
            const project = suggestion.projectId ? getProjectById(suggestion.projectId) : undefined;
            return (
              <button
                key={entry.key}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.item} ${index === activeIndex ? styles.itemHl : ""}`}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyEntry(entry)}
              >
                <span className={project ? statusPillClass(project.status) : "pill cat"}>
                  {project ? statusLabel(project.status) : KIND_LABEL[suggestion.kind]}
                </span>
                <span className={styles.text}>
                  <span className={styles.title}>{suggestion.title}</span>
                  <span className={styles.sub}>{suggestion.subtitle}</span>
                </span>
              </button>
            );
          })}

          {geocodeLoading && <p className={styles.empty}>住所を照会しています…</p>}

          {noResult && (
            <p className={styles.empty} role="status">
              {geocodeError
                ? geocodeError
                : "該当なし：条件に合う工事・住所が見つかりません"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
