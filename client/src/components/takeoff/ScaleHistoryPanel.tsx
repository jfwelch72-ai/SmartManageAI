import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { History, Ruler, Unlock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface ScaleHistoryUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface ScaleHistoryEntry {
  id: string;
  createdAt: string;
  action: string;
  scalePxPerFoot: number | null;
  scaleLabel: string | null;
  units: string | null;
  scaleSource: string | null;
  scaleConfidence: string | null;
  source: string | null;
  sheetSetId: string | null;
  supersedesSheetId: string | null;
  previousScalePxPerFoot: number | null;
  previousScaleLabel: string | null;
  previousScaleSource: string | null;
  previousScaleConfidence: string | null;
  user: ScaleHistoryUser | null;
}

export interface ScaleHistoryNote {
  id: string;
  createdAt: string;
  action: string;
  message: string;
  user: ScaleHistoryUser | null;
}

export interface UnlockRescaleEntry {
  id: string;
  createdAt: string;
  measurementId: string;
  measurementLabel: string | null;
  measurementType: string | null;
  previousLockedScalePxPerFoot: number | null;
  sheetScalePxPerFoot: number | null;
  beforeLengthFt: number | null;
  afterLengthFt: number | null;
  beforeAreaFt2: number | null;
  afterAreaFt2: number | null;
  beforeVolumeCy: number | null;
  afterVolumeCy: number | null;
  user: ScaleHistoryUser | null;
}

export interface ScaleHistoryResponse {
  sheetId: string;
  current: {
    scalePxPerFoot: number | null;
    scaleLabel: string | null;
    units: string | null;
    scaleSource: string | null;
    scaleConfidence: string | null;
    scaleCalibratedAt: string | null;
    calibratedBy: ScaleHistoryUser | null;
  } | null;
  entries: ScaleHistoryEntry[];
  notes: ScaleHistoryNote[];
  unlockRescaleEntries?: UnlockRescaleEntry[];
}

type HistoryFilter = "all" | "calibrations" | "unlock_rescale";

interface ScaleHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetId: string | null;
  sheetName?: string | null;
}

function confidenceDotClass(confidence: string | null | undefined): string {
  switch (confidence) {
    case "HIGH":
      return "bg-green-500 dark:bg-green-400";
    case "MEDIUM":
    case "LOW":
      return "bg-amber-500 dark:bg-amber-400";
    case "UNVERIFIED":
    default:
      return "bg-red-500 dark:bg-red-400";
  }
}

function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case "USER_TWO_POINT":
      return "Two-point ruler";
    case "STANDARD_SCALE":
      return "Standard scale";
    case "AI_DETECTED":
      return "Auto-detected";
    case "BULK_PROPAGATED":
      return "Sheet Set apply";
    case "INHERITED_FROM_PARENT":
      return "Inherited from parent";
    case "UNVERIFIED":
      return "Unverified";
    default:
      return source ? source : "Unknown";
  }
}

function originLabel(source: string | null | undefined): string | null {
  switch (source) {
    case "calibration":
      return "Manual calibration";
    case "batch_calibration":
      return "Bulk calibration";
    case "sheet_set_apply":
      return "Applied via Sheet Set";
    case "sheet_set_restore":
      return "Restored (Undo)";
    case "supersede":
      return "Inherited from previous revision";
    default:
      return null;
  }
}

