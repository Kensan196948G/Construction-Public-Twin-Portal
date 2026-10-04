/**
 * 現場台帳・空間検索の**静的フォールバック**。
 *
 * PostGIS が未構成・到達不能・クエリ失敗のときに使う。
 * 検索項目と並び順は `lib/db/queries.ts` の SQL と同一の意味になるよう揃えてある
 * （DB の有無でユーザー体験が変わらないようにするため）。
 */
import { buildAllCollection, type GeometryKind } from "@/lib/data/geometry";
import { publicProjects } from "@/lib/data/projects";
import { distanceMeters, distanceToLineString, pointInPolygon } from "@/lib/geo/measure";
import {
  ledgerFromProject,
  type SiteLedgerEntry,
} from "@/lib/schemas/ledger";
import type { LedgerFacets, LedgerQuery, LedgerQueryResult } from "@/lib/db/queries";

/** 台帳の静的版（公開案件のみ） */
export function staticLedgerEntries(): SiteLedgerEntry[] {
  return publicProjects().map(ledgerFromProject);
}

/** 状態の並び順（SQL の CASE と一致させる） */
const STATUS_ORDER: Record<string, number> = {
  under_construction: 0,
  planned: 1,
  completed: 2,
  suspended: 3,
};

function includesKeyword(entry: SiteLedgerEntry, keyword: string): boolean {
  const haystack = [
    entry.officialName,
    entry.publicTitle,
    entry.address,
    entry.municipality,
    entry.ownerName,
    entry.contractorName,
    entry.jvName ?? "",
    entry.orderNo,
    entry.projectId,
    entry.workType,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

export function searchStaticLedger(input: LedgerQuery): LedgerQueryResult {
  let entries = staticLedgerEntries();

  if (input.keyword) {
    const keyword = input.keyword.trim();
    if (keyword) entries = entries.filter((e) => includesKeyword(e, keyword));
  }
  if (input.category) entries = entries.filter((e) => e.category === input.category);
  if (input.status) entries = entries.filter((e) => e.status === input.status);
  if (input.municipality) entries = entries.filter((e) => e.municipality === input.municipality);
  if (input.owner) {
    const owner = input.owner.toLowerCase();
    entries = entries.filter((e) => e.ownerName.toLowerCase().includes(owner));
  }
  if (input.contractor) {
    const contractor = input.contractor.toLowerCase();
    entries = entries.filter((e) => e.contractorName.toLowerCase().includes(contractor));
  }
  if (input.workType) {
    const workType = input.workType.toLowerCase();
    entries = entries.filter((e) => e.workType.toLowerCase().includes(workType));
  }
  if (input.jvOnly) entries = entries.filter((e) => e.jvName !== null);
  if (input.from) entries = entries.filter((e) => e.startDate >= input.from!);
  if (input.to) entries = entries.filter((e) => e.startDate <= input.to!);

  entries.sort((a, b) => {
    const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (s !== 0) return s;
    const d = b.startDate.localeCompare(a.startDate);
    if (d !== 0) return d;
    return a.projectId.localeCompare(b.projectId);
  });

  const total = entries.length;
  return { entries: entries.slice(input.offset, input.offset + input.limit), total };
}

export function staticLedgerFacets(): LedgerFacets {
  const entries = staticLedgerEntries();
  const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "ja"));
  return {
    categories: unique(entries.map((e) => e.category)),
    statuses: unique(entries.map((e) => e.status)),
    municipalities: unique(entries.map((e) => e.municipality)),
    owners: unique(entries.map((e) => e.ownerName)),
    contractors: unique(entries.map((e) => e.contractorName)),
    workTypes: unique(entries.map((e) => e.workType)),
  };
}

/* ------------------------------------------------------------------ *
 * 空間検索（フォールバック）
 * ------------------------------------------------------------------ */

export interface StaticNearbyItem {
  projectId: string;
  publicTitle: string;
  officialName: string;
  category: string;
  status: string;
  municipality: string;
  address: string;
  distanceM: number;
  insideWorkZone: boolean;
}

/** 代表点までの距離で近傍案件を返す */
export function staticNearby(
  longitude: number,
  latitude: number,
  radiusM: number,
  limit: number,
): StaticNearbyItem[] {
  const workZones = buildAllCollection(["workzone"]);

  return publicProjects()
    .map((project) => {
      const distance = distanceMeters(
        longitude,
        latitude,
        project.location.center.longitude,
        project.location.center.latitude,
      );
      const feature = workZones.features.find((f) => f.properties.projectId === project.id);
      const geometry = feature?.geometry;
      const inside =
        geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
          ? pointInPolygon(longitude, latitude, geometry)
          : false;
      return {
        projectId: project.id,
        publicTitle: project.publicTitle,
        officialName: project.name,
        category: project.category,
        status: project.status,
        municipality: project.location.municipality,
        address: project.location.address,
        distanceM: distance,
        insideWorkZone: inside,
      };
    })
    .filter((item) => item.distanceM <= radiusM || item.insideWorkZone)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/** 点が地物に含まれるか（線形は近傍 15m 以内を「含む」とみなす） */
const LINE_TOLERANCE_M = 15;

export interface StaticContainingItem {
  featureId: string;
  projectId: string;
  featureKind: string;
  name: string;
  geometryType: string;
  distanceM: number;
}

export function staticContaining(
  longitude: number,
  latitude: number,
  kinds: GeometryKind[] | null,
  limit: number,
): StaticContainingItem[] {
  const targetKinds: GeometryKind[] = kinds ?? ["workzone", "regulation", "detour", "pedestrian"];
  const collection = buildAllCollection(targetKinds);
  const out: StaticContainingItem[] = [];

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      if (pointInPolygon(longitude, latitude, geometry)) {
        out.push({
          featureId: String(feature.id ?? feature.properties.id),
          projectId: feature.properties.projectId,
          featureKind: feature.properties.type,
          name: feature.properties.name,
          geometryType: geometry.type,
          distanceM: 0,
        });
      }
      continue;
    }

    if (geometry.type === "LineString") {
      const distance = distanceToLineString(longitude, latitude, geometry.coordinates);
      if (distance <= LINE_TOLERANCE_M) {
        out.push({
          featureId: String(feature.id ?? feature.properties.id),
          projectId: feature.properties.projectId,
          featureKind: feature.properties.type,
          name: feature.properties.name,
          geometryType: geometry.type,
          distanceM: distance,
        });
      }
    }
  }

  return out
    .sort((a, b) => a.featureKind.localeCompare(b.featureKind) || a.featureId.localeCompare(b.featureId))
    .slice(0, limit);
}
