import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  UserPlus,
  Search,
  Filter,
  X,
  Settings,
  Info,
  DollarSign,
  FileBarChart,
  Sparkles,
  Share2,
  Globe,
  Wrench,
  ShoppingCart,
  CreditCard,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  FileText,
  Users,
  Shield,
  CalendarClock,
  Network,
  CalendarOff,
  Clock,
  Zap,
  Save,
  Trash2,
  PackageOpen,
} from "lucide-react";
import type { SelectUser } from "@shared/schema";

interface PermissionSet {
  canAccessFinancials: boolean;
  canManagePayroll: boolean;
  canAccessReports: boolean;
  canUseAiFeatures: boolean;
  canPostSocialMedia: boolean;
  canManageWebsite: boolean;
  canManageEquipment: boolean;
  canManageProcurement: boolean;
  canManageContracts: boolean;
  canManageHiring: boolean;
  canManageSafety: boolean;
  canManageScheduling: boolean;
  canAccessBidNetwork: boolean;
  canManageLeave: boolean;
  canAccessTimeMaterial: boolean;
}

interface UserWithPermissions extends SelectUser {
  canAccessFinancials?: boolean;
  canManagePayroll?: boolean;
  canAccessReports?: boolean;
  canUseAiFeatures?: boolean;
  canPostSocialMedia?: boolean;
  canManageWebsite?: boolean;
  canManageEquipment?: boolean;
  canManageProcurement?: boolean;
  canManageContracts?: boolean;
  canManageHiring?: boolean;
  canManageSafety?: boolean;
  canManageScheduling?: boolean;
  canAccessBidNetwork?: boolean;
  canManageLeave?: boolean;
  canAccessTimeMaterial?: boolean;
  roleDefaults?: PermissionSet;
  effective?: PermissionSet;
  effectiveRole?: string;
  grantedAt?: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  SUPERINTENDENT: "Superintendent",
  ESTIMATOR: "Estimator",
  FIELD_WORKER: "Field Worker",
  HOURLY_EMPLOYEE: "Field Worker",
  VENDOR: "Vendor",
  HUSTLER: "Hustler",
};

const ASSIGNABLE_ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  SUPERINTENDENT: "Superintendent",
  ESTIMATOR: "Estimator",
  FIELD_WORKER: "Field Worker",
  VENDOR: "Vendor",
};

const ROLE_COLORS: Record<string, "default" | "secondary" | "destructive"> = {
  ADMIN: "destructive",
  HUSTLER: "destructive",
  MANAGER: "default",
  SUPERINTENDENT: "default",
  ESTIMATOR: "default",
  FIELD_WORKER: "secondary",
  HOURLY_EMPLOYEE: "secondary",
  VENDOR: "secondary",
  HUSTLER: "destructive",
};

