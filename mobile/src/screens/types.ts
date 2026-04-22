// Lightweight, intentionally-minimal shapes used by the field-app screens.
// We only model the fields each screen actually reads/displays so the typing
// remains useful without coupling the mobile UI to the full server schema.

export interface CachedProject {
  id: string;
  name?: string;
}

export interface PunchListItem {
  id?: string;
  localId?: string;
  status?: "OPEN" | "IN_PROGRESS" | "CLOSED" | string;
  title?: string;
  description?: string;
  projectId?: string | null;
  [k: string]: unknown;
}

export interface InspectionItem {
  id?: string;
  localId?: string;
  status?: string;
  title?: string;
  projectId?: string | null;
  [k: string]: unknown;
}

export interface TimePunchItem {
  id?: string;
  localId?: string;
  type?: "IN" | "OUT" | "BREAK_START" | "BREAK_END" | string;
  at?: string;
  latitude?: number | null;
  longitude?: number | null;
  [k: string]: unknown;
}

export interface ConflictRow {
  id: string;
  entityType: string;
  entityId: string;
  localValue: string;
  serverValue: string;
  conflictedAt: string;
  status: "UNRESOLVED" | "RESOLVED" | string;
}
