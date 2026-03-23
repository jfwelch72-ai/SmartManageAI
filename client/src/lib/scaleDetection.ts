import { COMMON_SCALES } from "@/components/takeoff/types";

export interface DetectedScale {
  label: string;
  pxPerFoot: number;
  units: string;
  confidence: "high" | "medium" | "low";
  rawText: string;
}

const INCH = `["″\u2033\u201D]`;
const FOOT = `['′\u2032\u2019]`;

const ARCHITECTURAL_PATTERNS: Array<{ regex: RegExp; parser: (match: RegExpMatchArray) => DetectedScale | null; hasScaleKeyword: boolean }> = [
  {
    regex: new RegExp(`SCALE\\s*[:=]?\\s*(\\d+\\/\\d+)\\s*${INCH}\\s*=\\s*1\\s*${FOOT}\\s*-?\\s*0\\s*${INCH}`, "gi"),
    hasScaleKeyword: true,
    parser: (match) => {
      const result = parseFraction(match[1]);
      if (!result) return null;
      return { label: `${match[1]}" = 1'-0"`, pxPerFoot: result * 96, units: "ft", confidence: "high", rawText: match[0] };
    },
  },
  {
    regex: new RegExp(`(\\d+\\/\\d+)\\s*${INCH}\\s*=\\s*1\\s*${FOOT}\\s*-?\\s*0\\s*${INCH}`, "gi"),
    hasScaleKeyword: false,
    parser: (match) => {
      const result = parseFraction(match[1]);
      if (!result) return null;
      return { label: `${match[1]}" = 1'-0"`, pxPerFoot: result * 96, units: "ft", confidence: "high", rawText: match[0] };
    },
  },
  {
    regex: new RegExp(`(\\d+(?:-\\d+\\/\\d+)?)\\s*${INCH}\\s*=\\s*1\\s*${FOOT}\\s*-?\\s*0\\s*${INCH}`, "gi"),
    hasScaleKeyword: false,
    parser: (match) => {
      const val = parseMixedNumber(match[1]);
      if (!val) return null;
      return { label: `${match[1]}" = 1'-0"`, pxPerFoot: val * 96, units: "ft", confidence: "high", rawText: match[0] };
    },
  },
];

const CIVIL_PATTERNS: Array<{ regex: RegExp; parser: (match: RegExpMatchArray) => DetectedScale | null; hasScaleKeyword: boolean }> = [
  {
    regex: new RegExp(`SCALE\\s*[:=]?\\s*1\\s*${INCH}\\s*=\\s*(\\d+)\\s*${FOOT}`, "gi"),
    hasScaleKeyword: true,
    parser: (match) => {
      const feet = parseInt(match[1]);
      if (!feet || feet <= 0) return null;
      return { label: `1" = ${feet}'`, pxPerFoot: 96 / feet, units: "ft", confidence: "high", rawText: match[0] };
    },
  },
  {
    regex: new RegExp(`1\\s*${INCH}\\s*=\\s*(\\d+)\\s*${FOOT}`, "gi"),
    hasScaleKeyword: false,
    parser: (match) => {
      const feet = parseInt(match[1]);
      if (!feet || feet <= 0) return null;
      return { label: `1" = ${feet}'`, pxPerFoot: 96 / feet, units: "ft", confidence: "high", rawText: match[0] };
    },
  },
];

const METRIC_PATTERNS: Array<{ regex: RegExp; parser: (match: RegExpMatchArray) => DetectedScale | null; hasScaleKeyword: boolean }> = [
  {
    regex: /SCALE\s*[:=]?\s*1\s*:\s*(\d+)/gi,
    hasScaleKeyword: true,
    parser: (match) => {
      const ratio = parseInt(match[1]);
      if (!ratio || ratio <= 0) return null;
      return { label: `1:${ratio}`, pxPerFoot: (96 * 12) / ratio, units: "ft", confidence: "medium", rawText: match[0] };
    },
  },
  {
    regex: /(?:^|\s)1\s*:\s*(\d+)(?:\s|$)/gm,
    hasScaleKeyword: false,
    parser: (match) => {
      const ratio = parseInt(match[1]);
      if (!ratio || ratio <= 0 || ratio > 5000) return null;
      return { label: `1:${ratio}`, pxPerFoot: (96 * 12) / ratio, units: "ft", confidence: "low", rawText: match[0].trim() };
    },
  },
];

function parseFraction(fraction: string): number | null {
  const parts = fraction.split("/");
  if (parts.length !== 2) return null;
  const num = parseInt(parts[0]);
  const den = parseInt(parts[1]);
  if (!num || !den || den === 0) return null;
  return num / den;
}

function parseMixedNumber(str: string): number | null {
  const mixedMatch = str.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1]);
    const num = parseInt(mixedMatch[2]);
    const den = parseInt(mixedMatch[3]);
    if (den === 0) return null;
    return whole + num / den;
  }
  const fracMatch = str.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    return parseFraction(str);
  }
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function findMatchingPreset(pxPerFoot: number): { label: string; pxPerFoot: number } | null {
  const tolerance = 0.05;
  for (const [, scales] of Object.entries(COMMON_SCALES)) {
    for (const scale of scales) {
      if (Math.abs(scale.pxPerFoot - pxPerFoot) / scale.pxPerFoot < tolerance) {
        return scale;
      }
    }
  }
  return null;
}

interface DetectionCandidate extends DetectedScale {
  hasScaleKeyword: boolean;
  frequency: number;
}

export function detectScaleFromText(textItems: string[]): DetectedScale | null {
  const fullText = textItems.join(" ");

  const allPatterns = [
    ...ARCHITECTURAL_PATTERNS,
    ...CIVIL_PATTERNS,
    ...METRIC_PATTERNS,
  ];

  const candidates: DetectionCandidate[] = [];

  for (const { regex, parser, hasScaleKeyword } of allPatterns) {
    regex.lastIndex = 0;
    let match: RegExpMatchArray | null;
    while ((match = regex.exec(fullText)) !== null) {
      const result = parser(match);
      if (result) {
        const preset = findMatchingPreset(result.pxPerFoot);
        if (preset) {
          result.label = preset.label;
          result.pxPerFoot = preset.pxPerFoot;
          result.confidence = "high";
        }
        candidates.push({ ...result, hasScaleKeyword, frequency: 1 });
      }
    }
  }

  if (candidates.length === 0) return null;

  const frequencyMap = new Map<number, number>();
  for (const c of candidates) {
    const key = Math.round(c.pxPerFoot * 100);
    frequencyMap.set(key, (frequencyMap.get(key) || 0) + 1);
  }
  for (const c of candidates) {
    const key = Math.round(c.pxPerFoot * 100);
    c.frequency = frequencyMap.get(key) || 1;
  }

  candidates.sort((a, b) => {
    if (a.hasScaleKeyword !== b.hasScaleKeyword) return a.hasScaleKeyword ? -1 : 1;
    const confOrder = { high: 0, medium: 1, low: 2 };
    if (confOrder[a.confidence] !== confOrder[b.confidence]) return confOrder[a.confidence] - confOrder[b.confidence];
    if (a.frequency !== b.frequency) return b.frequency - a.frequency;
    return 0;
  });

  const best = candidates[0];
  return { label: best.label, pxPerFoot: best.pxPerFoot, units: best.units, confidence: best.confidence, rawText: best.rawText };
}
