import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Search, X, ChevronDown, Loader2 } from "lucide-react";
import type { CostCode } from "@shared/costCodes";

interface CostCodeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  "data-testid"?: string;
}

export function CostCodeCombobox({ value, onChange, id, "data-testid": testId }: CostCodeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = id ? `${id}-listbox` : "cost-code-listbox";

  const { data: costCodes = [], isLoading } = useQuery<CostCode[]>({
    queryKey: ["/api/cost-codes"],
  });

  const activeCodes = useMemo(() => costCodes.filter(c => c.isActive !== false), [costCodes]);

  const filtered = useMemo(() => {
    if (!search) return activeCodes;
    const s = search.toLowerCase();
    return activeCodes.filter(
      (c) => c.code.toLowerCase().includes(s) || c.description.toLowerCase().includes(s) || c.division?.toLowerCase().includes(s)
    );
  }, [activeCodes, search]);

  const grouped = useMemo(() => {
    const groups: { division: string; items: CostCode[] }[] = [];
    const map = new Map<string, CostCode[]>();
    for (const code of filtered) {
      const div = code.division || "Other";
      if (!map.has(div)) {
        map.set(div, []);
        groups.push({ division: div, items: map.get(div)! });
      }
      map.get(div)!.push(code);
    }
    return groups;
  }, [filtered]);

  const flatItems = useMemo(() => filtered, [filtered]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [filtered.length, search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll("[role='option']");
      if (items[activeIndex]) {
        items[activeIndex].scrollIntoView({ block: "nearest" });
      }
    }
  }, [activeIndex]);

  const handleSelect = useCallback((code: CostCode) => {
    onChange(`${code.code} - ${code.description}`);
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
  }, [onChange]);

  const handleClear = () => {
    onChange("");
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleInputChange = (val: string) => {
    setSearch(val);
    onChange(val);
    if (!open) setOpen(true);
  };

  const handleFocus = () => {
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < flatItems.length) {
          handleSelect(flatItems[activeIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const displayValue = open ? (search || value) : value;

  let globalIndex = -1;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          value={displayValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="Search or type a cost code..."
          className="pl-9 pr-16"
          autoComplete="off"
          data-testid={testId}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isLoading && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          {value && !isLoading && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 rounded-md text-muted-foreground"
              aria-label="Clear cost code"
              data-testid={testId ? `${testId}-clear` : undefined}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </div>

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-50 w-full mt-1 max-h-[280px] overflow-y-auto rounded-md border bg-popover shadow-md"
        >
          {grouped.map((group) => (
            <Fragment key={group.division}>
              <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-3 py-1.5 text-xs font-semibold text-muted-foreground border-b" data-testid={testId ? `${testId}-division-${group.division}` : undefined}>
                {group.division}
              </div>
              {group.items.map((code) => {
                globalIndex++;
                const idx = globalIndex;
                return (
                  <div
                    key={code.code}
                    id={`${listId}-option-${idx}`}
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-left text-sm cursor-pointer hover-elevate ${
                      idx === activeIndex ? "bg-accent" : ""
                    }`}
                    onClick={() => handleSelect(code)}
                    data-testid={testId ? `${testId}-option-${code.code}` : undefined}
                  >
                    <Badge variant="outline" className="shrink-0 text-xs font-mono">{code.code}</Badge>
                    <span className="truncate">{code.description}</span>
                    {code.isCustom && <Badge variant="secondary" className="shrink-0 text-[10px] ml-auto">Custom</Badge>}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}

      {open && search && filtered.length === 0 && !isLoading && (
        <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-md p-3">
          <p className="text-sm text-muted-foreground text-center">
            No matching codes. Your custom value will be used.
          </p>
        </div>
      )}
    </div>
  );
}
