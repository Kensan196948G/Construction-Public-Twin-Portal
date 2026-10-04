/**
 * 自社現場台帳（Site Ledger）のスキーマ。
 *
 * 目的:
 *   工事台帳として「現場ID・工事件名・発注番号・発注者・元請・JV・工種・工期」で
 *   検索できるようにする。PostGIS（twin.construction_projects）と
 *   同一の項目構成を持ち、DB 未接続時はこのスキーマで静的データから組み立てる。
 *
 * 注意（正直な表示のための約束）:
 *   本 MVP のサンプル案件には 発注番号・JV・工種細分類 の実データが無い。
 *   これらは現場IDから **決定的に生成** した補完値であり、
 *   `isSample: true` として画面にもその旨を表示する。
 *   実データを接続する場合は `derivedLedgerFields()` の戻り値を差し替えるだけでよい。
 */
import { z } from "zod";

import { projectSchema, type Project } from "@/lib/schemas/project";

export const siteLedgerSchema = z.object({
  /* 識別 */
  projectId: z.string().min(1),
  slug: z.string().min(1),
  /** 発注番号（自社台帳の管理番号） */
  orderNo: z.string().min(1),

  /* 名称・分類 */
  officialName: z.string().min(1),
  publicTitle: z.string().min(1),
  category: z.string().min(1),
  /** 工種（細分類） */
  workType: z.string().min(1),
  siteType: z.string().min(1),

  /* 関係者 */
  ownerName: z.string().min(1),
  contractorName: z.string().min(1),
  /** JV。単独請負の場合は null。 */
  jvName: z.string().nullable(),

  /* 工期 */
  status: z.string().min(1),
  startDate: z.string().min(1),
  plannedEndDate: z.string().min(1),
  phase: z.string().min(1),
  lastUpdatedAt: z.string().min(1),

  /* 場所 */
  prefecture: z.string(),
  city: z.string(),
  ward: z.string(),
  town: z.string(),
  address: z.string().min(1),
  municipality: z.string().min(1),
  center: z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
  }),

  /* 公開・出典 */
  classification: z.string().min(1),
  publicationState: z.string().min(1),
  officialUrl: z.string().min(1),
  sourceProvider: z.string().min(1),

  /** 発注番号・JV・工種が MVP 用の生成値である場合 true */
  isSample: z.boolean(),
});

export type SiteLedgerEntry = z.infer<typeof siteLedgerSchema>;

/** 画面に必ず出す注記 */
export const LEDGER_SAMPLE_NOTE =
  "発注番号・JV・工種は、サンプル案件に実データが無いため現場IDから決定的に生成した補完値です。";

/* ------------------------------------------------------------------ *
 * 補完値の生成（db-ingest.mjs と同じ規則）
 * ------------------------------------------------------------------ */

const WORK_TYPE_BY_CATEGORY: Record<string, string> = {
  道路: "道路改良・舗装",
  広場: "広場・歩行者空間整備",
  下水道: "下水道管路更生",
  公園: "公園・緑地整備",
  "建築・都市部": "建築主体工事",
  "建築・地方": "建築主体工事",
  "土木・都市部": "土木構造物工事",
  "土木・地方": "土木構造物工事",
};

/** 現場ID から決定的に 5 桁の連番を作る */
export function sequenceFromId(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.codePointAt(0)!) % 100000;
  return String(hash).padStart(5, "0");
}

/** 発注番号: PRJ-<着工年>-<連番> */
export function orderNoOf(project: Project): string {
  const year = project.schedule.startDate.slice(0, 4);
  return `PRJ-${year}-${sequenceFromId(project.id)}`;
}

/** JV: 建築系のみ共同企業体として扱う（決定規則） */
export function jvNameOf(project: Project): string | null {
  if (!project.category.startsWith("建築")) return null;
  return `${project.contractor.name} 建設共同企業体`;
}

export function workTypeOf(project: Project): string {
  return WORK_TYPE_BY_CATEGORY[project.category] ?? "その他工事";
}

/**
 * Project（公開工事）から現場台帳の1行を組み立てる。
 * DB 未接続時のフォールバック検索と、投入データの整合確認の双方で使う。
 */
export function ledgerFromProject(project: Project): SiteLedgerEntry {
  const candidate = {
    projectId: project.id,
    slug: project.slug,
    orderNo: orderNoOf(project),
    officialName: project.name,
    publicTitle: project.publicTitle,
    category: project.category,
    workType: workTypeOf(project),
    siteType: project.siteType,
    ownerName: project.owner.name,
    contractorName: project.contractor.name,
    jvName: jvNameOf(project),
    status: project.status,
    startDate: project.schedule.startDate,
    plannedEndDate: project.schedule.plannedEndDate,
    phase: project.schedule.phase,
    lastUpdatedAt: project.schedule.lastUpdatedAt,
    prefecture: project.location.prefecture,
    city: project.location.city,
    ward: project.location.ward,
    town: project.location.town,
    address: project.location.address,
    municipality: project.location.municipality,
    center: project.location.center,
    classification: project.visibility.classification,
    publicationState: project.visibility.publicationState,
    officialUrl: project.source.officialUrl,
    sourceProvider: project.source.provider,
    isSample: true,
  };

  // 生成規則が壊れていないことを実行時に保証する（TST-001）。
  return siteLedgerSchema.parse(candidate);
}

/** テスト・整合確認用: Project スキーマも同時に検証する */
export function assertLedgerFromProject(project: unknown): SiteLedgerEntry {
  return ledgerFromProject(projectSchema.parse(project));
}
