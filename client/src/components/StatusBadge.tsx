import { Badge } from "@/components/ui/badge";

type ProjectStatus = "BID" | "PLANNING" | "ACTIVE" | "COMPLETE" | "CLOSED";
type EstimateStatus = "DRAFT" | "SUBMITTED" | "WON" | "LOST";
type ProcurementStatus = "PLANNED" | "QUOTED" | "APPROVED" | "ORDERED" | "DELIVERED";

const projectStatusColors: Record<ProjectStatus, string> = {
  BID: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  PLANNING: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  COMPLETE: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  CLOSED: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
};

const estimateStatusColors: Record<EstimateStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  SUBMITTED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  WON: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  LOST: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const procurementStatusColors: Record<ProcurementStatus, string> = {
  PLANNED: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  QUOTED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  APPROVED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ORDERED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  DELIVERED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

interface StatusBadgeProps {
  status: ProjectStatus | EstimateStatus | ProcurementStatus;
  type: "project" | "estimate" | "procurement";
}

export default function StatusBadge({ status, type }: StatusBadgeProps) {
  let colorClass = "";
  
  if (type === "project") {
    colorClass = projectStatusColors[status as ProjectStatus];
  } else if (type === "estimate") {
    colorClass = estimateStatusColors[status as EstimateStatus];
  } else {
    colorClass = procurementStatusColors[status as ProcurementStatus];
  }

  return (
    <Badge className={`rounded-full px-3 py-1 text-xs font-medium ${colorClass}`} variant="secondary">
      {status}
    </Badge>
  );
}
