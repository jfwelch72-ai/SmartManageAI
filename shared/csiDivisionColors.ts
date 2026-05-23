/**
 * Task #3045 — CSI MasterFormat division color palette.
 *
 * One distinct, accessible hex color per CSI division (DIV 01–DIV 33).
 * Used for both the AI overlay Konva polygons and the DivisionFilterPanel
 * swatch rows.  Colors are designed to be readable at 30% opacity fill
 * on a white plan background.
 *
 * Palette design rationale:
 *   - Warm tones (amber/orange/red) → structural trades (DIV 03–05)
 *   - Cool tones (blue/cyan) → MEP trades (DIV 21–27)
 *   - Earthy greens/tans → site & civil (DIV 31–33)
 *   - Neutral/gray → administrative (DIV 01–02)
 *   - 16 core hues cycled through the remaining divisions
 */

export const CSI_DIVISION_NAMES: Record<string, string> = {
  "DIV 01": "General Requirements",
  "DIV 02": "Existing Conditions",
  "DIV 03": "Concrete",
  "DIV 04": "Masonry",
  "DIV 05": "Metals",
  "DIV 06": "Wood, Plastics & Composites",
  "DIV 07": "Thermal & Moisture Protection",
  "DIV 08": "Openings",
  "DIV 09": "Finishes",
  "DIV 10": "Specialties",
  "DIV 11": "Equipment",
  "DIV 12": "Furnishings",
  "DIV 13": "Special Construction",
  "DIV 14": "Conveying Equipment",
  "DIV 21": "Fire Suppression",
  "DIV 22": "Plumbing",
  "DIV 23": "HVAC",
  "DIV 25": "Integrated Automation",
  "DIV 26": "Electrical",
  "DIV 27": "Communications",
  "DIV 28": "Electronic Safety & Security",
  "DIV 31": "Earthwork",
  "DIV 32": "Exterior Improvements",
  "DIV 33": "Utilities",
};

export const CSI_DIVISION_COLORS: Record<string, string> = {
  "DIV 01": "#6b7280", // gray-500 — general / administrative
  "DIV 02": "#92400e", // amber-800 — existing conditions / demo
  "DIV 03": "#d97706", // amber-600 — concrete (warm)
  "DIV 04": "#b91c1c", // red-700 — masonry / brick
  "DIV 05": "#1d4ed8", // blue-700 — structural metals (steel)
  "DIV 06": "#78350f", // amber-900 — wood / timber
  "DIV 07": "#0f766e", // teal-700 — thermal / envelope
  "DIV 08": "#a16207", // yellow-700 — openings / glazing
  "DIV 09": "#db2777", // pink-600 — finishes / gypsum
  "DIV 10": "#7c3aed", // violet-600 — specialties
  "DIV 11": "#1e40af", // blue-800 — equipment
  "DIV 12": "#be185d", // pink-700 — furnishings
  "DIV 13": "#166534", // green-800 — special construction
  "DIV 14": "#c2410c", // orange-700 — conveying (elevators)
  "DIV 21": "#dc2626", // red-600 — fire suppression
  "DIV 22": "#0284c7", // sky-600 — plumbing
  "DIV 23": "#0891b2", // cyan-600 — HVAC / mechanical
  "DIV 25": "#6d28d9", // violet-700 — integrated automation
  "DIV 26": "#ca8a04", // yellow-600 — electrical
  "DIV 27": "#4338ca", // indigo-700 — communications / low-voltage
  "DIV 28": "#b45309", // amber-700 — electronic safety
  "DIV 31": "#854d0e", // amber-800 (earthier) — earthwork / grading
  "DIV 32": "#15803d", // green-700 — exterior improvements / paving
  "DIV 33": "#475569", // slate-600 — underground utilities
};

/** CSI divisions in display order (numeric). */
export const CSI_DIVISIONS_ORDERED = [
  "DIV 01", "DIV 02", "DIV 03", "DIV 04", "DIV 05",
  "DIV 06", "DIV 07", "DIV 08", "DIV 09", "DIV 10",
  "DIV 11", "DIV 12", "DIV 13", "DIV 14",
  "DIV 21", "DIV 22", "DIV 23", "DIV 25", "DIV 26",
  "DIV 27", "DIV 28",
  "DIV 31", "DIV 32", "DIV 33",
] as const;

export type CsiDivisionCode = (typeof CSI_DIVISIONS_ORDERED)[number];

/**
 * Returns the hex color for a given CSI division code.
 * Falls back to a neutral gray for unknown / null divisions.
 */
export function getCsiDivisionColor(division: string | null | undefined): string {
  if (!division) return "#9ca3af";
  return CSI_DIVISION_COLORS[division] ?? "#9ca3af";
}
