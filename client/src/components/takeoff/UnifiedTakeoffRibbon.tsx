import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Keyboard, Cloud, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  RIBBON_GROUPS,
  ORTHO_PRESETS,
  SHORTCUT_BY_ID,
  SNAP_MODE_LABELS,
  SNAP_MODE_ORDER,
  ribbonGroupsStorageKey,
  type ConstraintMode,
  type RibbonGroupId,
  type SnapMode,
} from "./hosts/takeoff-shortcuts";
import { DimInputHUD } from "./DimInputHUD";
import type { ParsedDimension, DefaultUnits } from "@/lib/takeoffTypedInput";
import type { Tool } from "./types";

export interface UnifiedTakeoffRibbonProps {
  userId: string | null | undefined;
  /** Active canvas tool — the matching Select/Measure/Annotate button
   *  is highlighted. */
  activeTool: Tool;
  onToolSelect: (tool: Tool) => void;
  /** Snap group state (multi-select). */
  enabledSnapModes: SnapMode[];
  setEnabledSnapModes: (modes: SnapMode[]) => void;
  snapHudOpen: boolean;
  setSnapHudOpen: (v: boolean) => void;
  /** Constrain group state (radio). `ortho` mirrors the legacy
   *  orthoLock flag; `ortho-angle` reflects an active preset. */
  constraintMode: ConstraintMode;
  setConstraintMode: (m: ConstraintMode) => void;
  orthoPresetIndex: number;
  setOrthoPresetIndex: (i: number) => void;
  orthoLock: boolean;
  setOrthoLock: (v: boolean) => void;
  /** View > Grid. */
  gridEnabled: boolean;
  setGridEnabled: (v: boolean) => void;
  /** Verify > Calibrate. */
  onOpenCalibrate: () => void;
  isCalibrated: boolean;
  /** Cheat-sheet trigger (right-rail keyboard button + Cmd/Ctrl+/). */
  onOpenCheatSheet: () => void;
  /** Offline / autosave indicator state. */
  isOffline: boolean;
  pendingOutboxCount: number;
  isSyncing: boolean;
  /** Show the labeled (icon + text) variant when the user has the
   *  "labeled toolbar" preference on. */
  labeled?: boolean;
  /** Task #2140 — Dim Input HUD wiring. The HUD is rendered next to
   *  the Measure group only when a measure draw is in progress so it
   *  doesn't intercept keystrokes during normal canvas use. */
  dimHudActive?: boolean;
  dimHudUnits?: DefaultUnits;
  onDimCommit?: (parsed: ParsedDimension, mode: "continue" | "finish") => void;
  onDimCancelTyped?: () => void;
}

interface RibbonButtonState {
  active: boolean;
  disabled: boolean;
}

function shortcutKeysFor(shortcutId: string | null | undefined): string | null {
  if (!shortcutId) return null;
  return SHORTCUT_BY_ID[shortcutId]?.keys ?? null;
}

