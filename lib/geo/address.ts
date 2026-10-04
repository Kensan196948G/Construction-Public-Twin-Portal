/**
 * 日本の住所の正規化と、ジオコーダー結果の検証。
 *
 * 背景（実測に基づく）:
 *   国土地理院 住所検索API は 都道府県 / 市区町村 / 町名 / 丁目 / 番地 までは解決するが、
 *   **号は原則として解決しない**。しかも存在しない番地を投げても
 *   エラーにせず「親レベル（例: 一丁目）の代表点」を 200 で返す。
 *   そのため「返ってきた表題が入力の途中までで切れていないか」を必ず検査する。
 *
 * このモジュールは純関数のみで構成し、単体テスト（TST-001）から直接呼べるようにする。
 */

/* ------------------------------------------------------------------ *
 * 正規化
 * ------------------------------------------------------------------ */

/** 漢数字 → アラビア数字（住所で現れる範囲のみ） */
const KANJI_DIGITS: Record<string, string> = {
  〇: "0", 零: "0", 一: "1", 壱: "1", 二: "2", 弐: "2", 三: "3", 参: "3",
  四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10",
};

/**
 * 全角数字の正規化と漢数字のアラビア数字化のみを行う。
 * 丁目・番・号などの**接尾辞は保持**するため、住所の粒度判定に使える。
 */
export function foldDigits(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/[〇零一壱二弐三参四五六七八九十]/g, (c) => KANJI_DIGITS[c] ?? c);
}

/**
 * 丁目・番地・号の表記ゆれを吸収する。
 *
 * 例:
 *   東京都千代田区丸の内一丁目９番１号 → 東京都千代田区丸の内1-9-1
 *   丸の内1-9-1                       → 東京都…（都道府県が無ければそのまま）丸の内1-9-1
 *   霞ケ関 / 霞ヶ関 / 霞が関           → 霞ケ関
 */
export function normalizeAddress(input: string): string {
  if (!input) return "";

  let value = input.normalize("NFKC");

  // 全角・半角スペースを除去（GSI は空白を無視する）
  value = value.replace(/[\s\u3000]+/g, "");

  // 漢数字をアラビア数字へ（「十」は単独では 10 だが住所では 十番 等）
  value = value.replace(/[〇零一壱二弐三参四五六七八九十]/g, (c) => KANJI_DIGITS[c] ?? c);

  // 丁目・番地・番・号・号室の表記を `-` 区切りへ寄せる
  value = value.replace(/丁目/g, "-");
  value = value.replace(/番地/g, "-");
  value = value.replace(/番/g, "-");
  value = value.replace(/号/g, "-");
  // 連続する区切りを1つへ。末尾の区切りは落とす。
  value = value.replace(/-+/g, "-").replace(/^-|-$/g, "");

  // 表記ゆれ（カタカナ・ひらがな・漢字）
  value = value.replace(/[ヶケがカヵ]/g, "ケ");
  value = value.replace(/[ノ之]/g, "ノ");

  return value.toLowerCase();
}

/**
 * 比較用のキー。正規化に加えて都道府県の表記ゆれも落とす。
 * 台帳検索（AND 検索）ではこのキー同士で比較する。
 */
export function addressKey(input: string): string {
  return normalizeAddress(input)
    .replace(/東京都/g, "東京")
    .replace(/北海道/g, "北海")
    .replace(/[都府県]$/g, "");
}

/* ------------------------------------------------------------------ *
 * 構造の抽出
 * ------------------------------------------------------------------ */

/** 住所の粒度 */
export const ADDRESS_PRECISIONS = [
  "prefecture",
  "municipality",
  "town",
  "chome",
  "block",
  "parcel",
  "unknown",
] as const;
export type AddressPrecision = (typeof ADDRESS_PRECISIONS)[number];

export const ADDRESS_PRECISION_LABEL: Record<AddressPrecision, string> = {
  prefecture: "都道府県",
  municipality: "市区町村",
  town: "町名",
  chome: "丁目",
  block: "番地",
  parcel: "号",
  unknown: "不明",
};

/** 住所文字列から都道府県を推定する */
export function prefectureOf(address: string): string | null {
  const m = address.normalize("NFKC").match(/^(.{2,4}?[都道府県])/);
  return m ? m[1] : null;
}