// Status filter options
const STATUS_FILTERS = [
  { value: "ALL", label: "All Status" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

const HUSTLER_BASE_PERMISSIONS = new Set([
  "canAccessFinancials",
  "canAccessKPIs",
  "canManageHiring",
  "canAccessHiringInterviews",
]);

export default function UsersPage({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [activeTab, setActiveTab] = useState("users");

  // Invite user dialog state
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "FIELD_WORKER",
    password: "",
  });

  const { data: rawUsers = [], isLoading } = useQuery<SelectUser[]>({
    queryKey: ["/api/users"],
  });
  const users = rawUsers.filter(u => u.role !== "SUPER_ADMIN");

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: typeof inviteForm) => {
      return await apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "User created successfully",
      });
      setShowInviteDialog(false);
      setInviteForm({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        role: "FIELD_WORKER",
        password: "",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !inviteForm.firstName ||
      !inviteForm.lastName ||
      !inviteForm.email ||
      !inviteForm.password
    ) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    if (inviteForm.password.length < 8) {
      toast({
        title: "Error",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }
    createUserMutation.mutate(inviteForm);
  };

  // Fetch dashboard permissions for all users (admin only)
  const { data: usersWithPermissions = [], isLoading: permissionsLoading } =
    useQuery<UserWithPermissions[]>({
      queryKey: ["/api/dashboard/permissions"],
      enabled: user?.role === "ADMIN",
    });

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search filter
      const fullName = `${u.firstName} ${u.lastName}`.toLowerCase();
      const matchesSearch =
        fullName.includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (u.phone && u.phone.includes(searchTerm));

      if (!matchesSearch) return false;

      // Role filter
      if (roleFilter !== "ALL" && u.role !== roleFilter) return false;

      // Status filter
      if (statusFilter === "ACTIVE" && !u.isActive) return false;
      if (statusFilter === "INACTIVE" && u.isActive) return false;

      return true;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  const updateUserMutation = useMutation({
    mutationFn: async ({
      userId,
      data,
    }: {
      userId: string;
      data: Partial<SelectUser>;
    }) => {
      return await apiRequest("PATCH", `/api/users/${userId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "Success",
        description: "User updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user",
        variant: "destructive",
      });
    },
  });

  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    await updateUserMutation.mutateAsync({
      userId,
      data: { isActive: !currentStatus },
    });
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    await updateUserMutation.mutateAsync({
      userId,
      data: { role: newRole as any },
    });
  };

  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [permSearchTerm, setPermSearchTerm] = useState("");

  interface PresetData {
    id: string;
    name: string;
    description: string | null;
    targetRole: string;
    permissions: Record<string, boolean>;
    isBuiltIn: boolean;
    organizationId: string | null;
  }

  const [presetConfirm, setPresetConfirm] = useState<{ userId: string; preset: PresetData } | null>(null);
  const [showSavePreset, setShowSavePreset] = useState<{ userId: string; role: string; permissions: Record<string, boolean> } | null>(null);
  const [savePresetName, setSavePresetName] = useState("");
  const [savePresetDesc, setSavePresetDesc] = useState("");
  const [deletePresetConfirm, setDeletePresetConfirm] = useState<PresetData | null>(null);

  const { data: presets = [] } = useQuery<PresetData[]>({
    queryKey: ['/api/dashboard/permission-presets'],
    enabled: user?.role === "ADMIN",
  });

  const applyPresetMutation = useMutation({
    mutationFn: async ({ userId, presetId }: { userId: string; presetId: string }) => {
      return await apiRequest("PUT", `/api/dashboard/permissions/${userId}/apply-preset`, { presetId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/permissions"] });
      toast({ title: "Preset applied", description: "Permission preset has been applied to the user" });
      setPresetConfirm(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to apply preset", variant: "destructive" });
    },
  });

  const savePresetMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; targetRole: string; permissions: Record<string, boolean> }) => {
      return await apiRequest("POST", "/api/dashboard/permission-presets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/permission-presets"] });
      toast({ title: "Preset saved", description: "Custom permission preset has been saved" });
      setShowSavePreset(null);
      setSavePresetName("");
      setSavePresetDesc("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save preset", variant: "destructive" });
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: async (presetId: string) => {
      return await apiRequest("DELETE", `/api/dashboard/permission-presets/${presetId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/permission-presets"] });
      toast({ title: "Preset deleted", description: "Custom permission preset has been deleted" });
      setDeletePresetConfirm(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete preset", variant: "destructive" });
    },
  });

  const PERMISSION_GROUPS = [
    {
      label: "Financial",
      permissions: [
        { key: "canAccessFinancials" as const, label: "Financials Access", icon: DollarSign, description: "View budgets, cost rates, and CFO dashboard" },
        { key: "canManagePayroll" as const, label: "Payroll Management", icon: CreditCard, description: "Manage payroll, pay runs, and deductions" },
      ],
    },
    {
      label: "Operations",
      permissions: [
        { key: "canAccessReports" as const, label: "Reports Access", icon: FileBarChart, description: "View and export all report types" },
        { key: "canUseAiFeatures" as const, label: "AI Features", icon: Sparkles, description: "Use AI assistant, analysis, and generation tools" },
      ],
    },
    {
      label: "Marketing",
      permissions: [
        { key: "canPostSocialMedia" as const, label: "Social Media", icon: Share2, description: "Create, edit, and publish social media posts" },
        { key: "canManageWebsite" as const, label: "Website Management", icon: Globe, description: "Manage website builder, SEO, and media" },
      ],
    },
    {
      label: "Management",
      permissions: [
        { key: "canManageEquipment" as const, label: "Equipment", icon: Wrench, description: "Manage equipment and maintenance records" },
        { key: "canManageProcurement" as const, label: "Procurement", icon: ShoppingCart, description: "Manage procurement and vendor pricing" },
      ],
    },
    {
      label: "Contracts & Hiring",
      permissions: [
        { key: "canManageContracts" as const, label: "Contracts", icon: FileText, description: "Manage contracts, clause library, and approvals" },
        { key: "canManageHiring" as const, label: "Hiring & ATS", icon: Users, description: "Manage job postings, candidates, and hiring pipeline" },
      ],
    },
    {
      label: "Safety & Leave",
      permissions: [
        { key: "canManageSafety" as const, label: "Safety Training", icon: Shield, description: "Manage safety programs and training assignments" },
        { key: "canManageLeave" as const, label: "Leave Management", icon: CalendarOff, description: "Manage leave requests and approvals" },
      ],
    },
    {
      label: "Scheduling & T&M",
      permissions: [
        { key: "canManageScheduling" as const, label: "Scheduling & Crews", icon: CalendarClock, description: "Manage crews, scheduling, and time entries" },
        { key: "canAccessTimeMaterial" as const, label: "T&M Billing", icon: Clock, description: "Access T&M daily sheets and billing" },
        { key: "canAccessBidNetwork" as const, label: "Bid Network", icon: Network, description: "Access bid network and solicitations" },
      ],
    },
  ];

  const ALL_PERM_KEYS = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));

  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: Record<string, boolean> }) => {
      return await apiRequest("PUT", `/api/dashboard/permissions/${userId}`, permissions);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/permissions"] });
      toast({ title: "Success", description: "User permissions updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update permissions", variant: "destructive" });
    },
  });

  const handleTogglePermission = async (userId: string, permKey: string, currentValue: boolean, userPerms: UserWithPermissions) => {
    const currentPermissions: Record<string, boolean> = {};
    ALL_PERM_KEYS.forEach(k => { currentPermissions[k] = !!(userPerms as any)[k]; });
    currentPermissions[permKey] = !currentValue;
    await updatePermissionsMutation.mutateAsync({ userId, permissions: currentPermissions });
  };

  const handleGrantAll = async (userId: string) => {
    const allGranted: Record<string, boolean> = {};
    ALL_PERM_KEYS.forEach(k => { allGranted[k] = true; });
    await updatePermissionsMutation.mutateAsync({ userId, permissions: allGranted });
  };

  const handleRevokeAll = async (userId: string, roleDefaults?: PermissionSet) => {
    const revoked: Record<string, boolean> = {};
    ALL_PERM_KEYS.forEach(k => { revoked[k] = roleDefaults?.[k] ? true : false; });
    await updatePermissionsMutation.mutateAsync({ userId, permissions: revoked });
  };

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) { next.delete(userId); } else { next.add(userId); }
      return next;
    });
  };

  const filteredPermUsers = useMemo(() => {
    if (!permSearchTerm) return usersWithPermissions;
    const term = permSearchTerm.toLowerCase();
    return usersWithPermissions.filter(u =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term)
    );
  }, [usersWithPermissions, permSearchTerm]);

  if (!user) {
    return null;
  }

  if (!embedded && user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-full px-6 py-8">
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-2xl font-bold">Access Denied</h2>
              <p className="text-muted-foreground">
                Only administrators can access this page.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const contentBody = (
    <>
      <div className="flex justify-end">
        <Button
          data-testid="button-invite-user"
          onClick={() => setShowInviteDialog(true)}
        >
          <UserPlus className="w-4 h-4 mr-2" />
          Invite User
        </Button>
      </div>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite New User</DialogTitle>
              <DialogDescription>
                Create a new user account for your organization
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    data-testid="input-invite-first-name"
                    value={inviteForm.firstName}
                    onChange={(e) =>
                      setInviteForm({
                        ...inviteForm,
                        firstName: e.target.value,
                      })
                    }
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    data-testid="input-invite-last-name"
                    value={inviteForm.lastName}
                    onChange={(e) =>
                      setInviteForm({ ...inviteForm, lastName: e.target.value })
                    }
                    placeholder="Doe"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid="input-invite-email"
                  value={inviteForm.email}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, email: e.target.value })
                  }
                  placeholder="john.doe@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  data-testid="input-invite-phone"
                  value={inviteForm.phone}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, phone: e.target.value })
                  }
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(value) =>
                    setInviteForm({ ...inviteForm, role: value })
                  }
                >
                  <SelectTrigger data-testid="select-invite-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSIGNABLE_ROLE_LABELS).map(([value, label]) => (
                      <SelectItem
                        key={value}
                        value={value}
                        data-testid={`option-role-${value.toLowerCase()}`}
                      >
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground" data-testid="text-hustler-role-note">
                  The Hustler role is automatically assigned during onboarding for multi-organization owners and cannot be manually assigned.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Temporary Password *</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid="input-invite-password"
                  value={inviteForm.password}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, password: e.target.value })
                  }
                  placeholder="Min 8 characters"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowInviteDialog(false)}
                  data-testid="button-invite-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createUserMutation.isPending}
                  data-testid="button-invite-submit"
                >
                  {createUserMutation.isPending ? "Creating..." : "Create User"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList data-testid="tabs-user-management">
            <TabsTrigger value="users" data-testid="tab-users">
              <UserPlus className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="customization" data-testid="tab-customization">
              <Settings className="w-4 h-4 mr-2" />
              Feature Permissions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
                <CardTitle>All Users</CardTitle>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, email, phone..."
                      className="pl-9 w-[220px]"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      data-testid="input-search-users"
                    />
                  </div>
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger
                      className="w-[160px]"
                      data-testid="select-role-filter"
                    >
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Roles</SelectItem>
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger
                      className="w-[140px]"
                      data-testid="select-status-filter"
                    >
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              {(searchTerm ||
                roleFilter !== "ALL" ||
                statusFilter !== "ALL") && (
                <div className="px-6 pb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Active filters:
                  </span>
                  {searchTerm && (
                    <Badge variant="secondary" className="gap-1">
                      Search: "{searchTerm}"
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSearchTerm("")}
                        data-testid="button-clear-search"
                      />
                    </Badge>
                  )}
                  {roleFilter !== "ALL" && (
                    <Badge variant="secondary" className="gap-1">
                      {ROLE_LABELS[roleFilter]}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setRoleFilter("ALL")}
                        data-testid="button-clear-role-filter"
                      />
                    </Badge>
                  )}
                  {statusFilter !== "ALL" && (
                    <Badge variant="secondary" className="gap-1">
                      {statusFilter === "ACTIVE" ? "Active" : "Inactive"}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setStatusFilter("ALL")}
                        data-testid="button-clear-status-filter"
                      />
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setRoleFilter("ALL");
                      setStatusFilter("ALL");
                    }}
                    data-testid="button-clear-all-filters"
                  >
                    Clear all
                  </Button>
                </div>
              )}
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8" data-testid="text-loading">
                    Loading users...
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {searchTerm ||
                    roleFilter !== "ALL" ||
                    statusFilter !== "ALL"
                      ? "No users match your filters"
                      : "No users found"}
                  </div>
                ) : isMobile ? (
                  <div className="space-y-3">
                    {filteredUsers.map((u) => (
                      <Card key={u.id} data-testid={`row-user-${u.id}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div>
                              <div
                                className="font-medium"
                                data-testid={`text-name-${u.id}`}
                              >
                                {u.firstName} {u.lastName}
                              </div>
                              <div
                                className="text-sm text-muted-foreground"
                                data-testid={`text-email-${u.id}`}
                              >
                                {u.email}
                              </div>
                              <div
                                className="text-sm text-muted-foreground"
                                data-testid={`text-phone-${u.id}`}
                              >
                                {u.phone || "—"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={u.isActive ? "default" : "secondary"}
                                data-testid={`badge-status-${u.id}`}
                              >
                                {u.isActive ? "Active" : "Inactive"}
                              </Badge>
                              <Switch
                                checked={u.isActive}
                                onCheckedChange={() =>
                                  handleToggleActive(u.id, u.isActive)
                                }
                                disabled={updateUserMutation.isPending}
                                data-testid={`switch-active-${u.id}`}
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              Role
                            </Label>
                            <Select
                              value={u.role}
                              onValueChange={(newRole) =>
                                handleRoleChange(u.id, newRole)
                              }
                              disabled={updateUserMutation.isPending}
                            >
                              <SelectTrigger
                                data-testid={`select-role-${u.id}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(ASSIGNABLE_ROLE_LABELS).map(
                                  ([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                      {label}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">
                            Name
                          </TableHead>
                          <TableHead className="whitespace-nowrap">
                            Email
                          </TableHead>
                          <TableHead className="whitespace-nowrap">
                            Phone
                          </TableHead>
                          <TableHead className="whitespace-nowrap">
                            Role
                          </TableHead>
                          <TableHead className="whitespace-nowrap">
                            Status
                          </TableHead>
                          <TableHead className="whitespace-nowrap">
                            Active
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.map((u) => (
                          <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                            <TableCell
                              className="font-medium"
                              data-testid={`text-name-${u.id}`}
                            >
                              {u.firstName} {u.lastName}
                            </TableCell>
                            <TableCell data-testid={`text-email-${u.id}`}>
                              {u.email}
                            </TableCell>
                            <TableCell
                              className="text-muted-foreground"
                              data-testid={`text-phone-${u.id}`}
                            >
                              {u.phone || "—"}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={u.role}
                                onValueChange={(newRole) =>
                                  handleRoleChange(u.id, newRole)
                                }
                                disabled={updateUserMutation.isPending}
                              >
                                <SelectTrigger
                                  className="w-[180px]"
                                  data-testid={`select-role-${u.id}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(ASSIGNABLE_ROLE_LABELS).map(
                                    ([value, label]) => (
                                      <SelectItem key={value} value={value}>
                                        {label}
                                      </SelectItem>
                                    ),
                                  )}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={u.isActive ? "default" : "secondary"}
                                data-testid={`badge-status-${u.id}`}
                              >
                                {u.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={u.isActive}
                                onCheckedChange={() =>
                                  handleToggleActive(u.id, u.isActive)
                                }
                                disabled={updateUserMutation.isPending}
                                data-testid={`switch-active-${u.id}`}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customization">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Feature Permissions</CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>
                        Control which features each user can access. Admins always have full access to all features. Permissions are additive — they grant access on top of the user's base role.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <CardDescription>
                  Grant or revoke granular feature access for team members
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users..."
                      value={permSearchTerm}
                      onChange={(e) => setPermSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-perm-search"
                    />
                  </div>
                </div>

                {permissionsLoading ? (
                  <div className="space-y-4" data-testid="text-permissions-loading">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="animate-pulse">
                        <div className="h-16 bg-muted rounded-lg" />
                      </div>
                    ))}
                  </div>
                ) : filteredPermUsers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {permSearchTerm ? "No users match your search" : "No users found"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredPermUsers.map((u) => {
                      const isAdmin = u.role === "ADMIN";
                      const isExpanded = expandedUsers.has(u.id) || isMobile;
                      const effectivePerms = u.effective;
                      const grantedCount = isAdmin ? ALL_PERM_KEYS.length : effectivePerms ? ALL_PERM_KEYS.filter(k => effectivePerms[k]).length : ALL_PERM_KEYS.filter(k => !!(u as any)[k]).length;

                      return (
                        <Card key={u.id} data-testid={`row-permission-${u.id}`} className="overflow-hidden">
                          <div
                            className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors min-h-[56px]"
                            onClick={() => !isMobile && toggleUserExpanded(u.id)}
                            data-testid={`button-expand-${u.id}`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium truncate" data-testid={`text-perm-name-${u.id}`}>
                                    {u.firstName} {u.lastName}
                                  </span>
                                  <Badge variant={ROLE_COLORS[u.role] || "secondary"} className="shrink-0">
                                    {ROLE_LABELS[u.role] || u.role}
                                  </Badge>
                                </div>
                                <div className="text-sm text-muted-foreground truncate" data-testid={`text-perm-email-${u.id}`}>
                                  {u.email}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant={grantedCount === ALL_PERM_KEYS.length ? "default" : grantedCount > 0 ? "secondary" : "outline"} className="text-xs">
                                  {grantedCount}/{ALL_PERM_KEYS.length}
                                </Badge>
                                {!isMobile && (
                                  isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t px-4 pb-4 pt-3 space-y-4">
                              {!isAdmin && (() => {
                                const userPresets = presets.filter(p => p.targetRole === u.role);
                                return userPresets.length > 0 ? (
                                  <div data-testid={`section-presets-${u.id}`}>
                                    <div className="flex items-center gap-2 mb-2">
                                      <PackageOpen className="w-4 h-4 text-muted-foreground" />
                                      <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Apply Preset</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                      {userPresets.map((preset) => (
                                        <div
                                          key={preset.id}
                                          className="flex items-center justify-between gap-2 p-2.5 rounded-lg border hover:bg-muted/50 transition-colors"
                                          data-testid={`preset-card-${preset.id}`}
                                        >
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-sm font-medium truncate">{preset.name}</span>
                                              {!preset.isBuiltIn && (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">Custom</Badge>
                                              )}
                                            </div>
                                            {preset.description && (
                                              <div className="text-xs text-muted-foreground truncate">{preset.description}</div>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1 shrink-0">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-7 px-2 text-xs"
                                              onClick={() => setPresetConfirm({ userId: u.id, preset })}
                                              disabled={applyPresetMutation.isPending}
                                              data-testid={`button-apply-preset-${preset.id}-${u.id}`}
                                            >
                                              <Zap className="w-3 h-3 mr-1" />
                                              Apply
                                            </Button>
                                            {!preset.isBuiltIn && (
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                onClick={() => setDeletePresetConfirm(preset)}
                                                data-testid={`button-delete-preset-${preset.id}`}
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </Button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null;
                              })()}
                              {!isAdmin && (
                                <div className="flex gap-2 flex-wrap">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 sm:flex-none"
                                    onClick={() => handleGrantAll(u.id)}
                                    disabled={updatePermissionsMutation.isPending}
                                    data-testid={`button-grant-all-${u.id}`}
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                                    Grant All
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 sm:flex-none"
                                    onClick={() => handleRevokeAll(u.id, u.roleDefaults)}
                                    disabled={updatePermissionsMutation.isPending}
                                    data-testid={`button-revoke-all-${u.id}`}
                                  >
                                    <XCircle className="w-3.5 h-3.5 mr-1.5" />
                                    Revoke All
                                  </Button>
                                  {["MANAGER", "SUPERINTENDENT", "ESTIMATOR", "VENDOR"].includes(u.role) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="flex-1 sm:flex-none"
                                    onClick={() => {
                                      const currentPerms: Record<string, boolean> = {};
                                      if (u.effective) {
                                        const eff = u.effective as Record<string, boolean>;
                                        Object.keys(eff).forEach(k => {
                                          currentPerms[k] = !!eff[k];
                                        });
                                      } else {
                                        const uRecord = u as unknown as Record<string, unknown>;
                                        ALL_PERM_KEYS.forEach(k => { currentPerms[k] = !!uRecord[k]; });
                                      }
                                      setShowSavePreset({ userId: u.id, role: u.role, permissions: currentPerms });
                                      setSavePresetName("");
                                      setSavePresetDesc("");
                                    }}
                                    data-testid={`button-save-preset-${u.id}`}
                                  >
                                    <Save className="w-3.5 h-3.5 mr-1.5" />
                                    Save as Preset
                                  </Button>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {PERMISSION_GROUPS.map((group) => (
                                  <Card key={group.label} className="border">
                                    <CardHeader className="px-3 py-2.5 pb-1">
                                      <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                        {group.label}
                                      </CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-3 pb-3 pt-0 space-y-1">
                                      {group.permissions.map((perm) => {
                                        const Icon = perm.icon;
                                        const isRoleDefault = u.roleDefaults?.[perm.key] ?? false;
                                        const dbValue = !!(u as any)[perm.key];
                                        const effectiveValue = isAdmin ? true : (isRoleDefault || dbValue);
                                        const isHustler = u.role === "HUSTLER";
                                        const isHustlerBase = isHustler && HUSTLER_BASE_PERMISSIONS.has(perm.key);
                                        const isInheritedFromRole = isHustler && !isHustlerBase && isRoleDefault;
                                        const inheritedRoleName = isInheritedFromRole ? (ROLE_LABELS[u.effectiveRole || "ADMIN"] || u.effectiveRole || "Admin") : null;
                                        return (
                                          <div
                                            key={perm.key}
                                            className="flex items-center justify-between gap-3 py-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                                            style={{ minHeight: "44px" }}
                                          >
                                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                              <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                                              <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  <span className="text-sm font-medium leading-tight">{perm.label}</span>
                                                  {!isAdmin && isRoleDefault && !isInheritedFromRole && (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-300 text-blue-600 dark:border-blue-600 dark:text-blue-400 shrink-0">
                                                      Role default
                                                    </Badge>
                                                  )}
                                                  {isInheritedFromRole && (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-purple-300 text-purple-600 dark:border-purple-600 dark:text-purple-400 shrink-0" data-testid={`badge-inherited-${perm.key}-${u.id}`}>
                                                      Inherited from {inheritedRoleName}
                                                    </Badge>
                                                  )}
                                                </div>
                                                <div className="text-xs text-muted-foreground leading-tight hidden sm:block">{perm.description}</div>
                                              </div>
                                            </div>
                                            {isAdmin ? (
                                              <div className="flex items-center gap-2 shrink-0">
                                                <Switch checked={true} disabled />
                                                <span className="text-xs text-muted-foreground whitespace-nowrap">Always</span>
                                              </div>
                                            ) : (
                                              <Switch
                                                checked={effectiveValue}
                                                onCheckedChange={() => handleTogglePermission(u.id, perm.key, dbValue, u)}
                                                disabled={updatePermissionsMutation.isPending || isRoleDefault}
                                                data-testid={`switch-${perm.key}-${u.id}`}
                                              />
                                            )}
                                          </div>
                                        );
                                      })}
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <AlertDialog open={!!presetConfirm} onOpenChange={(open) => !open && setPresetConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apply Permission Preset</AlertDialogTitle>
              <AlertDialogDescription>
                This will replace all current permissions with the "{presetConfirm?.preset.name}" preset. The user's permissions will be updated immediately. You can still fine-tune individual permissions afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-apply-preset">Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-testid="button-confirm-apply-preset"
                onClick={() => {
                  if (presetConfirm) {
                    applyPresetMutation.mutate({ userId: presetConfirm.userId, presetId: presetConfirm.preset.id });
                  }
                }}
              >
                Apply Preset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!showSavePreset} onOpenChange={(open) => !open && setShowSavePreset(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Save as Preset</DialogTitle>
              <DialogDescription>
                Save the current permission configuration as a reusable preset for {showSavePreset?.role ? ROLE_LABELS[showSavePreset.role] || showSavePreset.role : ''} users in your organization.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="presetName">Preset Name *</Label>
                <Input
                  id="presetName"
                  value={savePresetName}
                  onChange={(e) => setSavePresetName(e.target.value)}
                  placeholder="e.g., Senior PM at our company"
                  data-testid="input-preset-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="presetDesc">Description</Label>
                <Input
                  id="presetDesc"
                  value={savePresetDesc}
                  onChange={(e) => setSavePresetDesc(e.target.value)}
                  placeholder="Brief description of this preset"
                  data-testid="input-preset-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSavePreset(null)} data-testid="button-cancel-save-preset">Cancel</Button>
              <Button
                onClick={() => {
                  if (showSavePreset && savePresetName.trim()) {
                    savePresetMutation.mutate({
                      name: savePresetName.trim(),
                      description: savePresetDesc.trim() || undefined,
                      targetRole: showSavePreset.role,
                      permissions: showSavePreset.permissions,
                    });
                  }
                }}
                disabled={!savePresetName.trim() || savePresetMutation.isPending}
                data-testid="button-confirm-save-preset"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Preset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deletePresetConfirm} onOpenChange={(open) => !open && setDeletePresetConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Custom Preset</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the "{deletePresetConfirm?.name}" preset? This action cannot be undone. Users who had this preset applied will keep their current permissions.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-preset">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-delete-preset"
                onClick={() => {
                  if (deletePresetConfirm) {
                    deletePresetMutation.mutate(deletePresetConfirm.id);
                  }
                }}
              >
                Delete Preset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  );

  if (embedded) {
    return <div className="space-y-6">{contentBody}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              User Management
            </h1>
            <p className="text-muted-foreground">
              Manage user accounts and permissions
            </p>
          </div>
        </div>
        {contentBody}
      </main>
    </div>
  );
}
