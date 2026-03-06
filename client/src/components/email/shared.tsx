import type { ReactNode } from "react";
import {
  Mail,
  Archive,
  FileText,
  DollarSign,
  AlertCircle,
  Building,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface EmailThread {
  id: string;
  subject: string;
  status: string;
  messageCount: number;
  unreadCount: number;
  lastMessageAt: string;
  primaryClassification: string | null;
  aiSummary: string | null;
  projectId: string | null;
  bidId: string | null;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  fromName: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  receivedAt: string;
  isRead: boolean;
  classification: string | null;
  hasAttachments: boolean;
}

export interface EmailTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  emailThreadId: string | null;
  projectId: string | null;
}

export interface EmailAccount {
  id: string;
  provider: string;
  emailAddress: string;
  displayName: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
}

export const CLASSIFICATION_LABELS: Record<string, { label: string; color: string; icon: ReactNode }> = {
  PROJECT_UPDATE: { label: "Project Update", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: <FileText className="w-3 h-3" /> },
  BID_INVITE: { label: "Bid Invite", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: <FileText className="w-3 h-3" /> },
  BID_RFI: { label: "Bid RFI", color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200", icon: <MessageSquare className="w-3 h-3" /> },
  CHANGE_ORDER_REQUEST: { label: "Change Order", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: <FileText className="w-3 h-3" /> },
  SUBMITTAL_REQUEST: { label: "Submittal", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", icon: <FileText className="w-3 h-3" /> },
  PAY_APP: { label: "Pay App", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200", icon: <DollarSign className="w-3 h-3" /> },
  INVOICE: { label: "Invoice", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: <DollarSign className="w-3 h-3" /> },
  DELAY_NOTICE: { label: "Delay Notice", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <AlertCircle className="w-3 h-3" /> },
  SAFETY_ISSUE: { label: "Safety Issue", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", icon: <AlertCircle className="w-3 h-3" /> },
  DELIVERY_NOTICE: { label: "Delivery", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200", icon: <Building className="w-3 h-3" /> },
  VENDOR_PRICING: { label: "Vendor Pricing", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200", icon: <DollarSign className="w-3 h-3" /> },
  GENERAL_COMMUNICATION: { label: "General", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200", icon: <Mail className="w-3 h-3" /> },
  SPAM_OR_IRRELEVANT: { label: "Spam", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", icon: <Archive className="w-3 h-3" /> },
  OTHER: { label: "Other", color: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300", icon: <Mail className="w-3 h-3" /> },
};

export function ClassificationBadge({ classification }: { classification: string | null }) {
  if (!classification) return null;
  const config = CLASSIFICATION_LABELS[classification] || CLASSIFICATION_LABELS.OTHER;
  return (
    <Badge variant="secondary" className={`${config.color} gap-1 text-xs`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    CRITICAL: "bg-red-600 text-white",
    HIGH: "bg-orange-500 text-white",
    MEDIUM: "bg-yellow-500 text-black",
    LOW: "bg-gray-400 text-white",
  };
  return (
    <Badge className={colors[priority] || colors.MEDIUM}>
      {priority}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    DISMISSED: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  };
  return (
    <Badge variant="secondary" className={colors[status] || colors.PENDING}>
      {status.replace("_", " ")}
    </Badge>
  );
}