/** 住所文字列から市区町村を推定する */
export function municipalityOf(address: string): string | null {
  const m = address.normalize("NFKC").match(/^.{2,4}?[都道府県](.+?[市区町村])/);
  return m ? m[1] : null;
}

/**
 * ジオコーダーが返した表題から住所の粒度を推定する。
 * 「号まで解決した」と誤って表示しないための判定に使う。
 *
 * 表題は全角数字・漢数字で返るため、数字だけを折りたたんでから判定する。
 */
export function precisionOf(title: string): AddressPrecision {
  const value = foldDigits(title).replace(/[\s\u3000]/g, "");
  if (!value) return "unknown";
  if (/[0-9]+号/.test(value)) return "parcel";
  if (/[0-9]+番地?/.test(value)) return "block";
  if (/[0-9]+丁目/.test(value)) return "chome";
  if (/[市区町村]$/.test(value) && !/郡/.test(value)) {
    return /[都道府県].+[市区町村]$/.test(value) ? "municipality" : "town";
  }
  if (/[都道府県]$/.test(value)) return "prefecture";
  return "town";
}

/* ------------------------------------------------------------------ *
 * 検証（無言の親レベルフォールバック対策）
 * ------------------------------------------------------------------ */

export interface GeocodeValidation {
  /** 入力の粒度まで到達しているか */
  ok: boolean;
  /** 到達した粒度 */
  precision: AddressPrecision;
  /** 入力より浅いレベルで返ってきた場合の説明（日本語） */
  note?: string;
}

/**
 * ジオコーダーの返答が「入力の途中までで切れていないか」を検査する。
 *
 * GSI は存在しない番地でも親レベルの代表点を 200 で返すため、
 * 到達したレベルの数を比較して判定する。
 *
 *   入力 … 丁目-番-号 の 3 レベル
 *   表題 … 丁目-番 までの 2 レベル
 *   → 号は GSI が解決しない仕様なので **問題なし**
 *
 *   入力 … 丁目99番99号
 *   表題 … 丁目まで
 *   → 番が解決できていない = **親レベルへの無言フォールバック**なので警告
 */
export function validateGeocode(input: string, title: string): GeocodeValidation {
  const precision = precisionOf(title);
  const normalizedInput = normalizeAddress(input);
  const normalizedTitle = normalizeAddress(title);

  if (!normalizedTitle) {
    return { ok: false, precision: "unknown", note: "ジオコーダーが住所を解決できませんでした。" };
  }

  const inputParts = normalizedInput.split("-").filter(Boolean);
  const titleParts = normalizedTitle.split("-").filter(Boolean);
  // 号（3 レベル目）は GSI が解決しないため、要求レベルから外す。
  const inputHasParcel = inputParts.length >= 3;
  const required = inputHasParcel ? inputParts.slice(0, -1) : inputParts;

  const reachedAllLevels =
    required.length > 0 &&
    titleParts.length >= required.length &&
    required.every((segment, index) => titleParts[index] === segment);
  // 都道府県を省略した入力（例「丸の内1-9-1」）にも対応する
  const titleEndsWithRequired = required.length > 0 && normalizedTitle.endsWith(required.join("-"));

  if (reachedAllLevels || titleEndsWithRequired) {
    return { ok: true, precision };
  }

  return {
    ok: false,
    precision,
    note: `${ADDRESS_PRECISION_LABEL[precision]}までの一致です。入力された番地・号は特定できませんでした。`,
  };
}

/**
 * 表題が入力の都道府県＋市区町村を含むか。
 * GSI は語句の部分一致で無関係な地点（例: 「東京駅」で北海道の「東」）を返すことがあるため、
 * 住所検索ではこの検査を通過したものだけを候補にする。
 */
export function sharesMunicipality(input: string, title: string): boolean {
  const pref = prefectureOf(input);
  const city = municipalityOf(input);
  if (!pref && !city) return true;
  const normalizedTitle = title.normalize("NFKC");
  if (pref && !normalizedTitle.includes(pref)) return false;
  if (city && !normalizedTitle.includes(city)) return false;
  return true;
}
