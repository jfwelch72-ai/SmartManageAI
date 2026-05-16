import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { useCalendarEvents, useCreateCalendarEvent } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { Plus, Calendar as CalendarIcon, DollarSign, Package, Truck, FileText, UserPlus, Filter } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isWithinInterval, startOfDay, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isVendor } from "@/lib/rbac";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";

const EVENT_TYPE_LABELS: Record<string, string> = {
  MEETING: "Meeting",
  PROJECT_DEADLINE: "Project Deadline",
  PROJECT_MILESTONE: "Milestone",
  NETWORKING_EVENT: "Networking Event",
  PROJECT_START: "Project Start",
  PROJECT_PHASE: "Project Phase",
};

const VENDOR_EVENT_TYPE_LABELS: Record<string, string> = {
  VENDOR_PRICING_EXPIRATION: "Pricing Expiration",
  VENDOR_PO_DEADLINE: "PO Deadline",
  VENDOR_RENTAL_PERIOD: "Rental Period",
  VENDOR_BID_DUE_DATE: "Bid Due Date",
  VENDOR_ENROLLMENT_CHANGE: "Enrollment",
};

const VENDOR_EVENT_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  VENDOR_PRICING_EXPIRATION: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800", dot: "bg-amber-500" },
  VENDOR_PO_DEADLINE: { bg: "bg-blue-50 dark:bg-blue-950/30", text: "text-blue-700 dark:text-blue-400", border: "border-blue-200 dark:border-blue-800", dot: "bg-blue-500" },
  VENDOR_RENTAL_PERIOD: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800", dot: "bg-emerald-500" },
  VENDOR_BID_DUE_DATE: { bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-800", dot: "bg-red-500" },
  VENDOR_ENROLLMENT_CHANGE: { bg: "bg-purple-50 dark:bg-purple-950/30", text: "text-purple-700 dark:text-purple-400", border: "border-purple-200 dark:border-purple-800", dot: "bg-purple-500" },
};

const VENDOR_EVENT_ICONS: Record<string, typeof DollarSign> = {
  VENDOR_PRICING_EXPIRATION: DollarSign,
  VENDOR_PO_DEADLINE: Package,
  VENDOR_RENTAL_PERIOD: Truck,
  VENDOR_BID_DUE_DATE: FileText,
  VENDOR_ENROLLMENT_CHANGE: UserPlus,
};

function cleanLeaveDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/^leave_request:[0-9a-f-]+(?: - (.*))?$/i);
  if (!match) return description;
  const reason = match[1]?.trim();
  return reason || null;
}

function isVendorEventType(eventType: string): boolean {
  return eventType.startsWith("VENDOR_");
}

function getEventBadgeVariant(eventType: string): "default" | "secondary" | "outline" {
  switch (eventType) {
    case "TIME_OFF_APPROVED":
      return "default";
    case "PROJECT_MILESTONE":
    case "PROJECT_DEADLINE":
      return "outline";
    default:
      return "secondary";
  }
}

function getEventLabel(eventType: string): string {
  if (eventType === "TIME_OFF_APPROVED") return "Approved Leave";
  if (VENDOR_EVENT_TYPE_LABELS[eventType]) return VENDOR_EVENT_TYPE_LABELS[eventType];
  return EVENT_TYPE_LABELS[eventType] || eventType.replace(/_/g, " ");
}

