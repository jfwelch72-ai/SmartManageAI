import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardCustomization, type FeaturePermissionKey } from "@/hooks/use-dashboard-customization";
import {
  Plus,
  UserPlus,
  DollarSign,
  Users,
  CalendarDays,
  FileText,
  Clock,
  Upload,
  Ruler,
  Calculator,
  Send,
  Camera,
  AlertTriangle,
  Shield,
  Search,
  ShoppingCart,
  Wrench,
  Truck,
  BarChart3,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  roles: string[];
  featurePerm?: FeaturePermissionKey;
}

const ALL_ACTIONS: QuickAction[] = [
  { id: "create-project", label: "Create Project", icon: Plus, href: "/projects?new=true", roles: ["ADMIN", "MANAGER", "SUPERINTENDENT"] },
  { id: "invite-user", label: "Invite User", icon: UserPlus, href: "/users?new=true", roles: ["ADMIN"] },
  { id: "approve-payroll", label: "Approve Payroll", icon: DollarSign, href: "/payroll-management", roles: ["ADMIN", "MANAGER"], featurePerm: "canManagePayroll" },
  { id: "assign-crew", label: "Assign Crew", icon: Users, href: "/crews", roles: ["MANAGER", "SUPERINTENDENT"] },
  { id: "update-schedule", label: "Update Schedule", icon: CalendarDays, href: "/crews", roles: ["MANAGER", "SUPERINTENDENT"] },
  { id: "submit-rfi", label: "Submit RFI", icon: FileText, href: "/projects", roles: ["MANAGER", "SUPERINTENDENT"] },
  { id: "approve-time", label: "Approve Time Logs", icon: Clock, href: "/time-entry", roles: ["MANAGER", "SUPERINTENDENT"] },
  { id: "upload-plans", label: "Upload Plans", icon: Upload, href: "/bids", roles: ["ESTIMATOR"] },
  { id: "create-takeoff", label: "Create Takeoff", icon: Ruler, href: "/bids", roles: ["ESTIMATOR"] },
  { id: "generate-estimate", label: "Generate Estimate", icon: Calculator, href: "/bids", roles: ["ESTIMATOR"] },
  { id: "submit-bid", label: "Submit Bid", icon: Send, href: "/bids/new", roles: ["ESTIMATOR", "ADMIN"] },
  { id: "clock-in-out", label: "Clock In / Out", icon: Clock, href: "/time-clock", roles: ["FIELD_WORKER", "HOURLY_EMPLOYEE", "SUPERINTENDENT"] },
  { id: "submit-time", label: "Submit Time Log", icon: Clock, href: "/time-entry", roles: ["FIELD_WORKER", "HOURLY_EMPLOYEE"] },
  { id: "upload-photo", label: "Upload Site Photo", icon: Camera, href: "/projects", roles: ["FIELD_WORKER", "HOURLY_EMPLOYEE", "SUPERINTENDENT"] },
  { id: "report-issue", label: "Report Issue", icon: AlertTriangle, href: "/issue-captures", roles: ["FIELD_WORKER", "HOURLY_EMPLOYEE", "SUPERINTENDENT"] },
  { id: "process-payroll", label: "Process Payroll", icon: DollarSign, href: "/payroll-management", roles: ["ADMIN", "MANAGER"], featurePerm: "canManagePayroll" },
  { id: "upload-docs", label: "Upload Documents", icon: Upload, href: "/projects", roles: ["ADMIN", "MANAGER"] },
  { id: "add-employee", label: "Add Employee", icon: UserPlus, href: "/users?new=true", roles: ["ADMIN"] },
  { id: "approve-leave", label: "Approve Leave", icon: CalendarDays, href: "/time-entry", roles: ["ADMIN", "MANAGER"] },
  { id: "report-incident", label: "Report Incident", icon: Shield, href: "/issue-captures", roles: ["SUPERINTENDENT", "MANAGER"] },
  { id: "schedule-inspection", label: "Schedule Inspection", icon: Search, href: "/issue-captures", roles: ["SUPERINTENDENT", "MANAGER"] },
  { id: "create-po", label: "Create PO", icon: ShoppingCart, href: "/vendor-pricing", roles: ["ADMIN", "MANAGER"], featurePerm: "canManageProcurement" },
  { id: "request-quote", label: "Request Quote", icon: FileText, href: "/vendor-pricing", roles: ["ADMIN", "MANAGER", "SUPERINTENDENT"] },
  { id: "log-maintenance", label: "Log Maintenance", icon: Wrench, href: "/equipment", roles: ["ADMIN", "MANAGER", "SUPERINTENDENT"], featurePerm: "canManageEquipment" },
  { id: "assign-equipment", label: "Assign Equipment", icon: Truck, href: "/equipment", roles: ["ADMIN", "MANAGER", "SUPERINTENDENT"], featurePerm: "canManageEquipment" },
  { id: "view-reports", label: "View Reports", icon: BarChart3, href: "/reports", roles: ["MANAGER", "ADMIN"], featurePerm: "canAccessReports" },
  { id: "manage-workers", label: "Manage Workers", icon: Users, href: "/manage-workers", roles: ["ADMIN", "MANAGER"] },
  { id: "view-subcontracts", label: "Subcontracts", icon: FileText, href: "/subcontracts", roles: ["ADMIN", "MANAGER", "SUPERINTENDENT"] },
  { id: "social-media", label: "Social Media", icon: MessageSquare, href: "/social-media", roles: ["ADMIN", "MANAGER"], featurePerm: "canPostSocialMedia" },
  { id: "website-builder", label: "Website Builder", icon: FileText, href: "/website-builder", roles: ["ADMIN"], featurePerm: "canManageWebsite" },
];

const FALLBACK_ACTIONS: QuickAction[] = [
  { id: "fb-projects", label: "View Projects", icon: FileText, href: "/projects", roles: [] },
  { id: "fb-calendar", label: "Calendar", icon: CalendarDays, href: "/calendar", roles: [] },
  { id: "fb-messages", label: "Messages", icon: MessageSquare, href: "#open-messages", roles: [] },
];

export function QuickActionsWidget() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { permissions } = useDashboardCustomization();
  const role = (user as any)?.effectiveRole || user?.role || "";
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const actions = ALL_ACTIONS.filter((action) => {
    if (!action.roles.includes(role)) return false;
    if (action.featurePerm && !isAdmin && !permissions[action.featurePerm]) return false;
    return true;
  });

  const displayActions = actions.length > 0 ? actions : FALLBACK_ACTIONS;

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 h-full"
      data-testid="quick-actions"
    >
      {displayActions.map((action) => {
        const Icon = action.icon;
        return (
          <Card
            key={action.id}
            className="hover-elevate cursor-pointer transition-colors"
            onClick={() => {
              if (action.href === "#open-messages") {
                window.dispatchEvent(new CustomEvent("open-messaging-widget"));
              } else {
                setLocation(action.href);
              }
            }}
            data-testid={`quick-action-${action.id}`}
          >
            <CardContent className="flex items-center gap-2 p-3">
              <Icon className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-xs font-medium truncate">{action.label}</span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
