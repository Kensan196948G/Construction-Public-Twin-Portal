"use client";

/**
 * 施工状態フィルタチップ（すべて / 施工中 / 着工前 / 規制中 / 完成）。
 *
 * 設計の正: `WebUI/koji-mieru-map-3d.html` の `.fchip`（`data-f` で色ドットを出す）。
 * 件数バッジは `lib/data/projects.ts` / `lib/data/filter.ts` の純粋関数から算出する。
 */
import { useMemo, type ReactElement } from "react";

import { projectIdsWithActiveImpact } from "@/lib/data/impacts";
import { filterProjects } from "@/lib/data/filter";
import { publicProjects } from "@/lib/data/projects";
import { useAppStore } from "@/lib/store/useAppStore";

import styles from "./ProjectFilter.module.css";

type ChipId = "all" | "active" | "planned" | "reg" | "done";

interface ChipDef {
  id: ChipId;
  label: string;
  /** `.fchip[data-f="..."]` に対応（globals.css の色ドット定義） */
  dataF: string;
}

/** 表示順は要件どおり: すべて / 施工中 / 着工前 / 規制中 / 完成 */
const CHIPS: readonly ChipDef[] = [
  { id: "all", label: "すべて", dataF: "all" },
  { id: "active", label: "施工中", dataF: "active" },
  { id: "planned", label: "着工前", dataF: "planned" },
  { id: "reg", label: "規制中", dataF: "reg" },
  { id: "done", label: "完成", dataF: "done" },
];

export function ProjectFilter(): ReactElement {
  const selectedStatus = useAppStore((s) => s.selectedStatus);
  const regulatingOnly = useAppStore((s) => s.regulatingOnly);
  const searchKeyword = useAppStore((s) => s.searchKeyword);
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const viewTime = useAppStore((s) => s.viewTime);
  const setStatus = useAppStore((s) => s.setStatus);
  const setRegulatingOnly = useAppStore((s) => s.setRegulatingOnly);

  /* 検索語・工種で絞った母数に対する件数を出す（チップが現在の文脈を示す） */
  const base = useMemo(
    () =>
      filterProjects(publicProjects(), {
        keyword: searchKeyword,
        category: selectedCategory,
      }),
    [searchKeyword, selectedCategory],
  );

  const counts = useMemo(() => {
    const regulating = projectIdsWithActiveImpact(new Date(viewTime));
    return {
      all: base.length,
      active: base.filter((p) => p.status === "under_construction").length,
      planned: base.filter((p) => p.status === "planned").length,
      done: base.filter((p) => p.status === "completed").length,
      reg: base.filter((p) => regulating.has(p.id)).length,
    } satisfies Record<ChipId, number>;
  }, [base, viewTime]);

  const activeChip: ChipId = regulatingOnly
    ? "reg"
    : selectedStatus === "under_construction"
      ? "active"
      : selectedStatus === "planned"
        ? "planned"
        : selectedStatus === "completed"
          ? "done"
          : "all";

  function applyChip(id: ChipId) {
    switch (id) {
      case "active":
        setRegulatingOnly(false);
        setStatus("under_construction");
        break;
      case "planned":
        setRegulatingOnly(false);
        setStatus("planned");
        break;
      case "done":
        setRegulatingOnly(false);
        setStatus("completed");
        break;
      case "reg":
        // 「規制中」は状態ではなく時間条件（viewTime に有効な Impact）で絞る
        setStatus(null);
        setRegulatingOnly(true);
        break;
      default:
        setStatus(null);
        setRegulatingOnly(false);
        break;
    }
  }

  return (
    <div className={styles.filters} role="group" aria-label="施工状態で絞り込む">
      {CHIPS.map((chip) => {
        const active = activeChip === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            className={`fchip ${active ? "active" : ""}`}
            data-f={chip.dataF}
            aria-pressed={active}
            onClick={() => applyChip(chip.id)}
          >
            <span className="fa" aria-hidden="true" />
            {chip.label}
            <span className="fc-n num">{counts[chip.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
