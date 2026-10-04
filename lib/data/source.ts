/**
 * 開発用サンプルデータの原表。
 *
 * 出典: WebUI/koji-mieru-map-3d.html（デザインハンドオフのプロトタイプ）
 * 設計契約「Preserve real copy, labels, and data shown in the export」に従い、
 * プロトタイプに埋め込まれていた案件名・目的・整備効果・発注者・工期・住所・
 * 写真クレジットをそのまま保持する。
 *
 * 注意: ここに定義された工事案件は **MVP 開発用のサンプル** であり、
 * 実在の工事・入札・公告ではない。写真のみ Wikimedia Commons の実在素材で、
 * クレジット（作者・ライセンス・原典URL）を保持している。
 */

/* ------------------------------------------------------------------ *
 * 基準点
 * ------------------------------------------------------------------ */

export const ORIGIN = { lon: 139.668, lat: 35.593 } as const;

/* ------------------------------------------------------------------ *
 * 明示定義の4案件（プロトタイプの PROJECTS）
 * ------------------------------------------------------------------ */

export interface RawProject {
  id: string;
  slug: string;
  status: string;
  category: string;
  siteType: string;
  name: string;
  publicTitle: string;
  purpose: string;
  benefits: string[];
  owner: string;
  contractor: string;
  start: string;
  end: string;
  phase: string;
  updated: string;
  lon: number;
  lat: number;
  /** ローカル座標の工区リング [x, z] */
  zone: [number, number][];
  /** 規制線分 */
  regulation: [number, number][] | null;
  /** 迂回ループ */
  detour: [number, number][] | null;
  /** 歩道切替線分 */
  pedestrian: [number, number][] | null;
  /** 完成予想の手続きモデル種別 */
  completion: string;
  floors?: number;
}

