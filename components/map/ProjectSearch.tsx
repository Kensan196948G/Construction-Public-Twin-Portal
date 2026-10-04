"use client";

/**
 * トップバーの工事検索（F-001 検索 / サジェスト）。
 *
 * 設計の正: `WebUI/koji-mieru-map-3d.html` の `.search` / `.search-results` / `.sr-item`。
 * 候補は `lib/data/filter.ts` の `searchSuggestions()` が返す純粋関数の結果を使う。
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";

import { searchSuggestions, type SearchSuggestion } from "@/lib/data/filter";
import { getProjectById, publicProjects } from "@/lib/data/projects";
import { PROJECT_CATEGORIES } from "@/lib/schemas/project";
import { useAppStore } from "@/lib/store/useAppStore";

import { statusLabel, statusPillClass } from "./mapUi";
import styles from "./ProjectSearch.module.css";

const SUGGESTION_LIMIT = 8;

const KIND_LABEL: Record<SearchSuggestion["kind"], string> = {
  name: "工事",
  address: "住所",
  municipality: "自治体",
  category: "工種",
};

export function ProjectSearch(): ReactElement {
  const keyword = useAppStore((s) => s.searchKeyword);
  const setSearchKeyword = useAppStore((s) => s.setSearchKeyword);
  const setCategory = useAppStore((s) => s.setCategory);
  const selectProject = useAppStore((s) => s.selectProject);

  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const suggestions = useMemo(
    () => searchSuggestions(keyword, publicProjects(), SUGGESTION_LIMIT),
    [keyword],
  );

  const trimmed = keyword.trim();
  const visible = open && trimmed.length > 0;
  /** 候補数が減っても安全なように、描画時にインデックスを丸める */
  const activeIndex = suggestions.length > 0 ? Math.min(highlight, suggestions.length - 1) : 0;

  /* 外側クリックで閉じる */
  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [visible]);

  function applySuggestion(suggestion: SearchSuggestion) {
    setOpen(false);
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
    if (!visible || suggestions.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlight((activeIndex + 1) % suggestions.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlight((activeIndex - 1 + suggestions.length) % suggestions.length);
        break;
      case "Enter": {
        const suggestion = suggestions[activeIndex];
        if (suggestion) {
          event.preventDefault();
          applySuggestion(suggestion);
        }
        break;
      }
      default:
        break;
    }
  }

  const activeId =
    visible && suggestions.length > 0 ? `${listId}-option-${activeIndex}` : undefined;

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
        placeholder="住所・駅・工事件名で検索"
        aria-label="工事を検索"
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
          {suggestions.length === 0 ? (
            <p className={styles.empty} role="status">
              該当なし：条件に合う工事が見つかりません
            </p>
          ) : (
            suggestions.map((suggestion, index) => {
              const project = suggestion.projectId
                ? getProjectById(suggestion.projectId)
                : undefined;
              return (
                <button
                  key={`${suggestion.kind}-${suggestion.title}-${suggestion.projectId}-${index}`}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`${styles.item} ${index === activeIndex ? styles.itemHl : ""}`}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySuggestion(suggestion)}
                >
                  <span
                    className={project ? statusPillClass(project.status) : "pill cat"}
                  >
                    {project ? statusLabel(project.status) : KIND_LABEL[suggestion.kind]}
                  </span>
                  <span className={styles.text}>
                    <span className={styles.title}>{suggestion.title}</span>
                    <span className={styles.sub}>{suggestion.subtitle}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
