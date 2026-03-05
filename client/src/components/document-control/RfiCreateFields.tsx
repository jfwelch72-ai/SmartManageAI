import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RFICreateForm } from "@/hooks/useRfiMutations";

interface Subcontractor {
  id: string;
  companyName: string;
}

interface RfiCreateFieldsProps {
  form: RFICreateForm | Omit<RFICreateForm, "projectId">;
  onChange: (updates: Partial<RFICreateForm>) => void;
  subcontractors: Subcontractor[];
  testIdPrefix?: string;
}

export default function RfiCreateFields({ form, onChange, subcontractors, testIdPrefix = "" }: RfiCreateFieldsProps) {
  const p = testIdPrefix;
  return (
    <>
      <div className="space-y-2">
        <Label>Subject *</Label>
        <Input
          value={form.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder="Brief description of the issue"
          data-testid={`${p}input-create-subject`}
        />
      </div>
      <div className="space-y-2">
        <Label>Question *</Label>
        <Textarea
          value={form.question}
          onChange={(e) => onChange({ question: e.target.value })}
          placeholder="Detailed question requiring clarification..."
          rows={4}
          data-testid={`${p}input-create-question`}
        />
      </div>
      <div className="space-y-2">
        <Label>Priority</Label>
        <Select value={form.priority} onValueChange={(v) => onChange({ priority: v })}>
          <SelectTrigger data-testid={`${p}select-create-priority`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LOW">Low</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="URGENT">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Subcontractor</Label>
        <Select
          value={form.subcontractorId || "none"}
          onValueChange={(v) => onChange({ subcontractorId: v === "none" ? "" : v })}
        >
          <SelectTrigger data-testid={`${p}select-create-subcontractor`}>
            <SelectValue placeholder="Select subcontractor (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {subcontractors.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.companyName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Drawing Reference</Label>
          <Input
            value={form.drawingReference}
            onChange={(e) => onChange({ drawingReference: e.target.value })}
            placeholder="e.g., Sheet A-201"
            data-testid={`${p}input-create-drawing-ref`}
          />
        </div>
        <div className="space-y-2">
          <Label>Spec Reference</Label>
          <Input
            value={form.specReference}
            onChange={(e) => onChange({ specReference: e.target.value })}
            placeholder="e.g., Section 03300"
            data-testid={`${p}input-create-spec-ref`}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Date Required</Label>
        <Input
          type="date"
          value={form.dateRequired}
          onChange={(e) => onChange({ dateRequired: e.target.value })}
          data-testid={`${p}input-create-date-required`}
        />
      </div>
      <div className="space-y-2">
        <Label>Impact Description</Label>
        <Textarea
          value={form.impactDescription}
          onChange={(e) => onChange({ impactDescription: e.target.value })}
          placeholder="Describe the impact if not resolved..."
          rows={2}
          data-testid={`${p}input-create-impact`}
        />
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${p}costImpact`}
            checked={form.costImpact}
            onCheckedChange={(c) => onChange({ costImpact: !!c })}
            data-testid={`${p}checkbox-create-cost-impact`}
          />
          <Label htmlFor={`${p}costImpact`} className="cursor-pointer">Cost Impact</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${p}scheduleImpact`}
            checked={form.scheduleImpact}
            onCheckedChange={(c) => onChange({ scheduleImpact: !!c })}
            data-testid={`${p}checkbox-create-schedule-impact`}
          />
          <Label htmlFor={`${p}scheduleImpact`} className="cursor-pointer">Schedule Impact</Label>
        </div>
      </div>
    </>
  );
}
