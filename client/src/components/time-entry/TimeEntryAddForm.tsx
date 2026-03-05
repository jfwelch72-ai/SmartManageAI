import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import { cn } from "@/lib/utils";
import { Calendar } from "lucide-react";
import { format } from "date-fns";

interface TimeEntryAddFormProps {
  projects: any[];
  newProjectId: string;
  setNewProjectId: (v: string) => void;
  newDate: Date | undefined;
  setNewDate: (d: Date | undefined) => void;
  newRegular: string;
  setNewRegular: (v: string) => void;
  newOvertime: string;
  setNewOvertime: (v: string) => void;
  newCostCode: string;
  setNewCostCode: (v: string) => void;
  newNotes: string;
  setNewNotes: (v: string) => void;
  handleCreateEntry: (e: React.FormEvent) => void;
  createEntryPending: boolean;
}

export function TimeEntryAddForm({
  projects,
  newProjectId,
  setNewProjectId,
  newDate,
  setNewDate,
  newRegular,
  setNewRegular,
  newOvertime,
  setNewOvertime,
  newCostCode,
  setNewCostCode,
  newNotes,
  setNewNotes,
  handleCreateEntry,
  createEntryPending,
}: TimeEntryAddFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Time Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleCreateEntry} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-project">Project</Label>
              <Select value={newProjectId} onValueChange={setNewProjectId}>
                <SelectTrigger id="new-project" data-testid="select-new-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} - {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !newDate && "text-muted-foreground"
                    )}
                    data-testid="button-new-date"
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {newDate ? format(newDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={newDate}
                    onSelect={(d) => setNewDate(d || undefined)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-regular">Regular Hours</Label>
              <Input
                id="new-regular"
                type="number"
                step="0.25"
                min="0"
                max="24"
                placeholder="8.0"
                value={newRegular}
                onChange={(e) => setNewRegular(e.target.value)}
                data-testid="input-new-regular-hours"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-overtime">Overtime Hours</Label>
              <Input
                id="new-overtime"
                type="number"
                step="0.25"
                min="0"
                max="24"
                placeholder="0.0"
                value={newOvertime}
                onChange={(e) => setNewOvertime(e.target.value)}
                data-testid="input-new-overtime-hours"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="new-cost-code">Cost Code</Label>
              <CostCodeCombobox
                id="new-cost-code"
                value={newCostCode}
                onChange={setNewCostCode}
                data-testid="input-new-cost-code"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="new-notes">Notes (Optional)</Label>
              <Textarea
                id="new-notes"
                placeholder="Add any additional notes..."
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                data-testid="textarea-new-notes"
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={createEntryPending || !newProjectId}
            data-testid="button-submit-new-entry"
          >
            {createEntryPending ? "Submitting..." : "Submit Time Entry"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
