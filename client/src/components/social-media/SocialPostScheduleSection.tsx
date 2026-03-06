import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Clock } from "lucide-react";

interface ScheduleSectionProps {
  scheduleMode: "now" | "schedule";
  scheduledAt: string;
  isRecurring: boolean;
  recurringFrequency: string;
  recurringInterval: number;
  notes: string;
  onScheduleModeChange: (mode: "now" | "schedule") => void;
  onScheduledAtChange: (val: string) => void;
  onIsRecurringChange: (val: boolean) => void;
  onRecurringFrequencyChange: (val: string) => void;
  onRecurringIntervalChange: (val: number) => void;
  onNotesChange: (val: string) => void;
}

export function SocialPostScheduleSection({
  scheduleMode, scheduledAt, isRecurring, recurringFrequency, recurringInterval, notes,
  onScheduleModeChange, onScheduledAtChange, onIsRecurringChange,
  onRecurringFrequencyChange, onRecurringIntervalChange, onNotesChange,
}: ScheduleSectionProps) {
  return (
    <>
      <Separator />

      <div className="space-y-3">
        <Label className="font-medium">Scheduling</Label>
        <div className="flex gap-2">
          <Button
            variant={scheduleMode === "now" ? "default" : "outline"}
            size="sm"
            onClick={() => onScheduleModeChange("now")}
            data-testid="btn-schedule-now"
          >
            Save as Draft
          </Button>
          <Button
            variant={scheduleMode === "schedule" ? "default" : "outline"}
            size="sm"
            onClick={() => onScheduleModeChange("schedule")}
            data-testid="btn-schedule-later"
          >
            <Clock className="h-4 w-4 mr-1" />
            Schedule
          </Button>
        </div>
        {scheduleMode === "schedule" && (
          <div className="space-y-3">
            <div>
              <Label>Schedule Date & Time</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => onScheduledAtChange(e.target.value)}
                data-testid="input-schedule-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="recurring"
                checked={isRecurring}
                onChange={e => onIsRecurringChange(e.target.checked)}
                className="rounded"
                data-testid="checkbox-recurring"
              />
              <Label htmlFor="recurring" className="text-sm cursor-pointer">Recurring post</Label>
            </div>
            {isRecurring && (
              <div className="flex gap-2">
                <Select value={recurringFrequency} onValueChange={onRecurringFrequencyChange}>
                  <SelectTrigger className="w-32" data-testid="select-recurring-freq">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground self-center">every</span>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={recurringInterval}
                  onChange={e => onRecurringIntervalChange(parseInt(e.target.value) || 1)}
                  className="w-16"
                  data-testid="input-recurring-interval"
                />
                <span className="text-sm text-muted-foreground self-center">
                  {recurringFrequency === "daily" ? "day(s)" : recurringFrequency === "weekly" ? "week(s)" : "month(s)"}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <Label>Internal Notes</Label>
        <Textarea
          placeholder="Any internal notes about this post..."
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          className="min-h-[60px]"
          data-testid="input-post-notes"
        />
      </div>
    </>
  );
}