export function UnifiedTakeoffRibbon(props: UnifiedTakeoffRibbonProps) {
  const {
    userId,
    activeTool,
    onToolSelect,
    enabledSnapModes,
    setEnabledSnapModes,
    snapHudOpen,
    setSnapHudOpen,
    constraintMode,
    setConstraintMode,
    orthoPresetIndex,
    setOrthoPresetIndex,
    orthoLock,
    setOrthoLock,
    gridEnabled,
    setGridEnabled,
    onOpenCalibrate,
    isCalibrated,
    onOpenCheatSheet,
    isOffline,
    pendingOutboxCount,
    isSyncing,
    labeled,
    dimHudActive = false,
    dimHudUnits = "ft",
    onDimCommit,
    onDimCancelTyped,
  } = props;

  // Per-user collapsed state for each ribbon group. Persisted so the
  // user's preferred layout survives reloads / sheet switches.
  //
  // userId may be null on first render (auth still loading) and arrive
  // later. We track which storageKey we've hydrated from so a late
  // userId rehydrates from localStorage exactly once instead of either
  // being lost (no read) or overwriting the stored prefs with the
  // empty default (eager write before read).
  const storageKey = ribbonGroupsStorageKey(userId);
  const [collapsed, setCollapsed] = useState<Record<RibbonGroupId, boolean>>(() => {
    if (!storageKey) return {} as Record<RibbonGroupId, boolean>;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return {} as Record<RibbonGroupId, boolean>;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<RibbonGroupId, boolean>;
    } catch {
      // ignore
    }
    return {} as Record<RibbonGroupId, boolean>;
  });
  const hydratedKeyRef = useRef<string | null>(storageKey);
  useEffect(() => {
    if (!storageKey || hydratedKeyRef.current === storageKey) return;
    // userId arrived (or changed) — rehydrate from the new namespace.
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setCollapsed(parsed as Record<RibbonGroupId, boolean>);
        }
      }
    } catch {
      // ignore
    }
    hydratedKeyRef.current = storageKey;
  }, [storageKey]);
  useEffect(() => {
    // Only persist after we've hydrated from the active key, otherwise
    // the empty-default `collapsed` would overwrite the stored prefs
    // before the late-arriving userId effect above gets a chance to read
    // them.
    if (!storageKey || hydratedKeyRef.current !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed, storageKey]);

  const toggleGroup = useCallback((id: RibbonGroupId) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Roving tabindex per group. Tab moves group → group (each group
  // exposes exactly one tabIndex=0 button at a time); ←/→ moves
  // tool → tool inside the active group. Enter activates the focused
  // button (native <button> behavior).
  const [focusIndexByGroup, setFocusIndexByGroup] = useState<Partial<Record<RibbonGroupId, number>>>({});
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const setButtonRef = useCallback((key: string) => (el: HTMLButtonElement | null) => {
    buttonRefs.current[key] = el;
  }, []);

  const handleGroupKeyDown = useCallback(
    (groupId: RibbonGroupId, toolCount: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const cur = focusIndexByGroup[groupId] ?? 0;
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = (cur + delta + toolCount) % toolCount;
      setFocusIndexByGroup((prev) => ({ ...prev, [groupId]: next }));
      const refKey = `${groupId}:${next}`;
      const btn = buttonRefs.current[refKey];
      btn?.focus();
    },
    [focusIndexByGroup],
  );

  // For tool buttons in Select / Measure / Annotate groups, "active"
  // mirrors the canvas activeTool. Snap group active state is
  // multi-select; Constrain is radio.
  const buttonState = useCallback(
    (groupId: RibbonGroupId, toolId: string, tool: Tool | null, action?: string): RibbonButtonState => {
      if (groupId === "snap") {
        return { active: enabledSnapModes.includes(toolId as SnapMode), disabled: false };
      }
      if (groupId === "constrain") {
        if (toolId === "ortho") return { active: constraintMode === "ortho", disabled: false };
        if (toolId === "ortho-angle") return { active: constraintMode === "ortho-angle", disabled: false };
        if (toolId === "none") return { active: constraintMode === "none", disabled: false };
        return { active: false, disabled: false };
      }
      if (action === "show-grid") {
        return { active: gridEnabled, disabled: false };
      }
      if (action === "calibrate") {
        return { active: false, disabled: false };
      }
      return { active: !!tool && activeTool === tool, disabled: false };
    },
    [enabledSnapModes, constraintMode, gridEnabled, activeTool],
  );

  const handleToolClick = useCallback(
    (
      groupId: RibbonGroupId,
      toolId: string,
      tool: Tool | null,
      action: string | undefined,
    ) => {
      if (groupId === "snap") {
        const mode = toolId as SnapMode;
        if (enabledSnapModes.includes(mode)) {
          setEnabledSnapModes(enabledSnapModes.filter((m) => m !== mode));
        } else {
          setEnabledSnapModes([...enabledSnapModes, mode]);
        }
        return;
      }
      if (groupId === "constrain") {
        if (toolId === "none") {
          setConstraintMode("none");
          setOrthoLock(false);
          return;
        }
        if (toolId === "ortho") {
          const next = !orthoLock;
          setOrthoLock(next);
          setConstraintMode(next ? "ortho" : "none");
          return;
        }
        if (toolId === "ortho-angle") {
          // Cycle preset (mirrors Shift+O).
          const nextIdx = (orthoPresetIndex + 1) % ORTHO_PRESETS.length;
          setOrthoPresetIndex(nextIdx);
          const preset = ORTHO_PRESETS[nextIdx];
          if (preset === null) {
            setConstraintMode("none");
            setOrthoLock(false);
          } else {
            setConstraintMode("ortho-angle");
            setOrthoLock(true);
          }
          return;
        }
        return;
      }
      if (action === "calibrate") {
        onOpenCalibrate();
        return;
      }
      if (action === "show-grid") {
        setGridEnabled(!gridEnabled);
        return;
      }
      if (tool) {
        onToolSelect(tool);
      }
    },
    [
      enabledSnapModes,
      setEnabledSnapModes,
      orthoLock,
      orthoPresetIndex,
      setConstraintMode,
      setOrthoLock,
      setOrthoPresetIndex,
      onOpenCalibrate,
      setGridEnabled,
      gridEnabled,
      onToolSelect,
    ],
  );

  const orthoPresetLabel = useMemo(() => {
    const preset = ORTHO_PRESETS[orthoPresetIndex];
    return preset === null ? "off" : `${preset}°`;
  }, [orthoPresetIndex]);

  return (
    <div
      role="toolbar"
      aria-label="Takeoff ribbon"
      className="bg-card border-b shrink-0 w-full overflow-x-auto"
      data-testid="unified-takeoff-ribbon"
    >
      <div className="flex items-stretch gap-0 min-w-max">
        {RIBBON_GROUPS.map((group) => {
          const isCollapsed = !!collapsed[group.id];
          const focusedIdx = focusIndexByGroup[group.id] ?? 0;
          return (
            <section
              key={group.id}
              role="group"
              aria-label={group.label}
              data-testid={`ribbon-group-${group.id}`}
              data-collapsed={isCollapsed ? "true" : "false"}
              className="flex flex-col border-r last:border-r-0 px-2 py-1 min-w-[80px]"
              onKeyDown={isCollapsed ? undefined : handleGroupKeyDown(group.id, group.tools.length)}
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                /* Keep group-toggle headers OUT of the natural Tab order so
                 * pressing Tab moves focus group→group across the active
                 * tool of each group (each group exposes exactly one
                 * tabIndex=0 tool button). The toggle is still keyboard-
                 * reachable via shift-click or by mouse; arrow-key
                 * navigation handles in-group movement. */
                tabIndex={-1}
                className="flex items-center justify-between gap-1 px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover-elevate rounded"
                data-testid={`ribbon-group-toggle-${group.id}`}
                aria-expanded={!isCollapsed}
                aria-controls={`ribbon-group-tools-${group.id}`}
              >
                <span>{group.label}</span>
                {isCollapsed ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronUp className="w-3 h-3" />
                )}
              </button>
              {!isCollapsed && (
                <div
                  className="flex items-center gap-0.5 mt-1"
                  id={`ribbon-group-tools-${group.id}`}
                  data-testid={`ribbon-group-tools-${group.id}`}
                >
                  {group.tools.map((tool, idx) => {
                    const Icon = tool.icon;
                    const state = buttonState(group.id, tool.id, tool.tool, tool.action);
                    const disabled = !!tool.disabled || state.disabled;
                    const showShortcut = shortcutKeysFor(tool.shortcutId);
                    const tooltipText = tool.tooltip || tool.label;
                    const refKey = `${group.id}:${idx}`;
                    return (
                      <Tooltip key={tool.id}>
                        <TooltipTrigger asChild>
                          <Button
                            ref={setButtonRef(refKey)}
                            type="button"
                            size="sm"
                            variant={state.active ? "secondary" : "ghost"}
                            disabled={disabled}
                            onClick={() =>
                              !disabled &&
                              handleToolClick(group.id, tool.id, tool.tool, tool.action)
                            }
                            tabIndex={focusedIdx === idx ? 0 : -1}
                            data-testid={`ribbon-tool-${tool.id}`}
                            data-active={state.active ? "true" : "false"}
                            data-disabled={disabled ? "true" : "false"}
                            aria-pressed={state.active}
                            aria-label={tool.label}
                            className={cn(
                              "h-8 px-1.5 gap-1 text-xs",
                              state.active && "ring-1 ring-primary/40",
                            )}
                            onFocus={() =>
                              setFocusIndexByGroup((prev) => ({ ...prev, [group.id]: idx }))
                            }
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {labeled && <span className="hidden md:inline">{tool.label}</span>}
                            {showShortcut && (
                              <kbd className="hidden lg:inline px-1 py-0 text-[9px] font-mono bg-background/60 rounded border">
                                {showShortcut}
                              </kbd>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          <div className="flex items-center gap-2">
                            <span>{tooltipText}</span>
                            {showShortcut && (
                              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border">
                                {showShortcut}
                              </kbd>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                  {group.id === "constrain" && (
                    <Badge
                      variant={
                        ORTHO_PRESETS[orthoPresetIndex] === null
                          ? "outline"
                          : "secondary"
                      }
                      className="ml-1 text-[9px] uppercase tracking-wide font-mono"
                      data-testid="ribbon-ortho-preset"
                      data-active={
                        ORTHO_PRESETS[orthoPresetIndex] === null
                          ? "false"
                          : "true"
                      }
                    >
                      ORTHO {orthoPresetLabel}
                    </Badge>
                  )}
                  {group.id === "measure" && onDimCommit && (
                    <DimInputHUD
                      active={dimHudActive}
                      units={dimHudUnits}
                      onCommit={onDimCommit}
                      onCancelTyped={onDimCancelTyped}
                    />
                  )}
                  {group.id === "verify" && isCalibrated && (
                    <Badge
                      variant="outline"
                      className="text-[9px] uppercase tracking-wide"
                      data-testid="ribbon-calibrated-badge"
                    >
                      Calibrated
                    </Badge>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {/* Right rail — snap HUD + autosave/offline indicator + cheat sheet */}
        <div className="flex items-center gap-2 ml-auto px-3 border-l">
          {snapHudOpen && (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded bg-muted/40 border"
              role="status"
              data-testid="snap-hud"
            >
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
                Snap
              </span>
              {SNAP_MODE_ORDER.map((mode, idx) => {
                const active = enabledSnapModes.includes(mode);
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      if (active) {
                        setEnabledSnapModes(enabledSnapModes.filter((m) => m !== mode));
                      } else {
                        setEnabledSnapModes([...enabledSnapModes, mode]);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover-elevate",
                      active && "bg-primary text-primary-foreground",
                    )}
                    data-testid={`snap-hud-mode-${mode}`}
                    data-active={active ? "true" : "false"}
                  >
                    <kbd className="px-0.5 font-mono">{idx + 1}</kbd>
                    <span>{SNAP_MODE_LABELS[mode]}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSnapHudOpen(false)}
                className="ml-1 px-1 text-[10px] text-muted-foreground hover-elevate rounded"
                data-testid="snap-hud-close"
              >
                Close
              </button>
            </div>
          )}

          <OfflineAutosaveIndicator
            isOffline={isOffline}
            pendingOutboxCount={pendingOutboxCount}
            isSyncing={isSyncing}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onOpenCheatSheet}
                data-testid="button-open-cheat-sheet"
              >
                <Keyboard className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="flex items-center gap-2">
                <span>Keyboard shortcuts</span>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border">
                  ⌘/
                </kbd>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

interface OfflineAutosaveIndicatorProps {
  isOffline: boolean;
  pendingOutboxCount: number;
  isSyncing: boolean;
}

type IndicatorState = "idle" | "saved" | "queued" | "syncing" | "offline";

const SAVED_FLASH_MS = 2000;

/** State machine:
 *  • offline           → amber chip, always visible
 *  • queued (≥1)       → amber chip, always visible
 *  • syncing           → muted spinner, always visible
 *  • idle (online, 0)  → hidden by default
 *  • saved (transient) → flash a "Saved" chip for SAVED_FLASH_MS when
 *    pendingOutboxCount drops back to zero, then fade to idle.
 */
function OfflineAutosaveIndicator({
  isOffline,
  pendingOutboxCount,
  isSyncing,
}: OfflineAutosaveIndicatorProps) {
  const prevPendingRef = useRef(pendingOutboxCount);
  const prevOfflineRef = useRef(isOffline);
  const [showSavedFlash, setShowSavedFlash] = useState(false);

  useEffect(() => {
    const droppedToZero =
      prevPendingRef.current > 0 && pendingOutboxCount === 0 && !isOffline;
    const cameBackOnline =
      prevOfflineRef.current && !isOffline && pendingOutboxCount === 0;
    if (droppedToZero || cameBackOnline) {
      setShowSavedFlash(true);
      const t = window.setTimeout(() => setShowSavedFlash(false), SAVED_FLASH_MS);
      return () => window.clearTimeout(t);
    }
  }, [pendingOutboxCount, isOffline]);

  useEffect(() => {
    prevPendingRef.current = pendingOutboxCount;
    prevOfflineRef.current = isOffline;
  }, [pendingOutboxCount, isOffline]);

  let state: IndicatorState;
  if (isOffline) state = "offline";
  else if (isSyncing) state = "syncing";
  else if (pendingOutboxCount > 0) state = "queued";
  else if (showSavedFlash) state = "saved";
  else state = "idle";

  // Hidden idle state — render an empty placeholder so the testid is
  // queryable but the chip is invisible. Tests assert the data-state
  // attribute to verify the state machine without depending on
  // visibility.
  if (state === "idle") {
    return (
      <div
        data-testid="indicator-offline-status"
        data-state="idle"
        aria-hidden="true"
        className="hidden"
      />
    );
  }

  let label: string;
  let Icon = Cloud;
  if (state === "offline") {
    Icon = CloudOff;
    label = pendingOutboxCount > 0
      ? `Offline · ${pendingOutboxCount} queued`
      : "Offline";
  } else if (state === "syncing") {
    Icon = Loader2;
    label = pendingOutboxCount > 0 ? `Syncing ${pendingOutboxCount}…` : "Syncing…";
  } else if (state === "queued") {
    Icon = Cloud;
    label = `${pendingOutboxCount} queued`;
  } else {
    label = "Saved";
  }

  const isWarn = state === "offline" || state === "queued";
  const isFading = state === "saved";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] transition-opacity duration-700",
            isWarn && "border-amber-300 text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-900/20",
            !isWarn && "border-muted text-muted-foreground",
            isFading && "opacity-70",
          )}
          data-testid="indicator-offline-status"
          data-state={state}
        >
          <Icon className={cn("w-3.5 h-3.5", state === "syncing" && "animate-spin")} />
          <span>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {state === "offline"
          ? "You're offline. Changes are queued and will sync when you reconnect."
          : state === "queued"
            ? `${pendingOutboxCount} change${pendingOutboxCount === 1 ? "" : "s"} pending sync.`
            : state === "syncing"
              ? "Syncing changes to the server…"
              : "All changes are saved."}
      </TooltipContent>
    </Tooltip>
  );
}
