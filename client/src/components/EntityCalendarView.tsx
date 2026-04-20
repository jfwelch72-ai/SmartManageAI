import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  format,
  isSameMonth,
  isSameDay,
} from "date-fns";

export interface CalendarEntityItem<T> {
  id: string;
  label: string;
  date: Date;
  colorClass: string;
  data: T;
}

interface Props<T> {
  items: CalendarEntityItem<T>[];
  onItemClick: (item: T) => void;
  legend?: Array<{ label: string; colorClass: string }>;
  testIdPrefix?: string;
}

export default function EntityCalendarView<T>({ items, onItemClick, legend, testIdPrefix = "calendar" }: Props<T>) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const weeks: Date[][] = useMemo(() => {
    const result: Date[][] = [];
    let cursor = gridStart;
    while (cursor <= gridEnd) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(cursor);
        cursor = addDays(cursor, 1);
      }
      result.push(week);
    }
    return result;
  }, [gridStart.getTime(), gridEnd.getTime()]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarEntityItem<T>[]>();
    for (const it of items) {
      if (isNaN(it.date.getTime())) continue;
      const key = format(it.date, "yyyy-MM-dd");
      const arr = map.get(key) || [];
      arr.push(it);
      map.set(key, arr);
    }
    return map;
  }, [items]);

  const today = new Date();

  return (
    <div className="space-y-3" data-testid={`view-${testIdPrefix}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" data-testid={`${testIdPrefix}-month-label`}>{format(currentMonth, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} data-testid={`${testIdPrefix}-prev`}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(startOfMonth(new Date()))} data-testid={`${testIdPrefix}-today`}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} data-testid={`${testIdPrefix}-next`}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/40 text-xs font-medium text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-1.5 text-center border-r last:border-r-0">{d}</div>
          ))}
        </div>
        <div className="divide-y">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 min-h-24">
              {week.map((day, di) => {
                const inMonth = isSameMonth(day, currentMonth);
                const isToday = isSameDay(day, today);
                const dayItems = itemsByDay.get(format(day, "yyyy-MM-dd")) || [];
                return (
                  <div
                    key={di}
                    className={`border-r last:border-r-0 px-1.5 pt-1 pb-1 ${inMonth ? "bg-background" : "bg-muted/20"}`}
                  >
                    <div className={`text-xs ${isToday ? "inline-flex w-5 h-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold" : inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                      {format(day, "d")}
                    </div>
                    <div className="mt-1 space-y-1">
                      {dayItems.slice(0, 4).map((it) => (
                        <button
                          key={it.id}
                          onClick={() => onItemClick(it.data)}
                          className={`block w-full text-left text-[11px] text-white px-1.5 py-0.5 rounded truncate ${it.colorClass}`}
                          title={it.label}
                          data-testid={`${testIdPrefix}-item-${it.id}`}
                        >
                          {it.label}
                        </button>
                      ))}
                      {dayItems.length > 4 && (
                        <div className="text-[10px] text-muted-foreground px-1">+{dayItems.length - 4} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {legend && legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {legend.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={`inline-block w-3 h-3 rounded ${l.colorClass}`} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
