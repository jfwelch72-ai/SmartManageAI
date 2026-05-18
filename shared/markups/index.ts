export type MarkupTool = "SELECT" | "ARROW" | "TEXT" | "RECTANGLE" | "CLOUD" | "HIGHLIGHT" | "FREEHAND";

export interface MarkupShape {
  id: string;
  tool: MarkupTool | string;
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  text?: string | null;
  createdBy?: string;
}

export function buildBulkMoveUpdates(
  markups: MarkupShape[],
  memberIds: string[],
  ndx: number,
  ndy: number,
): Array<{ id: string; points: Array<{ x: number; y: number }> }> {
  if (ndx === 0 && ndy === 0) return [];
  const out: Array<{ id: string; points: Array<{ x: number; y: number }> }> = [];
  for (const id of memberIds) {
    const m = markups.find((x) => x.id === id);
    if (!m) continue;
    out.push({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x + ndx, y: p.y + ndy })),
    });
  }
  return out;
}

export function buildMoveSnapshot(
  markups: MarkupShape[],
  memberIds: string[],
): Array<{ id: string; points: Array<{ x: number; y: number }> }> {
  const out: Array<{ id: string; points: Array<{ x: number; y: number }> }> = [];
  for (const id of memberIds) {
    const m = markups.find((x) => x.id === id);
    if (!m) continue;
    out.push({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x, y: p.y })),
    });
  }
  return out;
}
