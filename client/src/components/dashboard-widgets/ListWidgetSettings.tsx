import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ListWidgetConfig {
  entity?: string;
  status?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number;
}

export const DEFAULT_LIST_CONFIG: ListWidgetConfig = {
  entity: "PROJECTS",
  status: "",
  sortBy: "created_at",
  sortDir: "desc",
  limit: 5,
};

export const LIST_ENTITIES = [
  { value: "PROJECTS", label: "Projects" },
  { value: "ORGANIZATIONS", label: "Organizations" },
  { value: "TIME_ENTRIES", label: "Time Entries" },
  { value: "PAY_RUNS", label: "Pay Runs" },
  { value: "SUBCONTRACTS", label: "Subcontracts" },
  { value: "CHANGE_ORDERS", label: "Change Orders" },
];

const ENTITY_STATUSES: Record<string, Array<{ value: string; label: string }>> = {
  PROJECTS: [
    { value: "", label: "All Statuses" },
    { value: "PLANNING", label: "Planning" },
    { value: "ACTIVE", label: "Active" },
    { value: "ON_HOLD", label: "On Hold" },
    { value: "COMPLETED", label: "Completed" },
    { value: "CANCELLED", label: "Cancelled" },
  ],
  ORGANIZATIONS: [
    { value: "", label: "All Statuses" },
    { value: "NOT_STARTED", label: "Not Started" },
    { value: "IN_PROGRESS", label: "In Progress" },
    { value: "COMPLETED", label: "Completed" },
  ],
  TIME_ENTRIES: [
    { value: "", label: "All Statuses" },
    { value: "PENDING", label: "Pending" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
  ],
  PAY_RUNS: [
    { value: "", label: "All Statuses" },
    { value: "DRAFT", label: "Draft" },
    { value: "PROCESSING", label: "Processing" },
    { value: "APPROVED", label: "Approved" },
    { value: "PAID", label: "Paid" },
  ],
  SUBCONTRACTS: [
    { value: "", label: "All Statuses" },
    { value: "PENDING", label: "Pending" },
    { value: "ACTIVE", label: "Active" },
    { value: "COMPLETED", label: "Completed" },
    { value: "TERMINATED", label: "Terminated" },
  ],
  CHANGE_ORDERS: [
    { value: "", label: "All Statuses" },
    { value: "DRAFT", label: "Draft" },
    { value: "SUBMITTED", label: "Submitted" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
  ],
};

const ENTITY_SORT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  PROJECTS: [
    { value: "created_at", label: "Date Created" },
    { value: "name", label: "Name" },
    { value: "status", label: "Status" },
    { value: "start_date", label: "Start Date" },
    { value: "contract_amount", label: "Contract Amount" },
  ],
  ORGANIZATIONS: [
    { value: "created_at", label: "Date Created" },
    { value: "name", label: "Name" },
    { value: "trade_type", label: "Trade Type" },
  ],
  TIME_ENTRIES: [
    { value: "date", label: "Entry Date" },
    { value: "created_at", label: "Date Created" },
    { value: "hours_regular", label: "Regular Hours" },
    { value: "approval_status", label: "Status" },
  ],
  PAY_RUNS: [
    { value: "created_at", label: "Date Created" },
    { value: "pay_period_start", label: "Period Start" },
    { value: "status", label: "Status" },
    { value: "total_labor_cost", label: "Total Cost" },
  ],
  SUBCONTRACTS: [
    { value: "created_at", label: "Date Created" },
    { value: "contract_number", label: "Contract Number" },
    { value: "status", label: "Status" },
    { value: "contract_amount", label: "Amount" },
    { value: "start_date", label: "Start Date" },
  ],
  CHANGE_ORDERS: [
    { value: "created_at", label: "Date Created" },
    { value: "change_order_number", label: "CO Number" },
    { value: "status", label: "Status" },
    { value: "amount", label: "Amount" },
  ],
};

const LIST_LIMITS = [
  { value: "5", label: "5 items" },
  { value: "10", label: "10 items" },
  { value: "20", label: "20 items" },
];

const SORT_DIRECTIONS = [
  { value: "desc", label: "Descending (newest first)" },
  { value: "asc", label: "Ascending (oldest first)" },
];

interface ListWidgetSettingsProps {
  config: ListWidgetConfig;
  onChange: (config: ListWidgetConfig) => void;
}

export function ListWidgetSettings({ config, onChange }: ListWidgetSettingsProps) {
  const merged = { ...DEFAULT_LIST_CONFIG, ...config };
  const currentEntity = merged.entity || "PROJECTS";
  const statuses = ENTITY_STATUSES[currentEntity] || ENTITY_STATUSES.PROJECTS;
  const sortOptions = ENTITY_SORT_OPTIONS[currentEntity] || ENTITY_SORT_OPTIONS.PROJECTS;

  const handleEntityChange = (newEntity: string) => {
    const newSortOptions = ENTITY_SORT_OPTIONS[newEntity] || [];
    const defaultSort = newSortOptions.length > 0 ? newSortOptions[0].value : "created_at";
    onChange({
      ...merged,
      entity: newEntity,
      status: "",
      sortBy: defaultSort,
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">Data Source</Label>
        <Select value={currentEntity} onValueChange={handleEntityChange}>
          <SelectTrigger data-testid="select-list-entity">
            <SelectValue placeholder="Select data source" />
          </SelectTrigger>
          <SelectContent>
            {LIST_ENTITIES.map(e => (
              <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Filter by Status</Label>
        <Select value={merged.status || "_all"} onValueChange={(v) => onChange({ ...merged, status: v === "_all" ? "" : v })}>
          <SelectTrigger data-testid="select-list-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map(s => (
              <SelectItem key={s.value || "_all"} value={s.value || "_all"}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Sort By</Label>
        <Select value={merged.sortBy} onValueChange={(v) => onChange({ ...merged, sortBy: v })}>
          <SelectTrigger data-testid="select-list-sort-by">
            <SelectValue placeholder="Select sort field" />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Sort Direction</Label>
        <Select value={merged.sortDir} onValueChange={(v) => onChange({ ...merged, sortDir: v })}>
          <SelectTrigger data-testid="select-list-sort-dir">
            <SelectValue placeholder="Select direction" />
          </SelectTrigger>
          <SelectContent>
            {SORT_DIRECTIONS.map(d => (
              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Items to Show</Label>
        <Select value={String(merged.limit)} onValueChange={(v) => onChange({ ...merged, limit: parseInt(v) })}>
          <SelectTrigger data-testid="select-list-limit">
            <SelectValue placeholder="Select limit" />
          </SelectTrigger>
          <SelectContent>
            {LIST_LIMITS.map(l => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
