import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export interface KeyboardShortcut {
  keys: string;
  description: string;
}

interface ShortcutsContextValue {
  registerShortcuts: (id: string, shortcuts: KeyboardShortcut[]) => () => void;
}

const ShortcutsContext = createContext<ShortcutsContextValue | null>(null);

const GLOBAL_SHORTCUTS: KeyboardShortcut[] = [
  { keys: "?", description: "Show keyboard shortcuts" },
  { keys: "⌘K / Ctrl+K", description: "Open command palette" },
  { keys: "Hold Space", description: "Pan plan/takeoff canvas from any tool (release to restore tool)" },
];

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return false;
}

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [registry, setRegistry] = useState<Record<string, KeyboardShortcut[]>>({});

  const registerShortcuts = useMemo(
    () => (id: string, shortcuts: KeyboardShortcut[]) => {
      setRegistry((prev) => {
        if (prev[id] === shortcuts) return prev;
        return { ...prev, [id]: shortcuts };
      });
      return () => {
        setRegistry((prev) => {
          if (!(id in prev)) return prev;
          const { [id]: _removed, ...rest } = prev;
          return rest;
        });
      };
    },
    [],
  );

  // NOTE: The context value MUST be memoized. If a new object is returned on
  // every render, consumers using `useRegisterShortcuts` see a new `ctx` each
  // render, re-run their effect, call `setRegistry` again, and trigger a
  // "Maximum update depth exceeded" loop on pages that register shortcuts
  // (e.g. /crm). See task-571.
  const contextValue = useMemo(
    () => ({ registerShortcuts }),
    [registerShortcuts],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const pageShortcuts = useMemo(
    () => Object.values(registry).flat(),
    [registry],
  );

  return (
    <ShortcutsContext.Provider value={contextValue}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-keyboard-shortcuts">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Available keyboard shortcuts on this page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {pageShortcuts.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  This page
                </h4>
                <ul className="space-y-1.5">
                  {pageShortcuts.map((s, i) => (
                    <li
                      key={`page-${i}`}
                      className="flex items-center justify-between gap-4 text-sm"
                      data-testid={`shortcut-page-${i}`}
                    >
                      <span className="text-foreground">{s.description}</span>
                      <kbd className="px-2 py-0.5 rounded border bg-muted font-mono text-xs">
                        {s.keys}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Global
              </h4>
              <ul className="space-y-1.5">
                {GLOBAL_SHORTCUTS.map((s, i) => (
                  <li
                    key={`global-${i}`}
                    className="flex items-center justify-between gap-4 text-sm"
                    data-testid={`shortcut-global-${i}`}
                  >
                    <span className="text-foreground">{s.description}</span>
                    <kbd className="px-2 py-0.5 rounded border bg-muted font-mono text-xs">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ShortcutsContext.Provider>
  );
}

export function useRegisterShortcuts(id: string, shortcuts: KeyboardShortcut[], enabled: boolean = true) {
  const ctx = useContext(ShortcutsContext);
  // Stable JSON key to avoid re-registering when array identity changes
  const key = JSON.stringify(shortcuts);
  useEffect(() => {
    if (!ctx || !enabled) return;
    const unregister = ctx.registerShortcuts(id, shortcuts);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, id, key, enabled]);
}

export const TABLE_NAV_SHORTCUTS: KeyboardShortcut[] = [
  { keys: "J", description: "Move row focus down" },
  { keys: "K", description: "Move row focus up" },
  { keys: "Enter", description: "Open focused row" },
  { keys: "/", description: "Focus search" },
];
