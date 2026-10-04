/**
 * 地理演算のフォールバック実装（PostGIS が使えない環境での空間検索）。
 */
import { describe, expect, it } from "vitest";

import { distanceMeters, distanceToLineString, pointInPolygon } from "@/lib/geo/measure";

/** 東京駅付近の 100m 四方（おおよそ） */
const SQUARE = {
  type: "Polygon" as const,
  coordinates: [
    [
      [139.7665, 35.6813],
      [139.7675, 35.6813],
      [139.7675, 35.6807],
      [139.7665, 35.6807],
      [139.7665, 35.6813],
    ],
  ],
};

describe("pointInPolygon", () => {
  it("内側の点を内側と判定する", () => {
    expect(pointInPolygon(139.767, 35.681, SQUARE)).toBe(true);
  });

  it("外側の点を外側と判定する", () => {
    expect(pointInPolygon(139.77, 35.681, SQUARE)).toBe(false);
    expect(pointInPolygon(139.767, 35.69, SQUARE)).toBe(false);
  });

  it("穴の内側は外側として扱う", () => {
    const withHole = {
      type: "Polygon" as const,
      coordinates: [
        SQUARE.coordinates[0],
        [
          [139.7668, 35.6811],
          [139.7672, 35.6811],
          [139.7672, 35.6809],
          [139.7668, 35.6809],
          [139.7668, 35.6811],
        ],
      ],
    };
    expect(pointInPolygon(139.767, 35.681, withHole)).toBe(false);
    expect(pointInPolygon(139.7666, 35.6812, withHole)).toBe(true);
  });

  it("MultiPolygon のいずれかに含まれれば true", () => {
    const multi = {
      type: "MultiPolygon" as const,
      coordinates: [
        SQUARE.coordinates,
        [
          [
            [139.8, 35.7],
            [139.81, 35.7],
            [139.81, 35.69],
            [139.8, 35.69],
            [139.8, 35.7],
          ],
        ],
      ],
    };
    expect(pointInPolygon(139.805, 35.695, multi)).toBe(true);
    expect(pointInPolygon(139.79, 35.695, multi)).toBe(false);
  });
});

describe("distanceMeters", () => {
  it("既知のおおよその距離を返す（東京〜大阪 約400km）", () => {
    const distance = distanceMeters(139.7671, 35.6812, 135.4959, 34.7024);
    expect(distance).toBeGreaterThan(390_000);
    expect(distance).toBeLessThan(410_000);
  });

  it("同一地点は 0", () => {
    expect(distanceMeters(139.7671, 35.6812, 139.7671, 35.6812)).toBeCloseTo(0, 6);
  });
});

describe("distanceToLineString", () => {
  it("線分上の点はほぼ 0", () => {
    const line = [
      [139.7665, 35.681],
      [139.7675, 35.681],
    ];
    expect(distanceToLineString(139.767, 35.681, line)).toBeLessThan(1);
  });

  it("線分から離れた点は距離を返す", () => {
    const line = [
      [139.7665, 35.681],
      [139.7675, 35.681],
    ];
    const distance = distanceToLineString(139.767, 35.682, line);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});
