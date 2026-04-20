import { useCallback, useEffect, useRef, useState } from "react";

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return false;
}

interface UseTableKeyboardNavOptions {
  rowCount: number;
  onActivate?: (index: number) => void;
  enabled?: boolean;
}

export interface RowProps {
  "data-focused": "true" | undefined;
  "data-row-index": number;
  tabIndex: -1;
  onMouseEnter: () => void;
}

export function useTableKeyboardNav({ rowCount, onActivate, enabled = true }: UseTableKeyboardNavOptions) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  // Clamp focused index when rowCount changes
  useEffect(() => {
    if (focusedIndex >= rowCount) {
      setFocusedIndex(rowCount > 0 ? rowCount - 1 : -1);
    }
  }, [rowCount, focusedIndex]);

  useEffect(() => {
    if (!enabled || rowCount === 0) return;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(document.activeElement)) return;

      const key = e.key;
      if (key === "j" || key === "J") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < 0 ? 0 : Math.min(prev + 1, rowCount - 1);
          return next;
        });
      } else if (key === "k" || key === "K") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < 0 ? 0 : Math.max(prev - 1, 0);
          return next;
        });
      } else if (key === "Enter") {
        if (focusedIndex >= 0 && focusedIndex < rowCount) {
          e.preventDefault();
          onActivateRef.current?.(focusedIndex);
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, rowCount, focusedIndex]);

  const getRowProps = useCallback(
    (index: number): RowProps => ({
      "data-focused": focusedIndex === index ? "true" : undefined,
      "data-row-index": index,
      tabIndex: -1,
      onMouseEnter: () => setFocusedIndex(index),
    }),
    [focusedIndex],
  );

  return { focusedIndex, setFocusedIndex, getRowProps };
}
