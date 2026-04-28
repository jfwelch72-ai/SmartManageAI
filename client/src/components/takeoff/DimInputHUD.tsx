import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  parseTypedDimension,
  isTypedDimensionChar,
  formatParsedDimension,
  type DefaultUnits,
  type ParsedDimension,
} from "@/lib/takeoffTypedInput";

/**
 * Task #2140 — Dim Input HUD (Section 4 of `docs/takeoff-interaction-map.md`).
 *
 * Bluebeam-style typed-dimension entry. Anchored to the ribbon's
 * Measure group so the user always sees what they're typing without
 * looking down at a status bar. Captures keystrokes via a window-level
 * keydown listener installed in **capture phase** so it preempts the
 * existing draw-time Enter/Esc/Backspace handler in
 * `use-takeoff-interactions.ts` while the buffer is non-empty. When
 * the buffer is empty those keys bubble normally and behave as
 * before (Enter completes a polygon, Esc cancels the draw, etc).
 *
 * The HUD never opens its own input element — it would otherwise
 * steal focus from the canvas, breaking pointer-driven workflows
 * like spacebar-pan. All entry is via the global key listener.
 *
 * On every keystroke the HUD parses the buffer and shows either:
 *   • a live preview ("= 12 ft 6 in @ 30°") when the buffer is valid,
 *   • or an inline error with a caret marker ("^") under the
 *     offending character when it isn't.
 *
 * Tab/Enter only commit when the buffer is valid. On a parse failure
 * the keypress is still swallowed (so it doesn't accidentally finish
 * the draw) but the buffer is **preserved** so the user can correct
 * the typo without retyping the whole expression.
 */

export interface DimInputHUDProps {
  /** True only while a measure draw (linear/area/segment/etc) is in
   *  progress. The HUD self-disables outside of an active draw so
   *  typing on the canvas never accidentally consumes `[`/`]` etc. */
  active: boolean;
  /** `'ft'` or `'m'` — controls how a bare number like `12` is
   *  interpreted. */
  units: DefaultUnits;
  /** Commit handler. `mode === 'continue'` (Tab) → keep drawing,
   *  `mode === 'finish'` (Enter) → also close the markup. */
  onCommit: (parsed: ParsedDimension, mode: "continue" | "finish") => void;
  /** Called when the user presses Esc while the buffer has content,
   *  i.e. the user wanted to clear what they were typing without
   *  cancelling the entire draw. */
  onCancelTyped?: () => void;
}

