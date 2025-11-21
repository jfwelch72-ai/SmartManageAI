import { useState } from "react";
import AppHeader from "@/components/AppHeader";
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
import { useLocation } from "wouter";
import { useCalendarEvents, useCreateCalendarEvent, useApproveTimeOff } from "@/hooks/use-data";
import { useToast } from "@/hooks/use-toast";
import { Plus, Calendar as CalendarIcon, CheckCircle } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isWithinInterval, startOfDay } from "date-fns";

export default function CalendarPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
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
  const [eventType, setEventType] = useState<string>("TIME_OFF_REQUEST");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [showEventDetail, setShowEventDetail] = useState(false);

  const { data: events = [], isLoading } = useCalendarEvents();
  const createEvent = useCreateCalendarEvent();
  const approveTimeOff = useApproveTimeOff();

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
    } catch (error) {
      toast({ title: "Error", description: "Failed to create event", variant: "destructive" });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveTimeOff.mutateAsync(id);
      toast({ title: "Success", description: "Time-off request approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve request", variant: "destructive" });
    }
  };

  const canApprove = ["ADMIN", "MANAGER"].includes(user?.role || "");

  const getEventsForDay = (date: Date) => {
    return events.filter(event => {
      const eventStart = new Date(event.startDate);
      const eventEnd = event.endDate ? new Date(event.endDate) : eventStart;
      return isWithinInterval(date, { start: eventStart, end: eventEnd }) || isSameDay(date, eventStart);
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Calendar & Time-Off</h1>
            <p className="text-sm text-muted-foreground">
              Manage time-off requests, networking events, and project milestones
            </p>
          </div>

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
                      <SelectItem value="TIME_OFF_REQUEST">Time Off Request</SelectItem>
                      <SelectItem value="NETWORKING_EVENT">Networking Event</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="event-title">Title</Label>
                  <Input
                    id="event-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Holiday vacation"
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
                  <div>
                    <Label htmlFor="start-date">Start Date *</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      data-testid="input-start-date"
                    />
                  </div>
                  <div>
                    <Label htmlFor="end-date">End Date (optional)</Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      data-testid="input-end-date"
                    />
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
                          {dayEvents.slice(0, 2).map(event => (
                            <Badge
                              key={event.id}
                              variant={
                                event.eventType === "TIME_OFF_APPROVED" ? "default" :
                                event.eventType === "TIME_OFF_REQUEST" ? "destructive" :
                                "secondary"
                              }
                              className="text-xs block truncate cursor-pointer hover-elevate active-elevate-2"
                              onClick={() => {
                                setSelectedEvent(event);
                                setShowEventDetail(true);
                              }}
                              data-testid={`event-badge-${event.id}`}
                            >
                              {event.title}
                            </Badge>
                          ))}
                          {dayEvents.length > 2 && (
                            <span className="text-xs text-muted-foreground">+{dayEvents.length - 2} more</span>
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
                <CardTitle>Upcoming Events</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : events.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No events</div>
                ) : (
                  <div className="space-y-3">
                    {events
                      .filter(e => startOfDay(new Date(e.startDate)) >= startOfDay(new Date()))
                      .slice(0, 10)
                      .map(event => (
                        <Card 
                          key={event.id} 
                          className="p-3 cursor-pointer hover-elevate active-elevate-2" 
                          onClick={() => {
                            setSelectedEvent(event);
                            setShowEventDetail(true);
                          }}
                          data-testid={`event-${event.id}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                                <span className="font-medium text-sm">{event.title}</span>
                              </div>
                              <Badge
                                variant={
                                  event.eventType === "TIME_OFF_APPROVED" ? "default" :
                                  event.eventType === "TIME_OFF_REQUEST" ? "destructive" :
                                  "secondary"
                                }
                                className="text-xs"
                              >
                                {event.eventType.replace(/_/g, " ")}
                              </Badge>
                              <p className="text-xs text-muted-foreground mt-2">
                                {format(new Date(event.startDate), "MMM d")} - {event.endDate ? format(new Date(event.endDate), "MMM d, yyyy") : ""}
                              </p>
                              {event.description && (
                                <p className="text-xs text-muted-foreground mt-1">{event.description}</p>
                              )}
                            </div>
                            {canApprove && event.eventType === "TIME_OFF_REQUEST" && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleApprove(event.id)}
                                disabled={approveTimeOff.isPending}
                                data-testid={`button-approve-${event.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                            )}
                          </div>
                        </Card>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Event Detail Dialog */}
        <Dialog open={showEventDetail} onOpenChange={setShowEventDetail}>
          <DialogContent data-testid="dialog-event-detail">
            <DialogHeader>
              <DialogTitle>{selectedEvent?.title}</DialogTitle>
            </DialogHeader>
            {selectedEvent && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Event Type</Label>
                  <div className="mt-1">
                    <Badge
                      variant={
                        selectedEvent.eventType === "TIME_OFF_APPROVED" ? "default" :
                        selectedEvent.eventType === "TIME_OFF_REQUEST" ? "destructive" :
                        "secondary"
                      }
                    >
                      {selectedEvent.eventType.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                
                {selectedEvent.description && (
                  <div>
                    <Label className="text-sm font-medium">Description</Label>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedEvent.description}</p>
                  </div>
                )}

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
            )}
            <DialogFooter>
              {canApprove && selectedEvent?.eventType === "TIME_OFF_REQUEST" && (
                <Button
                  variant="default"
                  onClick={() => {
                    handleApprove(selectedEvent.id);
                    setShowEventDetail(false);
                  }}
                  disabled={approveTimeOff.isPending}
                  data-testid="button-approve-event-detail"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve Request
                </Button>
              )}
              <Button variant="outline" onClick={() => setShowEventDetail(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
