/**
 * 公的ジオコーダー（国土地理院 住所検索API）連携の検証。
 *
 * 実際の GSI 応答（素の配列・全角数字・号の切り捨て・親レベルへの無言フォールバック）を
 * 模した応答を fetch に差し込み、Route Handler の振る舞いを確認する。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as geocodeRoute from "@/app/api/geocode/route";
import { clearGeocodeCache, geocodeAddress } from "@/lib/geo/gsi";

/** GSI の実応答形（FeatureCollection ではなく素の配列） */
function gsiResponse(
  features: { title: string; coordinates: [number, number] }[],
): Response {
  return new Response(
    JSON.stringify(
      features.map((f) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: f.coordinates },
        properties: { addressCode: "", title: f.title },
      })),
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  clearGeocodeCache();
  vi.unstubAllGlobals();
});

describe("geocodeAddress", () => {
  it("経度緯度の順序を保って候補を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        gsiResponse([
          { title: "東京都千代田区丸の内一丁目９番", coordinates: [139.767242, 35.681252] },
        ]),
      ),
    );

    const outcome = await geocodeAddress("東京都千代田区丸の内一丁目9番1号");
    expect(outcome.count).toBe(1);
    expect(outcome.candidates[0].longitude).toBeCloseTo(139.767242, 6);
    expect(outcome.candidates[0].latitude).toBeCloseTo(35.681252, 6);
    expect(outcome.attribution).toContain("国土地理院");
  });

  it("号まで到達しなかった候補に警告を付ける（親レベルフォールバック）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        gsiResponse([
          { title: "東京都千代田区丸の内一丁目", coordinates: [139.767, 35.681] },
        ]),
      ),
    );

    const outcome = await geocodeAddress("東京都千代田区丸の内一丁目99番99号");
    const candidate = outcome.candidates[0];
    expect(candidate.resolvedToRequested).toBe(false);
    expect(candidate.precision).toBe("chome");
    expect(candidate.note).toBeTruthy();
  });

  it("都道府県・市区町村が一致しない候補を除外する（語句の誤マッチ）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        gsiResponse([
          { title: "北海道札幌市東区東", coordinates: [141.35, 43.07] },
          { title: "東京都千代田区丸の内一丁目９番", coordinates: [139.767, 35.681] },
        ]),
      ),
    );

    const outcome = await geocodeAddress("東京都千代田区丸の内1-9-1");
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0].title).toContain("東京都");
    expect(outcome.filteredOut).toBeGreaterThanOrEqual(1);
  });

  it("外部サービスに到達できない場合でも例外を投げず error を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const outcome = await geocodeAddress("東京都千代田区丸の内1-9-1");
    expect(outcome.count).toBe(0);
    expect(outcome.error).toContain("接続");
  });

  it("HTTP エラーでも例外を投げない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const outcome = await geocodeAddress("東京都千代田区丸の内1-9-1");
    expect(outcome.count).toBe(0);
    expect(outcome.error).toContain("503");
  });
});

describe("GET /api/geocode", () => {
  it("クエリ不正は 400 と { error } を返す", async () => {
    const response = await geocodeRoute.GET(
      new Request("http://localhost/api/geocode?q="),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("住所を指定すると候補を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        gsiResponse([
          { title: "東京都千代田区丸の内一丁目９番", coordinates: [139.767242, 35.681252] },
        ]),
      ),
    );

    const response = await geocodeRoute.GET(
      new Request(
        `http://localhost/api/geocode?q=${encodeURIComponent("東京都千代田区丸の内一丁目9番")}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      count: number;
      candidates: { title: string }[];
      source: { provider: string };
    };
    expect(body.count).toBe(1);
    expect(body.candidates[0].title).toContain("丸の内");
    expect(body.source.provider).toBe("国土地理院");
  });
});