export const CURATED_PROJECTS: RawProject[] = [
  {
    id: "tokyo-demo-002",
    slug: "denenchofu-station-plaza",
    status: "under_construction",
    category: "広場",
    siteType: "civil-urban",
    name: "田園調布駅前広場整備工事",
    publicTitle: "駅前広場を歩行者中心に整える工事",
    purpose:
      "駅前の歩行空間を広げ、段差を解消してバリアフリー動線を確保します。通勤・通学時の安全性と回遊性を高めるための整備です。",
    benefits: ["広場の拡幅と段差の解消", "バス・タクシー乗降場の再配置", "緑陰・ベンチ・案内サインの整備"],
    owner: "大田区 建設部 まちづくり課",
    contractor: "田園調布建設株式会社",
    start: "2026-04-01",
    end: "2027-03-31",
    phase: "広場舗装・植栽工事",
    updated: "2026-10-04T07:00:00+09:00",
    lon: 139.668,
    lat: 35.593,
    zone: [
      [-72, -30],
      [46, -30],
      [46, 30],
      [-72, 30],
    ],
    regulation: [
      [-104, 0],
      [-12, 0],
    ],
    detour: [
      [-34, 36],
      [-34, 62],
      [22, 62],
      [22, 44],
    ],
    pedestrian: [
      [-84, 20],
      [44, 20],
    ],
    completion: "plaza",
  },
  {
    id: "tokyo-demo-001",
    slug: "denenchofu-road-improvement",
    status: "under_construction",
    category: "道路",
    siteType: "civil-urban",
    name: "田園調布地区 歩道整備工事",
    publicTitle: "駅周辺の歩道を広げる工事",
    purpose:
      "通学・通勤時の歩行の安全性を高め、段差を解消するための整備です。あわせて歩道の排水設備を更新します。",
    benefits: ["歩道の拡幅", "バリアフリー化", "横断歩道周辺の視認性改善"],
    owner: "大田区 建設部 道路課",
    contractor: "多摩川土木株式会社",
    start: "2026-05-15",
    end: "2027-01-31",
    phase: "歩道改良・排水設備工事",
    updated: "2026-10-03T18:30:00+09:00",
    lon: 139.67,
    lat: 35.5924,
    zone: [
      [-84, -13],
      [46, -13],
      [46, 13],
      [-84, 13],
    ],
    regulation: [
      [-96, 0],
      [56, 0],
    ],
    detour: null,
    pedestrian: [
      [-76, 14],
      [40, 14],
    ],
    completion: "sidewalk",
  },
  {
    id: "tokyo-demo-003",
    slug: "denenchofu-sewer-renewal",
    status: "planned",
    category: "下水道",
    siteType: "civil-urban",
    name: "田園調布駅周辺 下水道管更新工事",
    publicTitle: "古い下水道管を入れ替える工事",
    purpose:
      "老朽化した下水道管を耐震管に入れ替え、地震時の排水機能と道路の安全性を確保します。",
    benefits: ["耐震管への更新", "浸水リスクの低減", "マンホールの段差解消"],
    owner: "大田区 下水道部 管路課",
    contractor: "調整中",
    start: "2026-12-01",
    end: "2027-03-31",
    phase: "開削工事（準備期間を含む）",
    updated: "2026-10-01T09:00:00+09:00",
    lon: 139.6666,
    lat: 35.5941,
    zone: [
      [-26, -22],
      [26, -22],
      [26, 22],
      [-26, 22],
    ],
    regulation: [
      [-44, 0],
      [44, 0],
    ],
    detour: null,
    pedestrian: null,
    completion: "utility",
  },
  {
    id: "tokyo-demo-004",
    slug: "tamagawa-park-plaza",
    status: "completed",
    category: "公園",
    siteType: "civil-urban",
    name: "多摩川台公園 防災広場整備工事",
    publicTitle: "公園に防災広場をつくる工事",
    purpose: "災害時に一時避難できる広場と、かまどベンチ・防災倉庫を整備しました。",
    benefits: ["一時避難広場の確保", "かまどベンチ・防災倉庫", "園路のバリアフリー化"],
    owner: "大田区 都市整備部 公園課",
    contractor: "緑地建設株式会社",
    start: "2025-06-01",
    end: "2026-02-28",
    phase: "工事完了・供用中",
    updated: "2026-03-05T10:00:00+09:00",
    lon: 139.6695,
    lat: 35.5952,
    zone: [
      [-62, -46],
      [62, -46],
      [62, 46],
      [-62, 46],
    ],
    regulation: null,
    detour: null,
    pedestrian: [
      [-70, 30],
      [70, 30],
    ],
    completion: "park",
  },
];

/* ------------------------------------------------------------------ *
 * 影響イベント（プロトタイプの IMPACTS）
 * ------------------------------------------------------------------ */

export interface RawImpact {
  id: string;
  projectId: string;
  /** プロトタイプ表記の工種（日本語） */
  type: string;
  severity: "info" | "notice" | "warning";
  title: string;
  desc: string;
  from: string;
  to: string;
  rec: string;
  geom: "regulation" | "detour" | "pedestrian" | null;
}

