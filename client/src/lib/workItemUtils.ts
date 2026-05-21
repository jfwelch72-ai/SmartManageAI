import { format, formatDistanceToNowStrict, isToday, isPast } from "date-fns";
import {
  Briefcase,
  CheckSquare,
  ClipboardList,
  FileSignature,
  FileText,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

interface WithDueDate {
  dueDate: string | null;
}

export type MyDayType = "TASK" | "RFI" | "SUBMITTAL" | "PUNCH" | "APPROVAL" | "CRM_TASK";

export const MY_DAY_TYPE_META: Record<MyDayType, { label: string; short: string; icon: LucideIcon; badgeClass: string }> = {
  TASK: {
    label: "Task",
    short: "TASK",
    icon: CheckSquare,
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800",
  },
  RFI: {
    label: "RFI",
    short: "RFI",
    icon: FileText,
    badgeClass: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900 dark:text-violet-200 dark:border-violet-800",
  },
  SUBMITTAL: {
    label: "Submittal",
    short: "SUB",
    icon: FileSignature,
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900 dark:text-emerald-200 dark:border-emerald-800",
  },
  PUNCH: {
    label: "Punch",
    short: "PUNCH",
    icon: ClipboardList,
    badgeClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-800",
  },
  APPROVAL: {
    label: "Approval",
    short: "APPR",
    icon: ShieldCheck,
    badgeClass: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900 dark:text-rose-200 dark:border-rose-800",
  },
  CRM_TASK: {
    label: "CRM Task",
    short: "CRM",
    icon: Briefcase,
    badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-800",
  },
};

export type MyWorkType = "TASK" | "CRM_TASK" | "PUNCH" | "RFI" | "INSPECTION";

export const TYPE_META: Record<MyWorkType, { label: string; short: string; icon: LucideIcon; badgeClass: string }> = {
  TASK: {
    label: "Project Task",
    short: "TASK",
    icon: CheckSquare,
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800",
  },
  CRM_TASK: {
    label: "CRM Task",
    short: "CRM",
    icon: Briefcase,
    badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900 dark:text-indigo-200 dark:border-indigo-800",
  },
  PUNCH: {
    label: "Punch Item",
    short: "PUNCH",
    icon: ClipboardList,
    badgeClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900 dark:text-amber-200 dark:border-amber-800",
  },
  RFI: {
    label: "RFI",
    short: "RFI",
    icon: FileText,
    badgeClass: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900 dark:text-violet-200 dark:border-violet-800",
  },
  INSPECTION: {
    label: "Inspection",
    short: "INSP",
    icon: ShieldCheck,
    badgeClass: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900 dark:text-rose-200 dark:border-rose-800",
  },
};

export function dueColor(item: WithDueDate): string {
  if (!item.dueDate) return "text-muted-foreground";
  const d = new Date(item.dueDate);
  if (isPast(d) && !isToday(d)) return "text-red-600 dark:text-red-400";
  if (isToday(d)) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

export function dueLabel(item: WithDueDate): string {
  if (!item.dueDate) return "No due date";
  const d = new Date(item.dueDate);
  if (isToday(d)) return "Due today";
  const rel = formatDistanceToNowStrict(d, { addSuffix: true });
  return `${format(d, "MMM d")} · ${rel}`;
}