export function DimInputHUD({
  active,
  units,
  onCommit,
  onCancelTyped,
}: DimInputHUDProps) {
  const [buffer, setBuffer] = useState("");
  // Mirror of `buffer` for the keydown closure so we don't have to
  // re-bind the window listener on every keystroke (which would also
  // re-run the cleanup that React's StrictMode double-invokes — we
  // saw `addEventListener`/`removeEventListener` thrash in dev).
  const bufferRef = useRef("");
  const activeRef = useRef(active);
  const unitsRef = useRef(units);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancelTyped);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    unitsRef.current = units;
  }, [units]);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);
  useEffect(() => {
    onCancelRef.current = onCancelTyped;
  }, [onCancelTyped]);

  // Reset buffer whenever the draw ends so a new draw starts clean.
  useEffect(() => {
    if (!active) {
      bufferRef.current = "";
      setBuffer("");
    }
  }, [active]);

  const writeBuffer = useCallback((next: string) => {
    bufferRef.current = next;
    setBuffer(next);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!activeRef.current) return;
      const target = event.target as HTMLElement | null;
      // Ignore keys aimed at form controls — the user is typing into
      // a real input (e.g. a dialog field) and the HUD has no business
      // intercepting that.
      const tag = target?.tagName ?? "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      // Modifier-bearing keys (Ctrl/Cmd shortcuts) never feed the HUD.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key;
      const buf = bufferRef.current;

      if (isTypedDimensionChar(key, buf.length === 0)) {
        event.preventDefault();
        event.stopPropagation();
        writeBuffer(buf + key);
        return;
      }

      if (key === "Backspace") {
        if (buf.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        writeBuffer(buf.slice(0, -1));
        return;
      }

      if (key === "Escape") {
        if (buf.length === 0) return; // let the draw-cancel handler run
        event.preventDefault();
        event.stopPropagation();
        writeBuffer("");
        onCancelRef.current?.();
        return;
      }

      if (key === "Enter" || key === "Tab") {
        if (buf.length === 0) return; // bubble to existing finish/cancel
        event.preventDefault();
        event.stopPropagation();
        const parsed = parseTypedDimension(buf, unitsRef.current);
        if (parsed.ok) {
          // Successful commit: hand off + clear so the next typed
          // segment starts from scratch.
          onCommitRef.current(parsed.value, key === "Enter" ? "finish" : "continue");
          writeBuffer("");
        }
        // On parse failure: swallow the key (so we don't accidentally
        // finish the draw with bad input) but **preserve the buffer**.
        // The inline error is already showing the user what to fix.
        return;
      }
    };
    // Capture phase so we run BEFORE the bubble-phase Enter/Esc
    // listeners in `use-takeoff-interactions.ts`.
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [writeBuffer]);

  if (!active) return null;

  const placeholder = `Type dim (e.g. 12${units === "m" ? "m" : "'"}, 12<30, 12,6)`;
  const hasBuffer = buffer.length > 0;
  // Live parse — recomputed every render so the preview / error tracks
  // the buffer in real time.
  const parsed = hasBuffer ? parseTypedDimension(buffer, units) : null;
  const preview = parsed && parsed.ok ? formatParsedDimension(parsed.value, units) : null;
  const error = parsed && !parsed.ok ? parsed.error : null;
  const errorCaret = parsed && !parsed.ok ? parsed.caret : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="dim-input-hud"
      data-active={hasBuffer ? "true" : "false"}
      data-valid={parsed ? (parsed.ok ? "true" : "false") : "empty"}
      className={cn(
        "flex flex-col gap-0.5 px-2 py-1 rounded border text-xs font-mono",
        !hasBuffer && "bg-muted/40 border-muted text-muted-foreground",
        hasBuffer && parsed?.ok && "bg-primary/10 border-primary/40 text-foreground",
        hasBuffer && parsed && !parsed.ok && "bg-destructive/10 border-destructive/40 text-foreground",
      )}
    >
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide opacity-70 mr-1">
          Dim
        </span>
        <span data-testid="dim-input-hud-buffer" className="min-w-[5ch]">
          {hasBuffer ? buffer : placeholder}
        </span>
        <span className="text-[10px] opacity-60 ml-1">{units}</span>
        {hasBuffer && (
          <span className="ml-2 text-[9px] opacity-60">
            <kbd className="px-0.5 font-mono">Tab</kbd>=chain{" "}
            <kbd className="px-0.5 font-mono">Enter</kbd>=finish{" "}
            <kbd className="px-0.5 font-mono">Esc</kbd>=clear
          </span>
        )}
      </div>
      {hasBuffer && preview && (
        <div className="text-[10px] text-muted-foreground" data-testid="dim-input-hud-preview">
          = {preview}
        </div>
      )}
      {hasBuffer && error && (
        <div className="flex flex-col gap-0">
          <div
            className="text-[10px] text-destructive"
            data-testid="dim-input-hud-error"
          >
            {error}
          </div>
          <div
            className="text-[10px] text-destructive font-mono leading-none"
            data-testid="dim-input-hud-caret"
            aria-hidden="true"
          >
            {/* Underline the offending character with a caret. */}
            {"\u00a0".repeat(Math.max(0, errorCaret + 4)) + "^"}
          </div>
        </div>
      )}
    </div>
  );
}