export const CURATED_IMPACTS: RawImpact[] = [
  {
    id: "imp-002-sidewalk",
    projectId: "tokyo-demo-002",
    type: "歩道切替",
    severity: "notice",
    title: "駅前歩道の切替",
    desc: "駅前の歩道を仮設歩道へ切り替えます。幅員は確保していますが、朝夕は混雑します。",
    from: "2026-06-01",
    to: "2027-02-28",
    rec: "終日",
    geom: "pedestrian",
  },
  {
    id: "imp-002-night-lane",
    projectId: "tokyo-demo-002",
    type: "車線規制",
    severity: "warning",
    title: "夜間の片側交互通行",
    desc: "舗装工事のため、夜間に片側交互通行を実施します。誘導員が配置されます。",
    from: "2026-10-10",
    to: "2026-10-31",
    rec: "平日 21:00〜翌5:00",
    geom: "regulation",
  },
  {
    id: "imp-002-detour",
    projectId: "tokyo-demo-002",
    type: "迂回路",
    severity: "info",
    title: "駅前の迂回路",
    desc: "広場前の通りを通行止めにし、北側の市道へ迂回していただきます。",
    from: "2026-10-10",
    to: "2027-03-31",
    rec: "終日",
    geom: "detour",
  },
  {
    id: "imp-001-day-lane",
    projectId: "tokyo-demo-001",
    type: "車線規制",
    severity: "notice",
    title: "昼間の車線規制（片側1車線）",
    desc: "歩道の拡幅工事に伴い、昼間は片側1車線の規制を行います。",
    from: "2026-08-01",
    to: "2026-12-20",
    rec: "平日 9:00〜16:00",
    geom: "regulation",
  },
  {
    id: "imp-003-notice",
    projectId: "tokyo-demo-003",
    type: "事前周知",
    severity: "info",
    title: "着工前の事前周知",
    desc: "着工前に、周辺住民の皆さまへ工事説明と交通規制の予定を周知します。",
    from: "2026-11-01",
    to: "2026-11-30",
    rec: "終日",
    geom: null,
  },
  {
    id: "imp-004-done",
    projectId: "tokyo-demo-004",
    type: "完了",
    severity: "info",
    title: "工事完了・供用開始",
    desc: "防災広場は完成し、現在は供用中です。",
    from: "2026-02-01",
    to: "2026-03-31",
    rec: "終了",
    geom: null,
  },
];

/* ------------------------------------------------------------------ *
 * 追加案件の生成テンプレート（プロトタイプの SITE_TMPL）
 * ------------------------------------------------------------------ */

export interface SiteTemplate {
  label: string;
  cat: string;
  purpose: string;
  benefits: string[];
  phase: string;
  owner: string;
  contractor: string;
  w: number;
  d: number;
  floors: number;
  completion: string;
  impType: string;
  sev: "info" | "notice" | "warning";
}

export const SITE_TMPL: Record<string, SiteTemplate> = {
  "arch-urban": {
    label: "都市部建設",
    cat: "建築・都市部",
    purpose:
      "利便性の高い市街地に、住戸と低層部の店舗・事務所を備えた建物を新築します。周辺の街並みと歩行者動線に配慮した計画です。",
    benefits: ["住戸・事務所の供給", "低層部に店舗・公共通路を確保", "敷地境界の緑化と歩道の確保"],
    phase: "躯体・外装工事",
    owner: "大田区 建築部 市街地整備課",
    contractor: "サンプル建設株式会社",
    w: 64,
    d: 46,
    floors: 12,
    completion: "tower",
    impType: "車両搬入規制",
    sev: "notice",
  },
  "arch-rural": {
    label: "地方建設",
    cat: "建築・地方",
    purpose:
      "地域の生活利便施設を更新するため、木造・鉄骨造の低層施設を新築します。地域産材と地元施工を前提としています。",
    benefits: ["生活・福祉施設の更新", "地域産材・地元施工の活用", "敷地内の駐車・緑地の確保"],
    phase: "基礎・躯体工事",
    owner: "サンプル町 建設課",
    contractor: "サンプル建設工業",
    w: 54,
    d: 42,
    floors: 3,
    completion: "rural",
    impType: "車両搬入規制",
    sev: "notice",
  },
  "civil-urban": {
    label: "都市部土木",
    cat: "土木・都市部",
    purpose:
      "都市部の道路・上下水道・広場を更新し、安全で使いやすい歩行者・自転車空間と防災機能を確保します。",
    benefits: ["老朽インフラの更新", "歩行者・自転車空間の再整備", "浸水・震災対策の強化"],
    phase: "開削・構造物工事",
    owner: "大田区 建設部 土木課",
    contractor: "サンプル土木株式会社",
    w: 120,
    d: 24,
    floors: 0,
    completion: "road",
    impType: "車線規制",
    sev: "warning",
  },
  "civil-rural": {
    label: "地方土木",
    cat: "土木・地方",
    purpose:
      "地域の幹線道路・農道・河川護岸を改良し、安全性と災害時の通行確保を図ります。",
    benefits: ["狭隘区間・急勾配の改良", "法面・護岸の補強", "災害時の輸送路の確保"],
    phase: "盛土・法面工事",
    owner: "サンプル県 地域整備部",
    contractor: "サンプル建設株式会社",
    w: 150,
    d: 30,
    floors: 0,
    completion: "levee",
    impType: "片側交互通行",
    sev: "notice",
  },
};

