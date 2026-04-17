import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ProjectRef {
  id: string;
  name: string;
  projectNumber?: string | null;
  code?: string | null;
}

export function useProjectsList() {
  return useQuery<{ data: ProjectRef[] }>({ queryKey: ["/api/projects"] });
}

export function ProjectSelect({
  value,
  onChange,
  testId = "select-project",
  placeholder = "Select project…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
  placeholder?: string;
  className?: string;
}) {
  const { data, isLoading } = useProjectsList();
  const projects = data?.data ?? [];
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue placeholder={isLoading ? "Loading projects…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id} data-testid={`select-project-option-${p.id}`}>
            {p.projectNumber ? `${p.projectNumber} — ${p.name}` : p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString();
}

export function formatMoney(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Unknown error";
}

export function toDateInput(value?: string | Date | null): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

