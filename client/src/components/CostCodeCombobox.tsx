import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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

  const filtered = useMemo(() => {
    if (!search) return costCodes;
    const s = search.toLowerCase();
    return costCodes.filter(
      (c) => c.code.toLowerCase().includes(s) || c.description.toLowerCase().includes(s)
    );
  }, [costCodes, search]);

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
        setActiveIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < filtered.length) {
          handleSelect(filtered[activeIndex]);
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
          className="absolute z-50 w-full mt-1 max-h-[240px] overflow-y-auto rounded-md border bg-popover shadow-md"
        >
          {filtered.map((code, index) => (
            <div
              key={code.code}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex items-center gap-2 w-full px-3 py-2 text-left text-sm cursor-pointer hover-elevate ${
                index === activeIndex ? "bg-accent" : ""
              }`}
              onClick={() => handleSelect(code)}
              data-testid={testId ? `${testId}-option-${code.code}` : undefined}
            >
              <Badge variant="outline" className="shrink-0 text-xs font-mono">{code.code}</Badge>
              <span className="truncate">{code.description}</span>
            </div>
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
