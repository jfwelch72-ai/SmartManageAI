import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, ClipboardList, CheckSquare, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EntitySearchResult } from "./types";

interface EntityLinkPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (result: EntitySearchResult) => void;
  selectedEntities: EntitySearchResult[];
}

const ENTITY_ICONS: Record<string, typeof FileText> = {
  RFI: FileText,
  CHANGE_ORDER: ClipboardList,
  TASK: CheckSquare,
};

const ENTITY_LABELS: Record<string, string> = {
  RFI: "RFI",
  CHANGE_ORDER: "CO",
  TASK: "Task",
};

const ENTITY_COLORS: Record<string, string> = {
  RFI: "text-blue-600 dark:text-blue-400",
  CHANGE_ORDER: "text-amber-600 dark:text-amber-400",
  TASK: "text-green-600 dark:text-green-400",
};

export function EntityLinkPicker({ open, onClose, onSelect, selectedEntities }: EntityLinkPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: results = [] } = useQuery<EntitySearchResult[]>({
    queryKey: ["/api/entity-search", query],
    queryFn: async () => {
      const res = await fetch(`/api/entity-search?q=${encodeURIComponent(query)}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
  });

  const filteredResults = results.filter(
    r => !selectedEntities.some(s => s.entityType === r.entityType && s.entityId === r.entityId)
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filteredResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filteredResults[selectedIdx]) {
      e.preventDefault();
      onSelect(filteredResults[selectedIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="mb-2 bg-popover border rounded-lg shadow-lg overflow-hidden" data-testid="entity-link-picker">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search RFIs, Change Orders, Tasks..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          data-testid="input-entity-search"
        />
        <button onClick={onClose} className="p-0.5 rounded hover:bg-muted" data-testid="button-close-entity-picker">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {filteredResults.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            {query ? "No results found" : "Type to search entities"}
          </p>
        ) : (
          filteredResults.map((r, idx) => {
            const Icon = ENTITY_ICONS[r.entityType] || FileText;
            return (
              <button
                key={`${r.entityType}-${r.entityId}`}
                onClick={() => onSelect(r)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                  idx === selectedIdx ? "bg-accent" : "hover:bg-accent/50"
                )}
                data-testid={`button-entity-${r.entityType}-${r.entityId}`}
                role="option"
                aria-selected={idx === selectedIdx}
              >
                <Icon className={cn("w-3.5 h-3.5 shrink-0", ENTITY_COLORS[r.entityType])} />
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  {ENTITY_LABELS[r.entityType]}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">{r.identifier}</span>
                <span className="flex-1 truncate">{r.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export { ENTITY_ICONS, ENTITY_LABELS, ENTITY_COLORS };
