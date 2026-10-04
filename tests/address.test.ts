/**
 * 住所の正規化とジオコーダー結果の検証（TST-001 の一部）。
 *
 * 国土地理院 住所検索API の実際の挙動（全角数字・号の切り捨て・
 * 存在しない番地でも親レベルを返す）に対する防御を検証する。
 */
import { describe, expect, it } from "vitest";

import {
  ADDRESS_PRECISION_LABEL,
  addressKey,
  municipalityOf,
  normalizeAddress,
  precisionOf,
  prefectureOf,
  sharesMunicipality,
  validateGeocode,
} from "@/lib/geo/address";

describe("normalizeAddress", () => {
  it("全角数字と空白を正規化する", () => {
    expect(normalizeAddress("東京都千代田区丸の内一丁目９番１号")).toBe(
      "東京都千代田区丸の内1-9-1",
    );
    expect(normalizeAddress("東京都 千代田区 丸の内 1-9-1")).toBe("東京都千代田区丸の内1-9-1");
    expect(normalizeAddress("東京都\u3000千代田区")).toBe("東京都千代田区");
  });

  it("ハイフン表記と漢数字表記を同じキーへ寄せる", () => {
    expect(normalizeAddress("丸の内1-9-1")).toBe(normalizeAddress("丸の内一丁目九番一号"));
    expect(normalizeAddress("丸の内1-9")).toBe(normalizeAddress("丸の内一丁目九番"));
  });

  it("番地・番の表記ゆれを吸収する", () => {
    expect(normalizeAddress("丸の内1番地")).toBe(normalizeAddress("丸の内1番"));
  });

  it("ヶ/ケ/が の表記ゆれを吸収する（台帳照合用）", () => {
    expect(normalizeAddress("霞ヶ関")).toBe(normalizeAddress("霞ケ関"));
    expect(normalizeAddress("霞が関")).toBe(normalizeAddress("霞ケ関"));
  });

  it("空文字は空文字のまま", () => {
    expect(normalizeAddress("")).toBe("");
    expect(normalizeAddress("   ")).toBe("");
  });
});

describe("addressKey / 都道府県・市区町村の抽出", () => {
  it("都道府県の表記差を落とす", () => {
    expect(addressKey("東京都千代田区")).toBe(addressKey("東京千代田区"));
  });

  it("都道府県と市区町村を取り出す", () => {
    expect(prefectureOf("東京都千代田区丸の内1-9-1")).toBe("東京都");
    expect(municipalityOf("東京都千代田区丸の内1-9-1")).toBe("千代田区");
    expect(prefectureOf("大阪府大阪市北区")).toBe("大阪府");
    expect(municipalityOf("大阪府大阪市北区")).toBe("大阪市");
  });
});

describe("precisionOf", () => {
  it("ジオコーダーの表題から粒度を推定する", () => {
    expect(precisionOf("東京都千代田区丸の内一丁目９番")).toBe("block");
    expect(precisionOf("東京都千代田区丸の内一丁目")).toBe("chome");
    expect(precisionOf("東京都千代田区丸の内")).toBe("town");
    expect(precisionOf("東京都千代田区")).toBe("municipality");
    expect(precisionOf("東京都")).toBe("prefecture");
    expect(precisionOf("東京都千代田区丸の内一丁目1番1号")).toBe("parcel");
  });

  it("粒度のラベルが日本語で引ける", () => {
    expect(ADDRESS_PRECISION_LABEL.block).toBe("番地");
  });
});

describe("validateGeocode（無言の親レベルフォールバック対策）", () => {
  it("入力より浅いレベルで返ってきた場合は ok=false と説明を返す", () => {
    const result = validateGeocode(
      "東京都千代田区丸の内一丁目99番99号",
      "東京都千代田区丸の内一丁目",
    );
    expect(result.ok).toBe(false);
    expect(result.precision).toBe("chome");
    expect(result.note).toContain("丁目");
  });

  it("入力の粒度まで到達していれば ok=true", () => {
    const result = validateGeocode(
      "東京都千代田区丸の内一丁目9番",
      "東京都千代田区丸の内一丁目９番",
    );
    expect(result.ok).toBe(true);
    expect(result.precision).toBe("block");
  });

  it("入力が表題で始まる場合（より詳細な入力）は許容する", () => {
    const result = validateGeocode(
      "東京都千代田区丸の内一丁目9番1号",
      "東京都千代田区丸の内一丁目９番",
    );
    expect(result.ok).toBe(true);
  });
});

describe("sharesMunicipality（語句の誤マッチ除外）", () => {
  it("都道府県も市区町村も一致しない候補を落とす", () => {
    expect(sharesMunicipality("東京都千代田区丸の内", "北海道札幌市東区東")).toBe(false);
    expect(sharesMunicipality("東京都千代田区丸の内", "東京都千代田区丸の内一丁目")).toBe(true);
  });

  it("都道府県が特定できない入力では判定しない", () => {
    expect(sharesMunicipality("丸の内", "どこか")).toBe(true);
  });
});
