export interface TimezoneOption {
  value: string;
  label: string;
}

export const COMMON_TIMEZONES: TimezoneOption[] = [
  { value: "America/New_York", label: "Eastern Time (US & Canada)" },
  { value: "America/Detroit", label: "Eastern Time - Detroit" },
  { value: "America/Indiana/Indianapolis", label: "Eastern Time - Indianapolis" },
  { value: "America/Chicago", label: "Central Time (US & Canada)" },
  { value: "America/Denver", label: "Mountain Time (US & Canada)" },
  { value: "America/Boise", label: "Mountain Time - Boise" },
  { value: "America/Phoenix", label: "Mountain Time - Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
  { value: "America/Puerto_Rico", label: "Atlantic Time - Puerto Rico" },
  { value: "Pacific/Guam", label: "Chamorro Time - Guam" },
  { value: "Pacific/Pago_Pago", label: "Samoa Time - Pago Pago" },
  { value: "America/Halifax", label: "Atlantic Time - Halifax" },
  { value: "America/St_Johns", label: "Newfoundland Time" },
  { value: "America/Toronto", label: "Eastern Time - Toronto" },
  { value: "America/Vancouver", label: "Pacific Time - Vancouver" },
  { value: "America/Mexico_City", label: "Central Time - Mexico City" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Dublin", label: "Dublin" },
  { value: "Europe/Paris", label: "Paris (CET)" },
  { value: "Europe/Berlin", label: "Berlin (CET)" },
  { value: "Europe/Madrid", label: "Madrid (CET)" },
  { value: "Europe/Rome", label: "Rome (CET)" },
  { value: "Europe/Amsterdam", label: "Amsterdam (CET)" },
  { value: "Europe/Stockholm", label: "Stockholm (CET)" },
  { value: "Europe/Athens", label: "Athens (EET)" },
  { value: "Europe/Moscow", label: "Moscow" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "India" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Seoul", label: "Seoul" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Australia/Melbourne", label: "Melbourne" },
  { value: "Australia/Perth", label: "Perth" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "UTC", label: "UTC" },
];

export const TIMEZONE_VALUES: ReadonlySet<string> = new Set(
  COMMON_TIMEZONES.map((tz) => tz.value),
);

export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== "string") return false;
  if (TIMEZONE_VALUES.has(tz)) return true;
  try {
    // Fall back to runtime validation for any IANA zone the platform supports.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Mapping from US state (full name or 2-letter code, case-insensitive) to a
// reasonable default IANA timezone. For states that span multiple zones we
// pick the most populous zone — these are suggestions only, the user can
// override.
const US_STATE_TO_TIMEZONE: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
  PR: "America/Puerto_Rico",
  VI: "America/Puerto_Rico",
  GU: "Pacific/Guam",
  AS: "Pacific/Pago_Pago",
  MP: "Pacific/Guam",
};

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR",
  CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI",
  IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
  KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
  MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX",
  UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA",
  "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
  "PUERTO RICO": "PR", "VIRGIN ISLANDS": "VI", GUAM: "GU",
  "AMERICAN SAMOA": "AS", "NORTHERN MARIANA ISLANDS": "MP",
};

export function inferTimezoneFromUSState(
  state: string | null | undefined,
): string | null {
  if (!state || typeof state !== "string") return null;
  const trimmed = state.trim().toUpperCase();
  if (!trimmed) return null;
  if (US_STATE_TO_TIMEZONE[trimmed]) return US_STATE_TO_TIMEZONE[trimmed];
  const code = US_STATE_NAME_TO_CODE[trimmed];
  if (code && US_STATE_TO_TIMEZONE[code]) return US_STATE_TO_TIMEZONE[code];
  return null;
}

