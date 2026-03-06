import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday } from "date-fns";
import { type SocialPost, getPlatformInfo } from "./types";

export function SocialCalendarView({ posts, currentDate, onDateChange, onEdit, onCreateForDate }: {
  posts: Record<string, SocialPost[]>;
  currentDate: Date;
  onDateChange: (d: Date) => void;
  onEdit: (post: SocialPost) => void;
  onCreateForDate: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => onDateChange(subMonths(currentDate, 1))} data-testid="cal-prev-month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-lg font-semibold" data-testid="cal-current-month">
          {format(currentDate, "MMMM yyyy")}
        </h3>
        <Button variant="outline" size="sm" onClick={() => onDateChange(addMonths(currentDate, 1))} data-testid="cal-next-month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} className="bg-muted py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
        ))}
        {days.map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const dayPosts = posts[key] || [];
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isToday(day);

          return (
            <div
              key={i}
              className={`bg-background min-h-[100px] p-1.5 cursor-pointer hover:bg-muted/50 transition-colors ${!isCurrentMonth ? "opacity-40" : ""} ${isCurrentDay ? "ring-2 ring-primary ring-inset" : ""}`}
              onClick={() => onCreateForDate(day)}
              data-testid={`cal-day-${key}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium ${isCurrentDay ? "text-primary" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </span>
                {dayPosts.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">{dayPosts.length}</Badge>
                )}
              </div>
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map(post => {
                  const pInfo = getPlatformInfo(post.platform || "FACEBOOK");
                  const PIcon = pInfo.icon;
                  return (
                    <div
                      key={post.id}
                      className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] truncate cursor-pointer hover:bg-muted"
                      style={{ backgroundColor: pInfo.color + "15", color: pInfo.color }}
                      onClick={(e) => { e.stopPropagation(); onEdit(post); }}
                      data-testid={`cal-post-${post.id}`}
                    >
                      <PIcon className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{post.title || post.content.substring(0, 20)}</span>
                    </div>
                  );
                })}
                {dayPosts.length > 3 && (
                  <div className="text-[10px] text-muted-foreground text-center">+{dayPosts.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