export default function CalendarPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showRequestDialog, setShowRequestDialog] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [allDay, setAllDay] = useState(false);
  const [eventType, setEventType] = useState<string>("MEETING");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [showEventDetail, setShowEventDetail] = useState(false);
  const [selectedDayEvents, setSelectedDayEvents] = useState<any[]>([]);
  const [showDayEventsDialog, setShowDayEventsDialog] = useState(false);
  const [vendorEventFilter, setVendorEventFilter] = useState<string>("ALL");

  const userIsVendor = isVendor(user?.role);
  const { data: events = [], isLoading } = useCalendarEvents();
  const createEvent = useCreateCalendarEvent();

  const filteredEvents = useMemo(() => {
    if (!userIsVendor || vendorEventFilter === "ALL") return events;
    return events.filter((e: any) => e.eventType === vendorEventFilter);
  }, [events, vendorEventFilter, userIsVendor]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const handleCreateEvent = async () => {
    if (!title || !startDate) {
      toast({ title: "Error", description: "Title and start date are required", variant: "destructive" });
      return;
    }

    try {
      const startDateTime = allDay ? new Date(startDate) : new Date(`${startDate}T${startTime}`);
      const endDateTime = endDate ? (allDay ? new Date(endDate) : new Date(`${endDate}T${endTime}`)) : null;

      await createEvent.mutateAsync({
        title,
        description,
        startDate: startDateTime,
        ...(endDateTime && { endDate: endDateTime }),
        allDay,
        eventType: eventType as any,
      });
      toast({ title: "Success", description: "Event created successfully" });
      setShowRequestDialog(false);
      setTitle("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      setStartTime("09:00");
      setEndTime("17:00");
      setAllDay(false);
      setEventType("MEETING");
    } catch (error) {
      toast({ title: "Error", description: "Failed to create event", variant: "destructive" });
    }
  };

  const getEventsForDay = (date: Date) => {
    return filteredEvents.filter((event: any) => {
      const eventStart = new Date(event.startDate);
      const eventEnd = event.endDate ? new Date(event.endDate) : eventStart;
      return isWithinInterval(date, { start: eventStart, end: eventEnd }) || isSameDay(date, eventStart);
    });
  };

  const renderEventBadge = (event: any, compact = false) => {
    if (isVendorEventType(event.eventType)) {
      const colors = VENDOR_EVENT_COLORS[event.eventType];
      const Icon = VENDOR_EVENT_ICONS[event.eventType];
      return (
        <div
          key={event.id}
          className={cn(
            "text-xs block truncate cursor-pointer rounded-md px-1.5 py-0.5 border",
            colors?.bg, colors?.text, colors?.border,
            "hover:opacity-80 transition-opacity"
          )}
          onClick={() => {
            setSelectedEvent(event);
            setShowEventDetail(true);
          }}
          data-testid={`event-badge-${event.id}`}
        >
          {!compact && Icon && <Icon className="w-3 h-3 inline mr-1" />}
          {event.title}
        </div>
      );
    }

    return (
      <Badge
        key={event.id}
        variant={getEventBadgeVariant(event.eventType)}
        className="text-xs block truncate cursor-pointer hover-elevate active-elevate-2"
        onClick={() => {
          setSelectedEvent(event);
          setShowEventDetail(true);
        }}
        data-testid={`event-badge-${event.id}`}
      >
        {event.title}
      </Badge>
    );
  };

  const renderVendorEventDetail = (event: any) => {
    const colors = VENDOR_EVENT_COLORS[event.eventType];
    const Icon = VENDOR_EVENT_ICONS[event.eventType];
    const meta = event.vendorEventMeta || {};

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon className={cn("w-5 h-5", colors?.text)} />}
          <span className={cn("text-sm font-medium px-2 py-1 rounded-md border", colors?.bg, colors?.text, colors?.border)}>
            {getEventLabel(event.eventType)}
          </span>
        </div>

        {event.description && (
          <div>
            <Label className="text-sm font-medium">Details</Label>
            <p className="mt-1 text-sm text-muted-foreground">{event.description}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium">
              {event.eventType === "VENDOR_RENTAL_PERIOD" ? "Start" : "Date"}
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              {format(new Date(event.startDate), "MMM d, yyyy")}
            </p>
          </div>
          {event.endDate && event.eventType === "VENDOR_RENTAL_PERIOD" && (
            <div>
              <Label className="text-sm font-medium">Expected End</Label>
              <p className="mt-1 text-sm text-muted-foreground">
                {format(new Date(event.endDate), "MMM d, yyyy")}
              </p>
            </div>
          )}
        </div>

        {meta.contractor && (
          <div>
            <Label className="text-sm font-medium">Contractor</Label>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="text-vendor-event-contractor">{meta.contractor}</p>
          </div>
        )}

        {meta.gcOrg && (
          <div>
            <Label className="text-sm font-medium">General Contractor</Label>
            <p className="mt-1 text-sm text-muted-foreground" data-testid="text-vendor-event-gc">{meta.gcOrg}</p>
          </div>
        )}

        {meta.category && (
          <div>
            <Label className="text-sm font-medium">Category</Label>
            <p className="mt-1 text-sm text-muted-foreground">{meta.category}</p>
          </div>
        )}

        {meta.poNumber && (
          <div>
            <Label className="text-sm font-medium">PO Number</Label>
            <p className="mt-1 text-sm text-muted-foreground">{meta.poNumber}</p>
          </div>
        )}

        {meta.status && (
          <div>
            <Label className="text-sm font-medium">Status</Label>
            <p className="mt-1 text-sm text-muted-foreground">{meta.status}</p>
          </div>
        )}

        {meta.enrollmentStatus && (
          <div>
            <Label className="text-sm font-medium">Enrollment Status</Label>
            <Badge variant={meta.enrollmentStatus === "ACTIVE" ? "default" : "secondary"}>
              {meta.enrollmentStatus}
            </Badge>
          </div>
        )}

        {meta.bidStatus && (
          <div>
            <Label className="text-sm font-medium">Bid Status</Label>
            <Badge variant="outline">{meta.bidStatus}</Badge>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-calendar-title">
              Calendar
            </h1>
            <p className="text-sm text-muted-foreground">
              {userIsVendor
                ? "Track pricing expirations, PO deadlines, rentals, bids, and enrollments"
                : "Manage meetings, milestones, deadlines, and events"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <ContextualHelpButton />
            {userIsVendor && (
              <Select value={vendorEventFilter} onValueChange={setVendorEventFilter}>
                <SelectTrigger className="w-[200px]" data-testid="select-vendor-event-filter">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter events" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Events</SelectItem>
                  {Object.entries(VENDOR_EVENT_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Dialog open={showRequestDialog} onOpenChange={setShowRequestDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-event">
                  <Plus className="w-4 h-4 mr-2" />
                  New Event
                </Button>
              </DialogTrigger>
                <DialogContent data-testid="dialog-create-event">
                  <DialogHeader>
                    <DialogTitle>Create Event</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="event-type">Event Type</Label>
                      <Select value={eventType} onValueChange={setEventType}>
                        <SelectTrigger data-testid="select-event-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
                            <SelectItem key={key} value={key}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="event-title">Title</Label>
                      <Input
                        id="event-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Team standup, project review..."
                        data-testid="input-event-title"
                      />
                    </div>
                    <div>
                      <Label htmlFor="event-description">Description (optional)</Label>
                      <Textarea
                        id="event-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Additional details..."
                        data-testid="input-event-description"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="all-day"
                        checked={allDay}
                        onCheckedChange={(checked) => setAllDay(checked as boolean)}
                        data-testid="checkbox-all-day"
                      />
                      <Label htmlFor="all-day" className="cursor-pointer">All Day Event</Label>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="start-date">Start Date *</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !startDate && "text-muted-foreground"
                              )}
                              data-testid="input-start-date"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {startDate ? format(parseISO(startDate), "PPP") : "Pick a date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <CalendarPicker
                              mode="single"
                              selected={startDate ? parseISO(startDate) : undefined}
                              onSelect={(date) => setStartDate(date ? format(date, "yyyy-MM-dd") : "")}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end-date">End Date (optional)</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !endDate && "text-muted-foreground"
                              )}
                              data-testid="input-end-date"
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {endDate ? format(parseISO(endDate), "PPP") : "Pick a date"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <CalendarPicker
                              mode="single"
                              selected={endDate ? parseISO(endDate) : undefined}
                              onSelect={(date) => setEndDate(date ? format(date, "yyyy-MM-dd") : "")}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                    {!allDay && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="start-time">Start Time</Label>
                          <Input
                            id="start-time"
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            data-testid="input-start-time"
                          />
                        </div>
                        <div>
                          <Label htmlFor="end-time">End Time</Label>
                          <Input
                            id="end-time"
                            type="time"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            data-testid="input-end-time"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowRequestDialog(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateEvent}
                      disabled={createEvent.isPending}
                      data-testid="button-submit-event"
                    >
                      {createEvent.isPending ? "Creating..." : "Create Event"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
          </div>
        </div>

        {userIsVendor && (
          <div className="mb-6 flex flex-wrap gap-3" data-testid="vendor-event-legend">
            {Object.entries(VENDOR_EVENT_TYPE_LABELS).map(([key, label]) => {
              const colors = VENDOR_EVENT_COLORS[key];
              const Icon = VENDOR_EVENT_ICONS[key];
              const count = events.filter((e: any) => e.eventType === key).length;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-opacity",
                    colors?.bg, colors?.text, colors?.border,
                    vendorEventFilter !== "ALL" && vendorEventFilter !== key && "opacity-40"
                  )}
                  onClick={() => setVendorEventFilter(vendorEventFilter === key ? "ALL" : key)}
                  data-testid={`legend-${key}`}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  <span>{label}</span>
                  <span className="font-semibold">({count})</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{format(currentDate, "MMMM yyyy")}</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentDate(new Date())}
                    >
                      Today
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="text-center text-sm font-medium text-muted-foreground p-2">
                      {day}
                    </div>
                  ))}
                  {daysInMonth.map(day => {
                    const dayEvents = getEventsForDay(day);
                    const isToday = isSameDay(day, new Date());
                    
                    return (
                      <div
                        key={day.toString()}
                        className={`min-h-24 p-2 border rounded-md ${
                          isSameMonth(day, currentDate) ? "bg-background" : "bg-muted"
                        } ${isToday ? "border-primary border-2" : ""}`}
                        data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
                      >
                        <div className="text-sm font-medium mb-1">{format(day, "d")}</div>
                        <div className="space-y-1">
                          {dayEvents.slice(0, 2).map(event => renderEventBadge(event, true))}
                          {dayEvents.length > 2 && (
                            <span 
                              className="text-xs text-muted-foreground cursor-pointer hover:underline hover:text-foreground"
                              onClick={() => {
                                setSelectedDayEvents(dayEvents);
                                setShowDayEventsDialog(true);
                              }}
                              data-testid={`button-show-more-${format(day, "yyyy-MM-dd")}`}
                            >
                              +{dayEvents.length - 2} more
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle>{userIsVendor ? "Upcoming Deadlines" : "Upcoming Events"}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : filteredEvents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {userIsVendor ? "No vendor events found" : "No events"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredEvents
                      .filter((e: any) => startOfDay(new Date(e.startDate)) >= startOfDay(new Date()))
                      .slice(0, 10)
                      .map((event: any) => {
                        const isVendorEvt = isVendorEventType(event.eventType);
                        const colors = isVendorEvt ? VENDOR_EVENT_COLORS[event.eventType] : null;
                        const Icon = isVendorEvt ? VENDOR_EVENT_ICONS[event.eventType] : null;
                        const cleanedDesc = cleanLeaveDescription(event.description);

                        return (
                          <Card 
                            key={event.id} 
                            className={cn(
                              "p-3 cursor-pointer hover-elevate active-elevate-2",
                              isVendorEvt && colors && `${colors.border} border`
                            )}
                            onClick={() => {
                              setSelectedEvent(event);
                              setShowEventDetail(true);
                            }}
                            data-testid={`event-${event.id}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  {Icon ? (
                                    <Icon className={cn("w-4 h-4", colors?.text)} />
                                  ) : (
                                    <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                                  )}
                                  <span className="font-medium text-sm">{event.title}</span>
                                </div>
                                {isVendorEvt ? (
                                  <span className={cn(
                                    "inline-block text-xs px-2 py-0.5 rounded-md border",
                                    colors?.bg, colors?.text, colors?.border
                                  )}>
                                    {getEventLabel(event.eventType)}
                                  </span>
                                ) : (
                                  <Badge
                                    variant={getEventBadgeVariant(event.eventType)}
                                    className="text-xs"
                                  >
                                    {getEventLabel(event.eventType)}
                                  </Badge>
                                )}
                                <p className="text-xs text-muted-foreground mt-2">
                                  {format(new Date(event.startDate), "MMM d")}
                                  {event.endDate && event.startDate !== event.endDate
                                    ? ` - ${format(new Date(event.endDate), "MMM d, yyyy")}`
                                    : `, ${format(new Date(event.startDate), "yyyy")}`}
                                </p>
                                {cleanedDesc && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{cleanedDesc}</p>}
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Dialog open={showEventDetail} onOpenChange={setShowEventDetail}>
          <DialogContent data-testid="dialog-event-detail">
            <DialogHeader>
              <DialogTitle>{selectedEvent?.title}</DialogTitle>
            </DialogHeader>
            {selectedEvent && (
              isVendorEventType(selectedEvent.eventType)
                ? renderVendorEventDetail(selectedEvent)
                : (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">Event Type</Label>
                      <div className="mt-1">
                        <Badge variant={getEventBadgeVariant(selectedEvent.eventType)}>
                          {getEventLabel(selectedEvent.eventType)}
                        </Badge>
                      </div>
                    </div>

                    {selectedEvent.eventType === "TIME_OFF_APPROVED" && selectedEvent.requesteeName && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-sm font-medium">Employee</Label>
                          <p className="mt-1 text-sm text-muted-foreground" data-testid="text-requestee-name">
                            {selectedEvent.requesteeName}
                          </p>
                        </div>
                        {selectedEvent.requesteeRole && (
                          <div>
                            <Label className="text-sm font-medium">Role</Label>
                            <p className="mt-1 text-sm text-muted-foreground" data-testid="text-requestee-role">
                              {selectedEvent.requesteeRole.replace(/_/g, " ")}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {(() => {
                      const desc = cleanLeaveDescription(selectedEvent.description);
                      return desc ? (
                        <div>
                          <Label className="text-sm font-medium">Description</Label>
                          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                        </div>
                      ) : null;
                    })()}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Start</Label>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {format(new Date(selectedEvent.startDate), "MMM d, yyyy")}
                          {!selectedEvent.allDay && (
                            <span className="ml-2 font-medium">
                              {format(new Date(selectedEvent.startDate), "h:mm a")}
                            </span>
                          )}
                        </p>
                      </div>
                      {selectedEvent.endDate && (
                        <div>
                          <Label className="text-sm font-medium">End</Label>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {format(new Date(selectedEvent.endDate), "MMM d, yyyy")}
                            {!selectedEvent.allDay && (
                              <span className="ml-2 font-medium">
                                {format(new Date(selectedEvent.endDate), "h:mm a")}
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                    </div>

                    {selectedEvent.allDay && (
                      <div>
                        <Badge variant="outline">All Day Event</Badge>
                      </div>
                    )}
                  </div>
                )
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEventDetail(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showDayEventsDialog} onOpenChange={setShowDayEventsDialog}>
          <DialogContent data-testid="dialog-day-events">
            <DialogHeader>
              <DialogTitle>
                {selectedDayEvents.length > 0 && format(new Date(selectedDayEvents[0].startDate), "MMMM d, yyyy")} - All Events
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {selectedDayEvents.map((event: any) => {
                const isVendorEvt = isVendorEventType(event.eventType);
                const colors = isVendorEvt ? VENDOR_EVENT_COLORS[event.eventType] : null;
                const Icon = isVendorEvt ? VENDOR_EVENT_ICONS[event.eventType] : null;

                return (
                  <Card 
                    key={event.id} 
                    className={cn(
                      "p-3 cursor-pointer hover-elevate active-elevate-2",
                      isVendorEvt && colors && `${colors.border} border`
                    )}
                    onClick={() => {
                      setSelectedEvent(event);
                      setShowDayEventsDialog(false);
                      setShowEventDetail(true);
                    }}
                    data-testid={`day-event-${event.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {Icon ? (
                            <Icon className={cn("w-4 h-4", colors?.text)} />
                          ) : (
                            <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span className="font-medium text-sm">{event.title}</span>
                        </div>
                        {isVendorEvt ? (
                          <span className={cn(
                            "inline-block text-xs px-2 py-0.5 rounded-md border",
                            colors?.bg, colors?.text, colors?.border
                          )}>
                            {getEventLabel(event.eventType)}
                          </span>
                        ) : (
                          <Badge
                            variant={getEventBadgeVariant(event.eventType)}
                            className="text-xs"
                          >
                            {getEventLabel(event.eventType)}
                          </Badge>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          {format(new Date(event.startDate), "MMM d, yyyy")}
                          {!event.allDay && event.startDate && ` at ${format(new Date(event.startDate), "h:mm a")}`}
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDayEventsDialog(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