// Mapping of 3-digit US ZIP code prefixes to a state code. Generated from
// USPS ZIP-3 to state assignments. ZIP3 ranges that span multiple states are
// assigned to the dominant state; multi-timezone overrides below take
// precedence for split-state regions.
const STATE_TO_ZIP3_RANGES: Record<string, Array<[number, number]>> = {
  AL: [[350, 369]],
  AK: [[995, 999]],
  AZ: [[850, 865]],
  AR: [[716, 729], [755, 755]],
  CA: [[900, 961]],
  CO: [[800, 816]],
  CT: [[60, 69]],
  DE: [[197, 199]],
  DC: [[200, 205], [569, 569]],
  FL: [[320, 349]],
  GA: [[300, 319], [398, 399]],
  HI: [[967, 968]],
  ID: [[832, 838]],
  IL: [[600, 629]],
  IN: [[460, 479]],
  IA: [[500, 528]],
  KS: [[660, 679]],
  KY: [[400, 427]],
  LA: [[700, 714]],
  ME: [[39, 49]],
  MD: [[206, 219]],
  MA: [[10, 27], [55, 55]],
  MI: [[480, 499]],
  MN: [[550, 567]],
  MS: [[386, 397]],
  MO: [[630, 658]],
  MT: [[590, 599]],
  NE: [[680, 693]],
  NV: [[889, 898]],
  NH: [[30, 38]],
  NJ: [[70, 89]],
  NM: [[870, 884]],
  NY: [[5, 5], [100, 149]],
  NC: [[270, 289]],
  ND: [[580, 588]],
  OH: [[430, 459]],
  OK: [[730, 749]],
  OR: [[970, 979]],
  PA: [[150, 196]],
  RI: [[28, 29]],
  SC: [[290, 299]],
  SD: [[570, 577]],
  TN: [[370, 385]],
  TX: [[750, 799], [885, 885]],
  UT: [[840, 847]],
  VT: [[50, 54], [56, 59]],
  VA: [[220, 246]],
  WA: [[980, 994]],
  WV: [[247, 268]],
  WI: [[530, 549]],
  WY: [[820, 831]],
  PR: [[6, 9]],
  VI: [[8, 8]],
  GU: [[969, 969]],
};

const ZIP3_TO_STATE: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [state, ranges] of Object.entries(STATE_TO_ZIP3_RANGES)) {
    for (const [lo, hi] of ranges) {
      for (let i = lo; i <= hi; i++) {
        out[String(i).padStart(3, "0")] = state;
      }
    }
  }
  return out;
})();

// Overrides for ZIP3 prefixes whose timezone differs from the dominant
// state-level timezone (multi-zone states).
const ZIP3_TIMEZONE_OVERRIDES: Record<string, string> = {
  // Florida panhandle - Central
  "324": "America/Chicago",
  "325": "America/Chicago",
  // Western Kentucky - Central
  "420": "America/Chicago",
  "421": "America/Chicago",
  "422": "America/Chicago",
  "423": "America/Chicago",
  "424": "America/Chicago",
  "425": "America/Chicago",
  "426": "America/Chicago",
  "427": "America/Chicago",
  // Eastern Tennessee - Eastern
  "374": "America/New_York",
  "376": "America/New_York",
  "377": "America/New_York",
  "378": "America/New_York",
  "379": "America/New_York",
  // Indiana corners - Central
  "463": "America/Chicago",
  "464": "America/Chicago",
  "476": "America/Chicago",
  "477": "America/Chicago",
  // Western North Dakota - Mountain
  "586": "America/Denver",
  "587": "America/Denver",
  "588": "America/Denver",
  // Western South Dakota - Mountain
  "576": "America/Denver",
  "577": "America/Denver",
  // Nebraska panhandle - Mountain
  "693": "America/Denver",
  // West Texas / El Paso - Mountain
  "798": "America/Denver",
  "799": "America/Denver",
  "885": "America/Denver",
  // Northern Idaho panhandle - Pacific
  "838": "America/Los_Angeles",
  // U.S. Virgin Islands - Atlantic
  "008": "America/Puerto_Rico",
};

export function inferTimezoneFromUSZip(
  zip: string | null | undefined,
): string | null {
  if (!zip || typeof zip !== "string") return null;
  const digits = zip.replace(/\D/g, "");
  if (digits.length < 3) return null;
  const prefix = digits.slice(0, 3);
  if (ZIP3_TIMEZONE_OVERRIDES[prefix]) return ZIP3_TIMEZONE_OVERRIDES[prefix];
  const state = ZIP3_TO_STATE[prefix];
  if (state) return inferTimezoneFromUSState(state);
  return null;
}