export interface SiteDef {
  id: string;
  siteType: string;
  name: string;
  publicTitle: string;
  x: number;
  z: number;
  start: string;
  end: string;
}

/** プロトタイプの SITE_DEFS（20案件） */
export const SITE_DEFS: SiteDef[] = [
  { id: "site-au-1", siteType: "arch-urban", name: "田園調布二丁目 マンション新築工事", publicTitle: "高層マンションを建てる工事", x: 150, z: 190, start: "2026-03-01", end: "2027-02-28" },
  { id: "site-au-2", siteType: "arch-urban", name: "田園調布駅東口 オフィスビル新築工事", publicTitle: "駅東口にオフィスビルを建てる工事", x: -230, z: 150, start: "2026-05-10", end: "2027-03-31" },
  { id: "site-au-3", siteType: "arch-urban", name: "中央通り 商業施設建替工事", publicTitle: "中央通りの商業施設を建て替える工事", x: -270, z: -180, start: "2026-04-15", end: "2027-01-31" },
  { id: "site-au-4", siteType: "arch-urban", name: "市役所前 複合ビル新築工事", publicTitle: "市役所前に複合ビルを建てる工事", x: 300, z: -320, start: "2026-06-01", end: "2027-03-15" },
  { id: "site-au-5", siteType: "arch-urban", name: "公園通り 分譲住宅新築工事", publicTitle: "公園通りに分譲住宅を建てる工事", x: -40, z: -360, start: "2026-02-20", end: "2026-12-20" },
  { id: "site-cu-1", siteType: "civil-urban", name: "中央通り 下水道管更新工事", publicTitle: "中央通りの下水道管を更新する工事", x: 400, z: 40, start: "2026-04-01", end: "2027-01-31" },
  { id: "site-cu-2", siteType: "civil-urban", name: "駅南 道路拡幅工事", publicTitle: "駅南の道路を拡幅する工事", x: -400, z: -60, start: "2026-05-01", end: "2027-02-28" },
  { id: "site-cu-3", siteType: "civil-urban", name: "桜並木通り 無電柱化・歩道整備工事", publicTitle: "桜並木通りの電柱を地中化する工事", x: -120, z: 360, start: "2026-03-15", end: "2026-12-28" },
  { id: "site-cu-4", siteType: "civil-urban", name: "市街地 雨水貯留施設整備工事", publicTitle: "浸水対策の雨水貯留施設をつくる工事", x: 280, z: 400, start: "2026-06-15", end: "2027-03-31" },
  { id: "site-cu-5", siteType: "civil-urban", name: "文化会館前 広場再整備工事", publicTitle: "文化会館前の広場を再整備する工事", x: -380, z: 320, start: "2026-07-01", end: "2027-02-28" },
  { id: "site-ar-1", siteType: "arch-rural", name: "みなみ野 地域福祉施設新築工事", publicTitle: "地域の福祉施設を新築する工事", x: 560, z: 540, start: "2026-09-01", end: "2027-03-31" },
  { id: "site-ar-2", siteType: "arch-rural", name: "川辺町 農産物直売所新築工事", publicTitle: "農産物直売所を新築する工事", x: -600, z: 500, start: "2026-11-15", end: "2027-03-31" },
  { id: "site-ar-3", siteType: "arch-rural", name: "山手集落 診療所建替工事", publicTitle: "集落の診療所を建て替える工事", x: -640, z: -440, start: "2026-12-01", end: "2027-03-31" },
  { id: "site-ar-4", siteType: "arch-rural", name: "湖畔 保育所新築工事", publicTitle: "湖畔に保育所を新築する工事", x: 600, z: -540, start: "2026-08-01", end: "2027-03-31" },
  { id: "site-ar-5", siteType: "arch-rural", name: "東野 公民館改築工事", publicTitle: "老朽化した公民館を改築する工事", x: 20, z: -720, start: "2025-09-01", end: "2026-05-31" },
  { id: "site-cr-1", siteType: "civil-rural", name: "県道 山間部 法面補強工事", publicTitle: "県道の法面を補強する工事", x: 720, z: 180, start: "2026-10-20", end: "2027-03-31" },
  { id: "site-cr-2", siteType: "civil-rural", name: "一級河川 護岸改修工事", publicTitle: "河川の護岸を改修する工事", x: -760, z: 140, start: "2026-04-01", end: "2026-11-30" },
  { id: "site-cr-3", siteType: "civil-rural", name: "西部農道 舗装改良工事", publicTitle: "農道を舗装改良する工事", x: -220, z: 700, start: "2026-09-15", end: "2027-03-31" },
  { id: "site-cr-4", siteType: "civil-rural", name: "峠区間 線形改良工事", publicTitle: "峠の急カーブを改良する工事", x: 440, z: -700, start: "2027-01-10", end: "2027-03-31" },
  { id: "site-cr-5", siteType: "civil-rural", name: "橋梁 耐震補強工事", publicTitle: "古い橋を耐震補強する工事", x: 760, z: -360, start: "2025-08-01", end: "2026-03-31" },
];

