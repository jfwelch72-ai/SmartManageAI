import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "estimate-export:include-formulas";
const CHANGE_EVENT = "estimate-export:include-formulas-changed";

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Shared preference for the "include step-by-step formula breakdowns"
 * toggle on the PDF and Excel export popovers.
 *
 * Persists the user's last choice in localStorage under a single key so
 * the two popovers stay in sync — both across reloads and across mounted
 * instances within the same tab (via a custom event broadcast).
 */
export function useExportIncludeFormulas(): [boolean, (value: boolean) => void] {
  const [includeFormulas, setIncludeFormulasState] = useState<boolean>(
    readStoredPreference,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => setIncludeFormulasState(readStoredPreference());

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) sync();
    };
    const onCustom = () => sync();

    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onCustom);
    };
  }, []);

  const setIncludeFormulas = useCallback((value: boolean) => {
    setIncludeFormulasState(value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
    } catch {
      /* localStorage unavailable (private mode, quota) — keep in-memory state */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [includeFormulas, setIncludeFormulas];
}