// NANP area code → IANA timezone. Covers active US (and territory) area
// codes. For area codes whose geographic region spans multiple zones we pick
// the dominant zone.
const AREA_CODE_TO_TIMEZONE: Record<string, string> = {
  // Eastern - NY
  "212": "America/New_York", "315": "America/New_York", "332": "America/New_York",
  "347": "America/New_York", "363": "America/New_York", "516": "America/New_York",
  "518": "America/New_York", "585": "America/New_York", "607": "America/New_York",
  "631": "America/New_York", "646": "America/New_York", "680": "America/New_York",
  "716": "America/New_York", "718": "America/New_York", "838": "America/New_York",
  "845": "America/New_York", "914": "America/New_York", "917": "America/New_York",
  "929": "America/New_York", "934": "America/New_York",
  // Eastern - NJ
  "201": "America/New_York", "551": "America/New_York", "609": "America/New_York",
  "640": "America/New_York", "732": "America/New_York", "848": "America/New_York",
  "856": "America/New_York", "862": "America/New_York", "908": "America/New_York",
  "973": "America/New_York",
  // Eastern - PA
  "215": "America/New_York", "223": "America/New_York", "267": "America/New_York",
  "272": "America/New_York", "412": "America/New_York", "445": "America/New_York",
  "484": "America/New_York", "570": "America/New_York", "582": "America/New_York",
  "610": "America/New_York", "717": "America/New_York", "724": "America/New_York",
  "814": "America/New_York", "835": "America/New_York", "878": "America/New_York",
  // Eastern - CT
  "203": "America/New_York", "475": "America/New_York", "860": "America/New_York",
  "959": "America/New_York",
  // Eastern - MA
  "339": "America/New_York", "351": "America/New_York", "413": "America/New_York",
  "508": "America/New_York", "617": "America/New_York", "774": "America/New_York",
  "781": "America/New_York", "857": "America/New_York", "978": "America/New_York",
  // Eastern - RI/NH/VT/ME/DE
  "401": "America/New_York", "603": "America/New_York", "802": "America/New_York",
  "207": "America/New_York", "302": "America/New_York",
  // Eastern - MD/DC
  "227": "America/New_York", "240": "America/New_York", "301": "America/New_York",
  "410": "America/New_York", "443": "America/New_York", "667": "America/New_York",
  "202": "America/New_York", "771": "America/New_York",
  // Eastern - VA/WV
  "276": "America/New_York", "434": "America/New_York", "540": "America/New_York",
  "571": "America/New_York", "686": "America/New_York", "703": "America/New_York",
  "757": "America/New_York", "804": "America/New_York", "826": "America/New_York",
  "948": "America/New_York", "304": "America/New_York", "681": "America/New_York",
  // Eastern - NC
  "252": "America/New_York", "336": "America/New_York", "472": "America/New_York",
  "704": "America/New_York", "743": "America/New_York", "828": "America/New_York",
  "910": "America/New_York", "919": "America/New_York", "980": "America/New_York",
  "984": "America/New_York",
  // Eastern - SC
  "803": "America/New_York", "821": "America/New_York", "839": "America/New_York",
  "843": "America/New_York", "854": "America/New_York", "864": "America/New_York",
  // Eastern - GA
  "229": "America/New_York", "404": "America/New_York", "470": "America/New_York",
  "478": "America/New_York", "678": "America/New_York", "706": "America/New_York",
  "762": "America/New_York", "770": "America/New_York", "912": "America/New_York",
  "943": "America/New_York",
  // Eastern - OH
  "216": "America/New_York", "220": "America/New_York", "234": "America/New_York",
  "283": "America/New_York", "326": "America/New_York", "330": "America/New_York",
  "380": "America/New_York", "419": "America/New_York", "436": "America/New_York",
  "440": "America/New_York", "513": "America/New_York", "567": "America/New_York",
  "614": "America/New_York", "740": "America/New_York", "937": "America/New_York",
  // Eastern - MI (most)
  "231": "America/Detroit", "248": "America/Detroit", "269": "America/Detroit",
  "313": "America/Detroit", "517": "America/Detroit", "586": "America/Detroit",
  "616": "America/Detroit", "679": "America/Detroit", "734": "America/Detroit",
  "810": "America/Detroit", "906": "America/Detroit", "947": "America/Detroit",
  "989": "America/Detroit",
  // KY
  "270": "America/Chicago", "364": "America/Chicago",
  "502": "America/New_York", "606": "America/New_York", "859": "America/New_York",
  // TN
  "423": "America/New_York", "865": "America/New_York",
  "615": "America/Chicago", "629": "America/Chicago", "731": "America/Chicago",
  "901": "America/Chicago", "931": "America/Chicago",
  // IN
  "317": "America/Indiana/Indianapolis", "260": "America/Indiana/Indianapolis",
  "463": "America/Indiana/Indianapolis", "574": "America/Indiana/Indianapolis",
  "765": "America/Indiana/Indianapolis", "812": "America/Indiana/Indianapolis",
  "930": "America/Indiana/Indianapolis", "219": "America/Chicago",
  // FL
  "239": "America/New_York", "305": "America/New_York", "321": "America/New_York",
  "324": "America/New_York", "352": "America/New_York", "386": "America/New_York",
  "407": "America/New_York", "448": "America/New_York", "561": "America/New_York",
  "645": "America/New_York", "656": "America/New_York", "689": "America/New_York",
  "727": "America/New_York", "728": "America/New_York", "754": "America/New_York",
  "772": "America/New_York", "786": "America/New_York", "813": "America/New_York",
  "863": "America/New_York", "904": "America/New_York", "941": "America/New_York",
  "954": "America/New_York", "850": "America/Chicago",
  // Central - IL
  "217": "America/Chicago", "224": "America/Chicago", "309": "America/Chicago",
  "312": "America/Chicago", "331": "America/Chicago", "447": "America/Chicago",
  "464": "America/Chicago", "618": "America/Chicago", "630": "America/Chicago",
  "708": "America/Chicago", "730": "America/Chicago", "773": "America/Chicago",
  "779": "America/Chicago", "815": "America/Chicago", "847": "America/Chicago",
  "861": "America/Chicago", "872": "America/Chicago",
  // Central - WI
  "262": "America/Chicago", "274": "America/Chicago", "353": "America/Chicago",
  "414": "America/Chicago", "534": "America/Chicago", "608": "America/Chicago",
  "715": "America/Chicago", "920": "America/Chicago",
  // Central - MN
  "218": "America/Chicago", "320": "America/Chicago", "507": "America/Chicago",
  "612": "America/Chicago", "651": "America/Chicago", "763": "America/Chicago",
  "924": "America/Chicago", "952": "America/Chicago",
  // Central - IA
  "319": "America/Chicago", "515": "America/Chicago", "563": "America/Chicago",
  "641": "America/Chicago", "712": "America/Chicago",
  // Central - MO
  "314": "America/Chicago", "417": "America/Chicago", "557": "America/Chicago",
  "573": "America/Chicago", "636": "America/Chicago", "660": "America/Chicago",
  "816": "America/Chicago", "975": "America/Chicago",
  // Central - AR
  "327": "America/Chicago", "479": "America/Chicago", "501": "America/Chicago",
  "870": "America/Chicago",
  // Central - LA
  "225": "America/Chicago", "318": "America/Chicago", "337": "America/Chicago",
  "504": "America/Chicago", "985": "America/Chicago",
  // Central - MS
  "228": "America/Chicago", "471": "America/Chicago", "601": "America/Chicago",
  "662": "America/Chicago", "769": "America/Chicago",
  // Central - AL
  "205": "America/Chicago", "251": "America/Chicago", "256": "America/Chicago",
  "334": "America/Chicago", "483": "America/Chicago", "659": "America/Chicago",
  "938": "America/Chicago",
  // TX
  "210": "America/Chicago", "214": "America/Chicago", "254": "America/Chicago",
  "281": "America/Chicago", "325": "America/Chicago", "346": "America/Chicago",
  "361": "America/Chicago", "409": "America/Chicago", "430": "America/Chicago",
  "432": "America/Chicago", "469": "America/Chicago", "512": "America/Chicago",
  "682": "America/Chicago", "713": "America/Chicago", "726": "America/Chicago",
  "737": "America/Chicago", "806": "America/Chicago", "817": "America/Chicago",
  "830": "America/Chicago", "832": "America/Chicago", "903": "America/Chicago",
  "936": "America/Chicago", "940": "America/Chicago", "945": "America/Chicago",
  "956": "America/Chicago", "972": "America/Chicago", "979": "America/Chicago",
  "915": "America/Denver",
  // Central - OK
  "405": "America/Chicago", "539": "America/Chicago", "572": "America/Chicago",
  "580": "America/Chicago", "918": "America/Chicago",
  // Central - KS
  "316": "America/Chicago", "620": "America/Chicago", "785": "America/Chicago",
  "913": "America/Chicago",
  // Central - NE
  "308": "America/Chicago", "402": "America/Chicago", "531": "America/Chicago",
  // SD/ND
  "605": "America/Chicago", "701": "America/Chicago",
  // Mountain
  "303": "America/Denver", "719": "America/Denver", "720": "America/Denver",
  "748": "America/Denver", "970": "America/Denver", "983": "America/Denver",
  "307": "America/Denver", "406": "America/Denver",
  "505": "America/Denver", "575": "America/Denver",
  "385": "America/Denver", "435": "America/Denver", "801": "America/Denver",
  "208": "America/Boise", "986": "America/Boise",
  // Phoenix (AZ - no DST)
  "480": "America/Phoenix", "520": "America/Phoenix", "602": "America/Phoenix",
  "623": "America/Phoenix", "928": "America/Phoenix",
  // Pacific - CA
  "209": "America/Los_Angeles", "213": "America/Los_Angeles", "279": "America/Los_Angeles",
  "310": "America/Los_Angeles", "323": "America/Los_Angeles", "341": "America/Los_Angeles",
  "350": "America/Los_Angeles", "357": "America/Los_Angeles", "369": "America/Los_Angeles",
  "408": "America/Los_Angeles", "415": "America/Los_Angeles", "424": "America/Los_Angeles",
  "442": "America/Los_Angeles", "510": "America/Los_Angeles", "530": "America/Los_Angeles",
  "559": "America/Los_Angeles", "562": "America/Los_Angeles", "619": "America/Los_Angeles",
  "626": "America/Los_Angeles", "628": "America/Los_Angeles", "650": "America/Los_Angeles",
  "657": "America/Los_Angeles", "661": "America/Los_Angeles", "669": "America/Los_Angeles",
  "707": "America/Los_Angeles", "714": "America/Los_Angeles", "738": "America/Los_Angeles",
  "747": "America/Los_Angeles", "760": "America/Los_Angeles", "805": "America/Los_Angeles",
  "818": "America/Los_Angeles", "820": "America/Los_Angeles", "831": "America/Los_Angeles",
  "837": "America/Los_Angeles", "840": "America/Los_Angeles", "858": "America/Los_Angeles",
  "909": "America/Los_Angeles", "916": "America/Los_Angeles", "925": "America/Los_Angeles",
  "935": "America/Los_Angeles", "949": "America/Los_Angeles", "951": "America/Los_Angeles",
  // Pacific - WA/OR/NV
  "206": "America/Los_Angeles", "253": "America/Los_Angeles", "360": "America/Los_Angeles",
  "425": "America/Los_Angeles", "509": "America/Los_Angeles", "564": "America/Los_Angeles",
  "458": "America/Los_Angeles", "503": "America/Los_Angeles", "541": "America/Los_Angeles",
  "971": "America/Los_Angeles",
  "702": "America/Los_Angeles", "725": "America/Los_Angeles", "775": "America/Los_Angeles",
  // Alaska / Hawaii
  "907": "America/Anchorage", "808": "Pacific/Honolulu",
  // Territories
  "787": "America/Puerto_Rico", "939": "America/Puerto_Rico",
  "340": "America/Puerto_Rico",
  "671": "Pacific/Guam", "670": "Pacific/Guam",
  "684": "Pacific/Pago_Pago",
};

