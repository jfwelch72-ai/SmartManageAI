import { RefObject, useEffect } from "react";

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return false;
}

export function useGlobalSearchFocus(
  searchInputRef: RefObject<HTMLInputElement | null>,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(document.activeElement)) return;
      const input = searchInputRef.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select?.();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, searchInputRef]);
}
