import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { CalendarEvent } from "@shared/schema";
import { format, isToday, isTomorrow, isThisWeek } from "date-fns";

function formatEventDate(dateStr: string | Date): string {
  const date = new Date(dateStr);
  if (isToday(date)) return `Today at ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow at ${format(date, "h:mm a")}`;
  if (isThisWeek(date)) return format(date, "EEEE 'at' h:mm a");
  return format(date, "MMM d 'at' h:mm a");
}

export function CalendarWidget() {
  const [, setLocation] = useLocation();
  const { data: calendarEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/my-events"],
  });

  const upcomingEvents = calendarEvents
    .filter((e) => new Date(e.startDate) >= new Date())
    .sort(
      (a, b) =>
        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    )
    .slice(0, 5);

  return (
    <Card className="h-full" data-testid="card-calendar">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Upcoming Events
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/calendar")}
            data-testid="button-view-calendar"
          >
            View Calendar
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {upcomingEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No upcoming events
          </p>
        ) : (
          <div className="space-y-3">
            {upcomingEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                onClick={() => setLocation("/calendar")}
                data-testid={`event-item-${event.id}`}
              >
                <div className="w-10 h-10 rounded-md bg-primary/10 flex flex-col items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary">
                    {format(new Date(event.startDate), "d")}
                  </span>
                  <span className="text-[10px] text-primary uppercase">
                    {format(new Date(event.startDate), "MMM")}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatEventDate(event.startDate)}
                  </p>
                  <Badge variant="outline" className="mt-1 text-xs">
                    {event.eventType.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