function userInitials(user: ScaleHistoryUser | null): string {
  if (!user) return "?";
  const f = (user.firstName || "").trim();
  const l = (user.lastName || "").trim();
  if (f || l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || "?";
  if (user.email) return user.email.charAt(0).toUpperCase();
  return "?";
}

function userDisplayName(user: ScaleHistoryUser | null): string {
  if (!user) return "Unknown user";
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  if (name) return name;
  return user.email ?? "Unknown user";
}

function formatScale(
  scalePxPerFoot: number | null,
  scaleLabel: string | null,
): string {
  if (scaleLabel && scaleLabel.trim().length > 0) return scaleLabel;
  if (scalePxPerFoot != null) return `${scalePxPerFoot.toFixed(2)} px/ft`;
  return "—";
}

function safeFormatDate(iso: string): string {
  try {
    return format(new Date(iso), "PP p");
  } catch {
    return iso;
  }
}

function formatPxPerFoot(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} px/ft`;
}

function formatNumber(
  value: number | null | undefined,
  fractionDigits: number,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDelta(before: number | null, after: number | null, fractionDigits: number): string {
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) {
    return "—";
  }
  const delta = after - before;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${Math.abs(delta).toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function measurementTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "LINEAR":
      return "Linear";
    case "AREA":
      return "Area";
    case "VOLUME":
      return "Volume";
    case "COUNT":
      return "Count";
    default:
      return type ?? "Measurement";
  }
}

export function ScaleHistoryPanel({
  open,
  onOpenChange,
  sheetId,
  sheetName,
}: ScaleHistoryPanelProps) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const { data, isLoading, isError } = useQuery<ScaleHistoryResponse>({
    queryKey: ["/api/takeoff/sheets", sheetId, "scale-history"],
    queryFn: async () => {
      const res = await fetch(
        `/api/takeoff/sheets/${sheetId}/scale-history`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load scale history");
      return res.json();
    },
    enabled: open && !!sheetId,
  });

  const unlockEntries = useMemo(
    () => data?.unlockRescaleEntries ?? [],
    [data?.unlockRescaleEntries],
  );
  const showCalibrations = filter === "all" || filter === "calibrations";
  const showUnlockRescale = filter === "all" || filter === "unlock_rescale";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md overflow-y-auto"
        data-testid="panel-scale-history"
      >
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Scale history
          </SheetTitle>
          <SheetDescription>
            {sheetName
              ? `Every calibration change for ${sheetName}.`
              : "Every calibration change for this sheet."}
          </SheetDescription>
        </SheetHeader>

        {!sheetId ? (
          <div
            className="text-center py-8 text-muted-foreground text-sm"
            data-testid="text-scale-history-no-sheet"
          >
            Select a sheet to view its scale history.
          </div>
        ) : isLoading ? (
          <div
            className="text-center py-8 text-muted-foreground text-sm"
            data-testid="text-scale-history-loading"
          >
            Loading scale history…
          </div>
        ) : isError ? (
          <div
            className="text-center py-8 text-destructive text-sm"
            data-testid="text-scale-history-error"
          >
            Failed to load scale history.
          </div>
        ) : (
          <div className="space-y-5">
            {data?.current && (
              <div
                className="rounded-md border bg-muted/40 p-3 space-y-2"
                data-testid="card-scale-history-current"
              >
                <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground tracking-wide">
                  <Ruler className="w-3 h-3" />
                  Currently applied
                </div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      confidenceDotClass(data.current.scaleConfidence),
                    )}
                    aria-hidden
                  />
                  <span data-testid="text-scale-history-current-scale">
                    {formatScale(
                      data.current.scalePxPerFoot,
                      data.current.scaleLabel,
                    )}
                  </span>
                  {data.current.units && (
                    <span className="text-xs text-muted-foreground">
                      ({data.current.units})
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-normal">
                    {sourceLabel(data.current.scaleSource)}
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    {data.current.scaleConfidence ?? "UNVERIFIED"}
                  </Badge>
                </div>
                {(data.current.calibratedBy ||
                  data.current.scaleCalibratedAt) && (
                  <div className="flex items-center gap-2 pt-1">
                    <Avatar className="h-6 w-6">
                      {data.current.calibratedBy?.avatarUrl ? (
                        <AvatarImage
                          src={data.current.calibratedBy.avatarUrl}
                          alt={userDisplayName(data.current.calibratedBy)}
                        />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        {userInitials(data.current.calibratedBy)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-xs">
                      <div data-testid="text-scale-history-current-user">
                        {userDisplayName(data.current.calibratedBy)}
                      </div>
                      {data.current.scaleCalibratedAt && (
                        <div className="text-muted-foreground">
                          {safeFormatDate(data.current.scaleCalibratedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between gap-2">
              <div className="text-xs uppercase text-muted-foreground tracking-wide">
                Filter activity
              </div>
              <Select
                value={filter}
                onValueChange={(value) => setFilter(value as HistoryFilter)}
              >
                <SelectTrigger
                  className="h-8 w-[180px] text-xs"
                  data-testid="select-scale-history-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-scale-history-filter-all">
                    All activity
                  </SelectItem>
                  <SelectItem
                    value="calibrations"
                    data-testid="option-scale-history-filter-calibrations"
                  >
                    Calibrations only
                  </SelectItem>
                  <SelectItem
                    value="unlock_rescale"
                    data-testid="option-scale-history-filter-unlock-rescale"
                  >
                    Unlock &amp; rescale only
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showCalibrations && (data?.entries.length === 0 ? (
              <div
                className="text-center py-8 text-muted-foreground text-sm"
                data-testid="text-scale-history-empty"
              >
                No calibration changes recorded yet for this sheet.
              </div>
            ) : (
              <ol className="space-y-3" data-testid="list-scale-history">
                {data?.entries.map((entry) => {
                  const origin = originLabel(entry.source);
                  return (
                    <li
                      key={entry.id}
                      className="rounded-md border p-3 space-y-2"
                      data-testid={`scale-history-entry-${entry.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span
                            className={cn(
                              "inline-block h-2 w-2 rounded-full",
                              confidenceDotClass(entry.scaleConfidence),
                            )}
                            aria-hidden
                          />
                          <span
                            data-testid={`text-scale-history-entry-scale-${entry.id}`}
                          >
                            {formatScale(entry.scalePxPerFoot, entry.scaleLabel)}
                          </span>
                          {entry.units && (
                            <span className="text-xs text-muted-foreground">
                              ({entry.units})
                            </span>
                          )}
                        </div>
                        <span
                          className="text-xs text-muted-foreground whitespace-nowrap"
                          data-testid={`text-scale-history-entry-time-${entry.id}`}
                        >
                          {safeFormatDate(entry.createdAt)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-normal text-xs">
                          {sourceLabel(entry.scaleSource)}
                        </Badge>
                        <Badge variant="outline" className="font-normal text-xs">
                          {entry.scaleConfidence ?? "UNVERIFIED"}
                        </Badge>
                        {origin && (
                          <Badge
                            variant="secondary"
                            className="font-normal text-xs"
                          >
                            {origin}
                          </Badge>
                        )}
                      </div>

                      {entry.previousScalePxPerFoot != null &&
                        entry.previousScalePxPerFoot !==
                          entry.scalePxPerFoot && (
                          <div
                            className="text-xs text-muted-foreground"
                            data-testid={`text-scale-history-entry-from-${entry.id}`}
                          >
                            From{" "}
                            {formatScale(
                              entry.previousScalePxPerFoot,
                              entry.previousScaleLabel,
                            )}{" "}
                            ({sourceLabel(entry.previousScaleSource)})
                          </div>
                        )}

                      <div className="flex items-center gap-2 pt-1">
                        <Avatar className="h-6 w-6">
                          {entry.user?.avatarUrl ? (
                            <AvatarImage
                              src={entry.user.avatarUrl}
                              alt={userDisplayName(entry.user)}
                            />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {userInitials(entry.user)}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className="text-xs"
                          data-testid={`text-scale-history-entry-user-${entry.id}`}
                        >
                          {userDisplayName(entry.user)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ))}

            {showUnlockRescale && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground tracking-wide">
                  <Unlock className="w-3 h-3" />
                  Unlock &amp; rescale
                </div>
                {unlockEntries.length === 0 ? (
                  <div
                    className="text-center py-6 text-muted-foreground text-sm"
                    data-testid="text-unlock-rescale-empty"
                  >
                    No unlock-and-rescale activity recorded for this sheet.
                  </div>
                ) : (
                  <ol
                    className="space-y-3"
                    data-testid="list-unlock-rescale"
                  >
                    {unlockEntries.map((entry) => {
                      const sheetScale =
                        entry.sheetScalePxPerFoot ??
                        data?.current?.scalePxPerFoot ??
                        null;
                      const showLengthDelta =
                        entry.beforeLengthFt != null ||
                        entry.afterLengthFt != null;
                      const showAreaDelta =
                        entry.beforeAreaFt2 != null ||
                        entry.afterAreaFt2 != null;
                      const showVolumeDelta =
                        entry.beforeVolumeCy != null ||
                        entry.afterVolumeCy != null;
                      return (
                        <li
                          key={entry.id}
                          className="rounded-md border p-3 space-y-2"
                          data-testid={`unlock-rescale-entry-${entry.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div
                              className="flex items-center gap-2 text-sm font-medium"
                              data-testid={`text-unlock-rescale-label-${entry.id}`}
                            >
                              <Unlock className="w-3.5 h-3.5 text-muted-foreground" />
                              <span>
                                {entry.measurementLabel ?? "Untitled measurement"}
                              </span>
                              <Badge
                                variant="outline"
                                className="font-normal text-[10px] uppercase"
                              >
                                {measurementTypeLabel(entry.measurementType)}
                              </Badge>
                            </div>
                            <span
                              className="text-xs text-muted-foreground whitespace-nowrap"
                              data-testid={`text-unlock-rescale-time-${entry.id}`}
                            >
                              {safeFormatDate(entry.createdAt)}
                            </span>
                          </div>

                          <div
                            className="text-xs grid grid-cols-2 gap-x-3 gap-y-1"
                            data-testid={`text-unlock-rescale-scale-${entry.id}`}
                          >
                            <div className="text-muted-foreground">
                              Prior locked scale
                            </div>
                            <div className="font-mono text-right">
                              {formatPxPerFoot(entry.previousLockedScalePxPerFoot)}
                            </div>
                            <div className="text-muted-foreground">
                              Captured sheet scale
                            </div>
                            <div className="font-mono text-right">
                              {formatPxPerFoot(sheetScale)}
                              {entry.sheetScalePxPerFoot == null &&
                                data?.current?.scalePxPerFoot != null && (
                                  <span className="text-[10px] text-muted-foreground ml-1">
                                    (current)
                                  </span>
                                )}
                            </div>
                          </div>

                          {(showLengthDelta || showAreaDelta || showVolumeDelta) && (
                            <div className="rounded border bg-muted/30 p-2 text-xs space-y-1">
                              {showLengthDelta && (
                                <div
                                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center"
                                  data-testid={`text-unlock-rescale-length-${entry.id}`}
                                >
                                  <span className="text-muted-foreground">Length (ft)</span>
                                  <span className="font-mono">
                                    {formatNumber(entry.beforeLengthFt, 2)}
                                  </span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-mono">
                                    {formatNumber(entry.afterLengthFt, 2)}
                                    <span className="ml-1 text-muted-foreground">
                                      ({formatDelta(entry.beforeLengthFt, entry.afterLengthFt, 2)})
                                    </span>
                                  </span>
                                </div>
                              )}
                              {showAreaDelta && (
                                <div
                                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center"
                                  data-testid={`text-unlock-rescale-area-${entry.id}`}
                                >
                                  <span className="text-muted-foreground">Area (ft²)</span>
                                  <span className="font-mono">
                                    {formatNumber(entry.beforeAreaFt2, 1)}
                                  </span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-mono">
                                    {formatNumber(entry.afterAreaFt2, 1)}
                                    <span className="ml-1 text-muted-foreground">
                                      ({formatDelta(entry.beforeAreaFt2, entry.afterAreaFt2, 1)})
                                    </span>
                                  </span>
                                </div>
                              )}
                              {showVolumeDelta && (
                                <div
                                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center"
                                  data-testid={`text-unlock-rescale-volume-${entry.id}`}
                                >
                                  <span className="text-muted-foreground">Volume (CY)</span>
                                  <span className="font-mono">
                                    {formatNumber(entry.beforeVolumeCy, 2)}
                                  </span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-mono">
                                    {formatNumber(entry.afterVolumeCy, 2)}
                                    <span className="ml-1 text-muted-foreground">
                                      ({formatDelta(entry.beforeVolumeCy, entry.afterVolumeCy, 2)})
                                    </span>
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex items-center gap-2 pt-1">
                            <Avatar className="h-6 w-6">
                              {entry.user?.avatarUrl ? (
                                <AvatarImage
                                  src={entry.user.avatarUrl}
                                  alt={userDisplayName(entry.user)}
                                />
                              ) : null}
                              <AvatarFallback className="text-[10px]">
                                {userInitials(entry.user)}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              className="text-xs"
                              data-testid={`text-unlock-rescale-user-${entry.id}`}
                            >
                              {userDisplayName(entry.user)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}

            {data && data.notes.length > 0 && (
              <div className="space-y-2 pt-2">
                <Separator />
                <div className="text-xs uppercase text-muted-foreground tracking-wide">
                  Other audit entries
                </div>
                <ul className="space-y-2" data-testid="list-scale-history-notes">
                  {data.notes.map((n) => (
                    <li
                      key={n.id}
                      className="rounded-md border p-2 text-xs"
                      data-testid={`scale-history-note-${n.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{n.message}</span>
                        <span className="text-muted-foreground whitespace-nowrap">
                          {safeFormatDate(n.createdAt)}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        {userDisplayName(n.user)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
