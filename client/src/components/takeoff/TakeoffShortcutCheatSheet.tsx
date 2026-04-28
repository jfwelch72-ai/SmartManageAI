import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  SHORTCUTS,
  SHORTCUT_GROUP_LABELS,
  type Shortcut,
  type ShortcutGroupId,
} from "./hosts/takeoff-shortcuts";

interface TakeoffShortcutCheatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Order matches the visible ribbon, plus the global bucket at the
 *  end for modal/editing keys that don't belong to any single group. */
const GROUP_ORDER: ShortcutGroupId[] = [
  "select",
  "measure",
  "annotate",
  "snap",
  "constrain",
  "verify",
  "view",
  "global",
];

function matchesQuery(s: Shortcut, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  if (!needle) return true;
  return (
    s.keys.toLowerCase().includes(needle) ||
    s.matchKey.toLowerCase().includes(needle) ||
    s.label.toLowerCase().includes(needle) ||
    (s.description?.toLowerCase().includes(needle) ?? false) ||
    SHORTCUT_GROUP_LABELS[s.groupId].toLowerCase().includes(needle)
  );
}

export function TakeoffShortcutCheatSheet({ open, onOpenChange }: TakeoffShortcutCheatSheetProps) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    return GROUP_ORDER.map((g) => ({
      id: g,
      label: SHORTCUT_GROUP_LABELS[g],
      rows: SHORTCUTS.filter((s) => s.groupId === g && matchesQuery(s, query)),
    })).filter((g) => g.rows.length > 0);
  }, [query]);

  const totalMatches = grouped.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-3xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-cheat-sheet"
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Bindings come from the takeoff interaction map. Press{" "}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Cmd/Ctrl + /</kbd>{" "}
            any time to reopen this sheet.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mt-2 mb-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts… (e.g. ortho, calibrate, snap)"
            className="pl-8"
            data-testid="input-cheat-sheet-search"
            autoFocus
          />
        </div>

        <div
          className="text-[11px] text-muted-foreground mb-2"
          data-testid="text-cheat-sheet-match-count"
        >
          {totalMatches} {totalMatches === 1 ? "shortcut" : "shortcuts"}
          {query ? ` matching "${query}"` : ""}
        </div>

        {grouped.length === 0 ? (
          <div
            className="text-sm text-muted-foreground text-center py-8"
            data-testid="text-cheat-sheet-empty"
          >
            No shortcuts match "{query}".
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 mt-1">
            {grouped.map(({ id, label, rows }) => (
              <div key={id} data-testid={`cheat-sheet-group-${id}`}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {label}
                </h3>
                <ul className="space-y-1.5">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-start gap-3 text-sm"
                      data-testid={`cheat-sheet-row-${r.id}`}
                    >
                      <kbd className="shrink-0 px-1.5 py-0.5 text-xs font-mono bg-muted rounded border min-w-[5rem] text-center">
                        {r.keys}
                      </kbd>
                      <div className="flex-1">
                        <span className="text-foreground/90">{r.label}</span>
                        {r.description && r.description !== r.label && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {r.description}
                          </div>
                        )}
                      </div>
                      {r.comingSoon && (
                        <Badge variant="outline" className="text-[9px] uppercase tracking-wide shrink-0">
                          soon
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
