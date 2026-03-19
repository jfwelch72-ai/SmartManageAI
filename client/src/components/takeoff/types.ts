import {
  MousePointer2, Hand, Ruler, Square, Circle as CircleIcon,
  Box, MapPin, StickyNote, MoveVertical, Triangle, Scaling, Grid3x3,
  MoveUpRight, Type, RectangleHorizontal, MessageSquare, Highlighter, PenLine, Flag
} from "lucide-react";

export type Tool =
  | "select"
  | "pan"
  | "calibrate"
  | "linear"
  | "arc"
  | "area"
  | "volume"
  | "count"
  | "note"
  | "linear_with_drop"
  | "pitched_area"
  | "pitched_linear"
  | "surface_area"
  | "markup_arrow"
  | "markup_text"
  | "markup_rectangle"
  | "markup_cloud"
  | "markup_highlight"
  | "markup_freehand"
  | "issue_pin";

export type MarkupToolId = "markup_arrow" | "markup_text" | "markup_rectangle" | "markup_cloud" | "markup_highlight" | "markup_freehand";

export const MARKUP_TOOL_IDS: MarkupToolId[] = ["markup_arrow", "markup_text", "markup_rectangle", "markup_cloud", "markup_highlight", "markup_freehand"];

export type MeasurementType = "LINEAR" | "AREA" | "VOLUME" | "COUNT" | "NOTE" | "LINEAR_WITH_DROP" | "PITCHED_AREA" | "PITCHED_LINEAR" | "SURFACE_AREA";

export interface PlanDocument {
  id: string;
  fileName: string;
  title: string | null;
  fileUrl: string | null;
  uploadedAt: string;
}

export interface AddendumOverlayData {
  id: string;
  addendumNumber: number;
  title: string;
  status: string;
  storageKey: string | null;
  fileUrl: string | null;
  fileName: string | null;
}

export const TOOL_CONFIG = [
  { id: "select", icon: MousePointer2, label: "Select", color: "default", shortcut: "S", group: "nav" },
  { id: "pan", icon: Hand, label: "Pan", color: "default", shortcut: "H", group: "nav" },
  { id: "calibrate", icon: Ruler, label: "Calibrate", color: "secondary", shortcut: null, group: "nav" },
  { id: "linear", icon: Ruler, label: "Linear", color: "primary", shortcut: "L", group: "measure" },
  { id: "arc", icon: CircleIcon, label: "Arc/Radius", color: "primary", shortcut: "R", group: "measure" },
  { id: "area", icon: Square, label: "Area", color: "primary", shortcut: "A", group: "measure" },
  { id: "volume", icon: Box, label: "Volume", color: "primary", shortcut: "V", group: "measure" },
  { id: "count", icon: MapPin, label: "Count", color: "primary", shortcut: "C", group: "measure" },
  { id: "note", icon: StickyNote, label: "Note", color: "default", shortcut: "N", group: "measure" },
  { id: "linear_with_drop", icon: MoveVertical, label: "Linear + Drop", color: "primary", shortcut: "D", group: "measure" },
  { id: "pitched_linear", icon: Triangle, label: "Pitched Linear", color: "primary", shortcut: "P", group: "measure" },
  { id: "pitched_area", icon: Scaling, label: "Pitched Area", color: "primary", shortcut: "T", group: "measure" },
  { id: "surface_area", icon: Grid3x3, label: "Surface Area", color: "primary", shortcut: "G", group: "measure" },
  { id: "markup_arrow", icon: MoveUpRight, label: "Arrow", color: "default", shortcut: null, group: "markup" },
  { id: "markup_text", icon: Type, label: "Text Label", color: "default", shortcut: null, group: "markup" },
  { id: "markup_rectangle", icon: RectangleHorizontal, label: "Rectangle", color: "default", shortcut: null, group: "markup" },
  { id: "markup_cloud", icon: MessageSquare, label: "Cloud/Bubble", color: "default", shortcut: null, group: "markup" },
  { id: "markup_highlight", icon: Highlighter, label: "Highlight", color: "default", shortcut: null, group: "markup" },
  { id: "markup_freehand", icon: PenLine, label: "Freehand Pen", color: "default", shortcut: null, group: "markup" },
  { id: "issue_pin", icon: Flag, label: "Issue Pin", color: "destructive", shortcut: "I", group: "issues" },
] as const;

export const COMMON_SCALES = {
  architectural: [
    { label: '1/16" = 1\'-0"', pxPerFoot: 6, description: "Very small scale" },
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Small scale" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Common floor plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Medium detail" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed plans" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large detail" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Enlarged details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Large details" },
  ],
  civil: [
    { label: '1" = 10\'', pxPerFoot: 9.6, description: "Small site plans" },
    { label: '1" = 20\'', pxPerFoot: 4.8, description: "Medium site plans" },
    { label: '1" = 30\'', pxPerFoot: 3.2, description: "Large site plans" },
    { label: '1" = 40\'', pxPerFoot: 2.4, description: "Very large sites" },
    { label: '1" = 50\'', pxPerFoot: 1.92, description: "Regional plans" },
    { label: '1" = 60\'', pxPerFoot: 1.6, description: "Large regional" },
    { label: '1" = 100\'', pxPerFoot: 0.96, description: "Master plans" },
  ],
  structural: [
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Overall framing" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Framing plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Connection details" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed connections" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large details" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Connection details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Bolt details" },
  ],
};

export function validateHexColor(color: string | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  if (!hexPattern.test(trimmed)) return null;
  if (trimmed.length === 4) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (trimmed.length === 5) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (trimmed.length === 9) {
    return trimmed.substring(0, 7);
  }
  return trimmed;
}

export function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