// NANP area codes that are non-geographic (toll-free, etc.) and should not
// be used to infer a timezone.
const NON_GEOGRAPHIC_AREA_CODES: ReadonlySet<string> = new Set([
  "800", "833", "844", "855", "866", "877", "888", "822", "880", "881",
  "882", "883", "884", "885", "886", "887", "889", "500", "521", "522",
  "523", "524", "525", "526", "527", "528", "529", "532", "533", "535",
  "538", "542", "543", "544", "545", "546", "547", "549", "550", "552",
  "553", "554", "556", "558", "566", "569", "577", "578", "588", "589",
  "700", "710", "900",
]);

function extractAreaCode(phone: string): string | null {
  const trimmed = phone.trim();
  // Reject explicit non-NANP international prefixes (anything starting with
  // "+" that is not "+1"). This avoids treating e.g. "+44 20 …" as a US
  // 10-digit number whose leading digits happen to look like an area code.
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  let national = digits;
  if (national.length === 11) {
    if (!national.startsWith("1")) return null;
    national = national.slice(1);
  }
  // Only accept exactly 10-digit NANP numbers; anything else is ambiguous.
  if (national.length !== 10) return null;
  return national.slice(0, 3);
}

export function inferTimezoneFromPhone(
  phone: string | null | undefined,
): string | null {
  if (!phone || typeof phone !== "string") return null;
  const code = extractAreaCode(phone);
  if (!code) return null;
  if (NON_GEOGRAPHIC_AREA_CODES.has(code)) return null;
  return AREA_CODE_TO_TIMEZONE[code] ?? null;
}

