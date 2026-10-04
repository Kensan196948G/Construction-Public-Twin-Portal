/**
 * 公的ジオコーダー: 国土地理院 住所検索API
 *
 *   GET https://msearch.gsi.go.jp/address-search/AddressSearch?q=<住所>
 *
 * 実測に基づく仕様（このモジュールが守る前提）:
 *   - 応答は **FeatureCollection ではなく素の配列**。
 *   - `geometry.coordinates` は GeoJSON 準拠で `[経度, 緯度]`。
 *   - `properties` は `title` と `addressCode` のみ。**id は無い**。
 *   - `title` は全角数字で返り、**号は切り捨てられる**ことが多い。
 *   - 存在しない番地でも 200 で親レベルの代表点を返す（無言フォールバック）。
 *   - API キー・登録は不要。CORS は `Access-Control-Allow-Origin: *`。
 *
 * したがって本モジュールは
 *   1) 入力より浅いレベルで返ってきた候補に警告を付け、
 *   2) 入力の都道府県＋市区町村を含まない候補（語句の誤マッチ）を除外し、
 *   3) 短時間のキャッシュでAPIを叩きすぎない
 * という 3 点を必ず行う。
 *
 * サーバー専用（`app/api/geocode/route.ts` からのみ呼ぶ）。
 */
import {
  ADDRESS_PRECISION_LABEL,
  normalizeAddress,
  precisionOf,
  sharesMunicipality,
  validateGeocode,
  type AddressPrecision,
} from "@/lib/geo/address";

/** 出典表示（加工しているため「加工して作成」を付す） */
export const GSI_GEOCODER_ATTRIBUTION =
  "出典：国土地理院ウェブサイト（https://msearch.gsi.go.jp/address-search/AddressSearch）（国土地理院の住所検索結果を加工して作成）";

export const GSI_GEOCODER_SOURCE = {
  provider: "国土地理院",
  dataset: "住所検索API（地名検索）",
  license: "公共データ利用規約（第1.0版）",
  url: "https://msearch.gsi.go.jp/address-search/AddressSearch",
} as const;

const ENDPOINT = "https://msearch.gsi.go.jp/address-search/AddressSearch";
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

/* ------------------------------------------------------------------ *
 * 型
 * ------------------------------------------------------------------ */

export interface GeocodeCandidate {
  /** GSI は id を返さないため、表題と座標から決定的に生成する */
  id: string;
  title: string;
  longitude: number;
  latitude: number;
  precision: AddressPrecision;
  precisionLabel: string;
  /** 入力の粒度まで到達したか（false = 親レベルまでの一致） */
  resolvedToRequested: boolean;
  /** 到達しなかった場合の日本語の説明 */
  note?: string;
}

export interface GeocodeOutcome {
  query: string;
  normalizedQuery: string;
  count: number;
  candidates: GeocodeCandidate[];
  /** ジオコーダーに到達できなかった場合の説明（日本語） */
  error?: string;
  /** 無言フォールバック等で候補を落とした件数 */
  filteredOut: number;
  attribution: string;
  source: typeof GSI_GEOCODER_SOURCE;
}

/* ------------------------------------------------------------------ *
 * キャッシュ
 * ------------------------------------------------------------------ */

interface CacheEntry {
  expiresAt: number;
  outcome: GeocodeOutcome;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): GeocodeOutcome | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.outcome;
}

function cacheSet(key: string, outcome: GeocodeOutcome): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // 最も古いエントリを捨てる（Map は挿入順）
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, outcome });
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

/** GSI 応答の最小検証 */
function parseFeatures(payload: unknown): { title: string; longitude: number; latitude: number }[] {
  if (!Array.isArray(payload)) return [];
  const out: { title: string; longitude: number; latitude: number }[] = [];
  for (const item of payload) {
    if (typeof item !== "object" || item === null) continue;
    const feature = item as {
      geometry?: { coordinates?: unknown; type?: unknown };
      properties?: { title?: unknown };
    };
    const coordinates = feature.geometry?.coordinates;
    const title = feature.properties?.title;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [longitude, latitude] = coordinates;
    if (typeof longitude !== "number" || typeof latitude !== "number") continue;
    if (typeof title !== "string" || title.length === 0) continue;
    out.push({ title, longitude, latitude });
  }
  return out;
}

/** 表題と座標から決定的な id を作る */
function candidateId(title: string, longitude: number, latitude: number): string {
  const text = `${title}|${longitude.toFixed(6)}|${latitude.toFixed(6)}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `gsi-${(hash >>> 0).toString(16)}`;
}

function emptyOutcome(query: string, error?: string, filteredOut = 0): GeocodeOutcome {
  return {
    query,
    normalizedQuery: normalizeAddress(query),
    count: 0,
    candidates: [],
    error,
    filteredOut,
    attribution: GSI_GEOCODER_ATTRIBUTION,
    source: GSI_GEOCODER_SOURCE,
  };
}

/**
 * 住所文字列を緯度経度へ変換する。
 *
 * 失敗しても例外を投げない（外部サービス障害で画面を落とさない）。
 * 到達不能・タイムアウトの場合は `error` に日本語の説明を入れて返す。
 */
export async function geocodeAddress(query: string, limit = 6): Promise<GeocodeOutcome> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return emptyOutcome(trimmed);

  const cacheKey = `${trimmed}::${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let payload: unknown;
  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return emptyOutcome(
        trimmed,
        `住所検索サービスが応答しませんでした（HTTP ${response.status}）。時間をおいて再度お試しください。`,
      );
    }
    payload = await response.json();
  } catch {
    return emptyOutcome(
      trimmed,
      "住所検索サービスへ接続できませんでした。ネットワーク状況を確認してください。",
    );
  }

  const features = parseFeatures(payload);

  // 語句の部分一致で無関係な地点が混ざるため、都道府県＋市区町村の一致を必須にする。
  const relevant = features.filter((f) => sharesMunicipality(trimmed, f.title));
  let filteredOut = features.length - relevant.length;

  const candidates = relevant.map((feature) => {
    const validation = validateGeocode(trimmed, feature.title);
    const precision = precisionOf(feature.title);
    return {
      id: candidateId(feature.title, feature.longitude, feature.latitude),
      title: feature.title,
      longitude: feature.longitude,
      latitude: feature.latitude,
      precision: validation.precision,
      precisionLabel: ADDRESS_PRECISION_LABEL[validation.precision],
      resolvedToRequested: validation.ok,
      note: validation.note,
    } satisfies GeocodeCandidate;
  });

  // 入力の粒度まで到達した候補を先頭へ。同順位は表題の長い順（＝詳細な順）。
  candidates.sort((a, b) => {
    if (a.resolvedToRequested !== b.resolvedToRequested) return a.resolvedToRequested ? -1 : 1;
    return b.title.length - a.title.length;
  });

  const outcome: GeocodeOutcome = {
    query: trimmed,
    normalizedQuery: normalizeAddress(trimmed),
    count: candidates.length,
    candidates: candidates.slice(0, limit),
    filteredOut,
    attribution: GSI_GEOCODER_ATTRIBUTION,
    source: GSI_GEOCODER_SOURCE,
  };

  if (outcome.count === 0) {
    filteredOut += 1;
  }

  cacheSet(cacheKey, outcome);
  return outcome;
}

/** テスト用: キャッシュを空にする */
export function clearGeocodeCache(): void {
  cache.clear();
}