/* ------------------------------------------------------------------ *
 * 住所（プロトタイプの LOC）: [郵便番号, 都道府県, 市区, 行政区, 町名]
 * ------------------------------------------------------------------ */

export const LOC: Record<string, [string, string, string, string, string]> = {
  "tokyo-demo-001": ["145-0071", "東京都", "", "大田区", "田園調布一丁目 1-8-5"],
  "tokyo-demo-002": ["145-0071", "東京都", "", "大田区", "田園調布本町 1-1-1"],
  "tokyo-demo-003": ["145-0071", "東京都", "", "大田区", "田園調布三丁目 3-2-4"],
  "tokyo-demo-004": ["145-0073", "東京都", "", "大田区", "多摩川台 2-1-1"],
  "site-au-1": ["145-0071", "東京都", "", "大田区", "田園調布二丁目 2-5-12"],
  "site-au-2": ["145-0071", "東京都", "", "大田区", "田園調布駅東口 1-3-8"],
  "site-au-3": ["145-0071", "東京都", "", "大田区", "中央通り 4-6-2"],
  "site-au-4": ["145-0071", "東京都", "", "大田区", "市役所前 1-1-1"],
  "site-au-5": ["145-0071", "東京都", "", "大田区", "公園通り 5-2-9"],
  "site-cu-1": ["145-0071", "東京都", "", "大田区", "中央通り 3-4-11"],
  "site-cu-2": ["145-0071", "東京都", "", "大田区", "駅南口 2-7-3"],
  "site-cu-3": ["145-0071", "東京都", "", "大田区", "桜並木通り 6-1-4"],
  "site-cu-4": ["145-0071", "東京都", "", "大田区", "市街地中央 1-9-6"],
  "site-cu-5": ["145-0071", "東京都", "", "大田区", "文化会館前 2-3-1"],
  "site-ar-1": ["330-0001", "埼玉県", "みなみ野市", "", "みなみ野 12-4"],
  "site-ar-2": ["330-0002", "埼玉県", "川辺町", "", "川辺 45-2"],
  "site-ar-3": ["380-0003", "長野県", "山手村", "", "山手 890-1"],
  "site-ar-4": ["400-0004", "山梨県", "湖畔町", "", "湖畔 3-7-1"],
  "site-ar-5": ["300-0005", "茨城県", "東野市", "", "東野 77-5"],
  "site-cr-1": ["380-0011", "長野県", "南信濃町", "", "山間 10-3"],
  "site-cr-2": ["330-0021", "埼玉県", "入間川市", "", "河岸 2-14-6"],
  "site-cr-3": ["370-0031", "群馬県", "利根町", "", "西部 55-8"],
  "site-cr-4": ["400-0041", "山梨県", "桂川町", "", "峠 9-2"],
  "site-cr-5": ["420-0051", "静岡県", "大井川市", "", "橋梁 1-22-4"],
};