// Light country lookup. Only common countries that are likely to appear in
// lead-form submissions; the list intentionally favours single-zone
// countries so the inferred value is meaningful.
const COUNTRY_TO_TIMEZONE: Record<string, string> = {
  US: "America/New_York",
  USA: "America/New_York",
  "UNITED STATES": "America/New_York",
  "UNITED STATES OF AMERICA": "America/New_York",
  CA: "America/Toronto",
  CAN: "America/Toronto",
  CANADA: "America/Toronto",
  MX: "America/Mexico_City",
  MEX: "America/Mexico_City",
  MEXICO: "America/Mexico_City",
  GB: "Europe/London",
  UK: "Europe/London",
  "UNITED KINGDOM": "Europe/London",
  "GREAT BRITAIN": "Europe/London",
  ENGLAND: "Europe/London",
  IE: "Europe/Dublin",
  IRL: "Europe/Dublin",
  IRELAND: "Europe/Dublin",
  FR: "Europe/Paris",
  FRA: "Europe/Paris",
  FRANCE: "Europe/Paris",
  DE: "Europe/Berlin",
  DEU: "Europe/Berlin",
  GERMANY: "Europe/Berlin",
  ES: "Europe/Madrid",
  ESP: "Europe/Madrid",
  SPAIN: "Europe/Madrid",
  IT: "Europe/Rome",
  ITA: "Europe/Rome",
  ITALY: "Europe/Rome",
  NL: "Europe/Amsterdam",
  NLD: "Europe/Amsterdam",
  NETHERLANDS: "Europe/Amsterdam",
  AU: "Australia/Sydney",
  AUS: "Australia/Sydney",
  AUSTRALIA: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  NZL: "Pacific/Auckland",
  "NEW ZEALAND": "Pacific/Auckland",
  IN: "Asia/Kolkata",
  IND: "Asia/Kolkata",
  INDIA: "Asia/Kolkata",
  JP: "Asia/Tokyo",
  JPN: "Asia/Tokyo",
  JAPAN: "Asia/Tokyo",
  CN: "Asia/Shanghai",
  CHN: "Asia/Shanghai",
  CHINA: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  HKG: "Asia/Hong_Kong",
  "HONG KONG": "Asia/Hong_Kong",
  SG: "Asia/Singapore",
  SGP: "Asia/Singapore",
  SINGAPORE: "Asia/Singapore",
  KR: "Asia/Seoul",
  KOR: "Asia/Seoul",
  "SOUTH KOREA": "Asia/Seoul",
  AE: "Asia/Dubai",
  ARE: "Asia/Dubai",
  "UNITED ARAB EMIRATES": "Asia/Dubai",
  PR: "America/Puerto_Rico",
  PRI: "America/Puerto_Rico",
  "PUERTO RICO": "America/Puerto_Rico",
};

export function inferTimezoneFromCountry(
  country: string | null | undefined,
): string | null {
  if (!country || typeof country !== "string") return null;
  const key = country.trim().toUpperCase();
  if (!key) return null;
  return COUNTRY_TO_TIMEZONE[key] ?? null;
}

export interface ContactTimezoneSignals {
  zip?: string | null;
  state?: string | null;
  country?: string | null;
  phone?: string | null;
  mobile?: string | null;
}

/**
 * Infer a timezone from the most specific available signal, in priority
 * order: ZIP code → state → country → phone area code → mobile area code.
 * Returns null when no signal yields a result.
 */
export function inferTimezoneFromSignals(
  signals: ContactTimezoneSignals,
): string | null {
  const zipTz = inferTimezoneFromUSZip(signals.zip);
  if (zipTz) return zipTz;
  const stateTz = inferTimezoneFromUSState(signals.state);
  if (stateTz) return stateTz;
  const countryTz = inferTimezoneFromCountry(signals.country);
  if (countryTz) return countryTz;
  const phoneTz = inferTimezoneFromPhone(signals.phone);
  if (phoneTz) return phoneTz;
  const mobileTz = inferTimezoneFromPhone(signals.mobile);
  if (mobileTz) return mobileTz;
  return null;
}
