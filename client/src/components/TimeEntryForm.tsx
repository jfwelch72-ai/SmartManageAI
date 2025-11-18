import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TimeEntryFormProps {
  projects: Array<{ id: string; code: string; name: string }>;
  onSubmit: (entry: {
    projectId: string;
    date: string;
    regularHours: number;
    overtimeHours: number;
    costCode: string;
    notes: string;
  }) => void;
}

export default function TimeEntryForm({ projects, onSubmit }: TimeEntryFormProps) {
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [regularHours, setRegularHours] = useState("");
  const [overtimeHours, setOvertimeHours] = useState("");
  const [costCode, setCostCode] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      projectId,
      date,
      regularHours: parseFloat(regularHours) || 0,
      overtimeHours: parseFloat(overtimeHours) || 0,
      costCode,
      notes,
    });
    setRegularHours("");
    setOvertimeHours("");
    setCostCode("");
    setNotes("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log Time Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId} required>
                <SelectTrigger id="project" data-testid="select-project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                data-testid="input-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="regularHours">Regular Hours</Label>
              <Input
                id="regularHours"
                type="number"
                step="0.25"
                min="0"
                max="24"
                placeholder="8.0"
                value={regularHours}
                onChange={(e) => setRegularHours(e.target.value)}
                data-testid="input-regular-hours"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="overtimeHours">Overtime Hours</Label>
              <Input
                id="overtimeHours"
                type="number"
                step="0.25"
                min="0"
                max="24"
                placeholder="0.0"
                value={overtimeHours}
                onChange={(e) => setOvertimeHours(e.target.value)}
                data-testid="input-overtime-hours"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="costCode">Cost Code</Label>
              <Input
                id="costCode"
                placeholder="e.g., 03-300 - Concrete"
                value={costCode}
                onChange={(e) => setCostCode(e.target.value)}
                required
                data-testid="input-cost-code"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="textarea-notes"
              />
            </div>
          </div>

          <Button type="submit" className="w-full" data-testid="button-submit-time">
            Submit Time Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