/* ------------------------------------------------------------------ *
 * 写真（プロトタイプの PHOTO_FILES / PHOTO_CREDIT）
 *
 * 実在の Wikimedia Commons 素材。ライセンス条件を満たすため
 * 作者・ライセンス・原典 URL を必ず表示する。
 * ------------------------------------------------------------------ */

export const PHOTO_FILES: Record<string, string[]> = {
  "arch-urban": ["/images/sample-au1.jpg", "/images/sample-au2.jpg"],
  "arch-rural": ["/images/sample-ar1.jpg", "/images/sample-ar2.jpg"],
  "civil-urban": ["/images/sample-cu1.jpg", "/images/sample-cu2.jpg"],
  "civil-rural": ["/images/sample-cr1.jpg", "/images/sample-cr2.jpg"],
};

export interface PhotoCredit {
  author: string;
  license: string;
  url: string;
}

export const PHOTO_CREDIT: Record<string, PhotoCredit> = {
  "/images/sample-au1.jpg": {
    author: "MB-one",
    license: "CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:High-rise_construction,_Montreal_2017.jpg",
  },
  "/images/sample-au2.jpg": {
    author: "Pete",
    license: "CC BY 2.0",
    url: "https://commons.wikimedia.org/wiki/File:High-rise_construction_in_Kalasatama,_Helsinki,_2023_February.jpg",
  },
  "/images/sample-ar1.jpg": {
    author: "Jaggery",
    license: "CC BY-SA 2.0",
    url: "https://commons.wikimedia.org/wiki/File:House_construction_site,_Greenmeadow,_Cwmbran_-_geograph.org.uk_-_5343692.jpg",
  },
  "/images/sample-ar2.jpg": {
    author: "PatInver",
    license: "CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:House_Construction_site_-_Invermere,_British_Columbia.jpg",
  },
  "/images/sample-cu1.jpg": {
    author: "Sammya Nig Ltd",
    license: "CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:Asphalt_paver_working.jpg",
  },
  "/images/sample-cu2.jpg": {
    author: "MTA Capital Construction Mega Projects",
    license: "CC BY 2.0",
    url: "https://commons.wikimedia.org/wiki/File:Excavation_for_a_trench_box_west_of_Queens_Boulevard._(CQ033,_08-16-2018)_(44048208672).jpg",
  },
  "/images/sample-cr1.jpg": {
    author: "Anastasiya Lvova",
    license: "CC BY-SA 3.0",
    url: "https://commons.wikimedia.org/wiki/File:Tura_River_embankment_022.JPG",
  },
  "/images/sample-cr2.jpg": {
    author: "Novoklimov",
    license: "CC0",
    url: "https://commons.wikimedia.org/wiki/File:Paver_(vehicle)_in_Ukraine.jpg",
  },
};

/* ------------------------------------------------------------------ *
 * 出典・免責
 * ------------------------------------------------------------------ */

export const SAMPLE_DISCLAIMER =
  "この案件は「工事みえるマップ 3D Beta」MVP の開発用サンプルデータです。実在の工事・公告ではありません。位置・工期・規制内容は説明用に構成したもので、実際の交通規制や工事予定を示すものではありません。お出かけ前には必ず発注者・自治体の公式情報をご確認ください。";

/** 実在する自治体・機関のポータル。サンプル案件の「公式情報の入口」として提示する。 */
export const OFFICIAL_PORTALS = {
  ota: "https://www.city.ota.tokyo.jp/",
  mlit: "https://www.mlit.go.jp/",
} as const;

/** タイムラインの基準（プロトタイプの START / MAXIDX / TODAY_IDX に対応） */
export const TIMELINE_START = "2026-04-01";
/** 基準日から 364 日分をスライダーで扱う */
export const TIMELINE_DAYS = 365;
/** 「現在」に対応するインデックス（186日目 ≒ 2026-10-04） */
export const TIMELINE_TODAY_INDEX = 186;
