import { AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskMention } from "./types";

interface MentionAutocompleteProps {
  results: TaskMention[];
  selectedIdx: number;
  onSelect: (task: TaskMention) => void;
}

export function MentionAutocomplete({ results, selectedIdx, onSelect }: MentionAutocompleteProps) {
  if (results.length === 0) return null;
  return (
    <div
      className="mb-2 bg-popover border rounded-lg shadow-lg overflow-hidden"
      role="listbox"
      aria-label="Task mentions"
    >
      {results.map((t, idx) => (
        <button
          key={t.id}
          onClick={() => onSelect(t)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
            idx === selectedIdx ? "bg-accent" : "hover:bg-accent/50"
          )}
          data-testid={`button-mention-task-${t.id}`}
          role="option"
          aria-selected={idx === selectedIdx}
        >
          <AtSign className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="flex-1 truncate">{t.title}</span>
          {t.projectName && (
            <span className="text-xs text-muted-foreground truncate max-w-[80px]">{t.projectName}</span>
          )}
        </button>
      ))}
    </div>
  );
}
