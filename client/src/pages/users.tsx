import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Search, Filter, X, Layout, Palette, Settings, Info } from "lucide-react";
import type { SelectUser } from "@shared/schema";

interface UserWithPermissions extends SelectUser {
  canCustomizeDashboard?: boolean;
  canCustomizeColorScheme?: boolean;
  grantedAt?: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Project Manager",
  SUPERINTENDENT: "Field Superintendent",
  ESTIMATOR: "Estimator",
  OFFICE_MANAGER: "Office Manager",
  HOURLY_EMPLOYEE: "Hourly Employee",
  MAINTENANCE_MANAGER: "Maintenance Manager",
  HUSTLER: "Hustler",
  VENDOR: "Vendor",
  SALES: "Sales",
  MARKETING: "Marketing",
  SAFETY_MANAGER: "Safety Manager",
  HR_MANAGER: "HR Manager",
  EQUIPMENT_MANAGER: "Equipment Manager",
  PROJECT_ENGINEER: "Project Engineer",
  PROCUREMENT_MANAGER: "Procurement Manager",
  DISPATCHER: "Dispatcher",
};

const ROLE_COLORS: Record<string, "default" | "secondary" | "destructive"> = {
  ADMIN: "destructive",
  MANAGER: "default",
  SUPERINTENDENT: "default",
  ESTIMATOR: "default",
  OFFICE_MANAGER: "default",
  HOURLY_EMPLOYEE: "secondary",
  MAINTENANCE_MANAGER: "default",
  HUSTLER: "destructive",
  VENDOR: "secondary",
  SALES: "default",
  MARKETING: "default",
  SAFETY_MANAGER: "default",
  HR_MANAGER: "default",
  EQUIPMENT_MANAGER: "default",
  PROJECT_ENGINEER: "default",
  PROCUREMENT_MANAGER: "default",
  DISPATCHER: "default",
};

// Status filter options
const STATUS_FILTERS = [
  { value: "ALL", label: "All Status" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

export default function UsersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  
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
    role: "HOURLY_EMPLOYEE",
    password: "",
  });

  const { data: users = [], isLoading } = useQuery<SelectUser[]>({
    queryKey: ["/api/users"],
  });
  
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
        role: "HOURLY_EMPLOYEE",
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
    if (!inviteForm.firstName || !inviteForm.lastName || !inviteForm.email || !inviteForm.password) {
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
  const { data: usersWithPermissions = [], isLoading: permissionsLoading } = useQuery<UserWithPermissions[]>({
    queryKey: ["/api/dashboard/permissions"],
    enabled: user?.role === "ADMIN" || user?.role === "SUPER_ADMIN",
  });
  
  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
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
    mutationFn: async ({ userId, data }: { userId: string; data: Partial<SelectUser> }) => {
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
  
  // Mutation for updating dashboard permissions
  const updatePermissionsMutation = useMutation({
    mutationFn: async ({ userId, canCustomizeDashboard, canCustomizeColorScheme }: { 
      userId: string; 
      canCustomizeDashboard: boolean;
      canCustomizeColorScheme: boolean;
    }) => {
      return await apiRequest("PUT", `/api/dashboard/permissions/${userId}`, {
        canCustomizeDashboard,
        canCustomizeColorScheme,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/permissions"] });
      toast({
        title: "Success",
        description: "User permissions updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update permissions",
        variant: "destructive",
      });
    },
  });

  const handleToggleDashboardPermission = async (userId: string, currentValue: boolean, userPerms: UserWithPermissions) => {
    await updatePermissionsMutation.mutateAsync({
      userId,
      canCustomizeDashboard: !currentValue,
      canCustomizeColorScheme: userPerms.canCustomizeColorScheme || false,
    });
  };

  const handleToggleColorSchemePermission = async (userId: string, currentValue: boolean, userPerms: UserWithPermissions) => {
    await updatePermissionsMutation.mutateAsync({
      userId,
      canCustomizeDashboard: userPerms.canCustomizeDashboard || false,
      canCustomizeColorScheme: !currentValue,
    });
  };

  if (!user) {
    return null;
  }

  // Only admins can access this page
  if (user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-2xl font-bold">Access Denied</h2>
              <p className="text-muted-foreground">Only administrators can access this page.</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">User Management</h1>
            <p className="text-muted-foreground">Manage user accounts and permissions</p>
          </div>
          <Button data-testid="button-invite-user" onClick={() => setShowInviteDialog(true)}>
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
                    onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    data-testid="input-invite-last-name"
                    value={inviteForm.lastName}
                    onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })}
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
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
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
                  onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={inviteForm.role}
                  onValueChange={(value) => setInviteForm({ ...inviteForm, role: value })}
                >
                  <SelectTrigger data-testid="select-invite-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value} data-testid={`option-role-${value.toLowerCase()}`}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Temporary Password *</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid="input-invite-password"
                  value={inviteForm.password}
                  onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList data-testid="tabs-user-management">
            <TabsTrigger value="users" data-testid="tab-users">
              <Settings className="w-4 h-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="customization" data-testid="tab-customization">
              <Layout className="w-4 h-4 mr-2" />
              Customization Permissions
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
                    <SelectTrigger className="w-[160px]" data-testid="select-role-filter">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Roles</SelectItem>
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_FILTERS.map(option => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              {(searchTerm || roleFilter !== "ALL" || statusFilter !== "ALL") && (
                <div className="px-6 pb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Active filters:</span>
                  {searchTerm && (
                    <Badge variant="secondary" className="gap-1">
                      Search: "{searchTerm}"
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setSearchTerm("")} data-testid="button-clear-search" />
                    </Badge>
                  )}
                  {roleFilter !== "ALL" && (
                    <Badge variant="secondary" className="gap-1">
                      {ROLE_LABELS[roleFilter]}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setRoleFilter("ALL")} data-testid="button-clear-role-filter" />
                    </Badge>
                  )}
                  {statusFilter !== "ALL" && (
                    <Badge variant="secondary" className="gap-1">
                      {statusFilter === "ACTIVE" ? "Active" : "Inactive"}
                      <X className="w-3 h-3 cursor-pointer" onClick={() => setStatusFilter("ALL")} data-testid="button-clear-status-filter" />
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { setSearchTerm(""); setRoleFilter("ALL"); setStatusFilter("ALL"); }} data-testid="button-clear-all-filters">
                    Clear all
                  </Button>
                </div>
              )}
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8" data-testid="text-loading">Loading users...</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {searchTerm || roleFilter !== "ALL" || statusFilter !== "ALL" ? "No users match your filters" : "No users found"}
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <Table className="min-w-[700px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">Name</TableHead>
                          <TableHead className="whitespace-nowrap">Email</TableHead>
                          <TableHead className="whitespace-nowrap">Phone</TableHead>
                          <TableHead className="whitespace-nowrap">Role</TableHead>
                          <TableHead className="whitespace-nowrap">Status</TableHead>
                          <TableHead className="whitespace-nowrap">Active</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.map((u) => (
                          <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                            <TableCell className="font-medium" data-testid={`text-name-${u.id}`}>{u.firstName} {u.lastName}</TableCell>
                            <TableCell data-testid={`text-email-${u.id}`}>{u.email}</TableCell>
                            <TableCell className="text-muted-foreground" data-testid={`text-phone-${u.id}`}>{u.phone || "—"}</TableCell>
                            <TableCell>
                              <Select value={u.role} onValueChange={(newRole) => handleRoleChange(u.id, newRole)} disabled={updateUserMutation.isPending}>
                                <SelectTrigger className="w-[180px]" data-testid={`select-role-${u.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Badge variant={u.isActive ? "default" : "secondary"} data-testid={`badge-status-${u.id}`}>
                                {u.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Switch checked={u.isActive} onCheckedChange={() => handleToggleActive(u.id, u.isActive)} disabled={updateUserMutation.isPending} data-testid={`switch-active-${u.id}`} />
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
                  <CardTitle>Dashboard Customization Permissions</CardTitle>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Control which users can customize their dashboard layout and color scheme. Admins always have full customization access.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <CardDescription>
                  Grant or revoke dashboard and color scheme customization permissions for team members
                </CardDescription>
              </CardHeader>
              <CardContent>
                {permissionsLoading ? (
                  <div className="text-center py-8" data-testid="text-permissions-loading">Loading permissions...</div>
                ) : usersWithPermissions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No users found</div>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <Table className="min-w-[600px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="whitespace-nowrap">User</TableHead>
                          <TableHead className="whitespace-nowrap">Role</TableHead>
                          <TableHead className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Layout className="w-4 h-4" />
                              Dashboard Layout
                            </div>
                          </TableHead>
                          <TableHead className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Palette className="w-4 h-4" />
                              Color Scheme
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usersWithPermissions.map((u) => {
                          const isAdmin = u.role === "ADMIN" || u.role === "SUPER_ADMIN";
                          return (
                            <TableRow key={u.id} data-testid={`row-permission-${u.id}`}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium" data-testid={`text-perm-name-${u.id}`}>
                                    {u.firstName} {u.lastName}
                                  </span>
                                  <span className="text-sm text-muted-foreground" data-testid={`text-perm-email-${u.id}`}>
                                    {u.email}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={ROLE_COLORS[u.role] || "secondary"}>
                                  {ROLE_LABELS[u.role] || u.role}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {isAdmin ? (
                                  <div className="flex items-center gap-2">
                                    <Switch checked={true} disabled />
                                    <span className="text-xs text-muted-foreground">Always enabled</span>
                                  </div>
                                ) : (
                                  <Switch
                                    checked={u.canCustomizeDashboard || false}
                                    onCheckedChange={() => handleToggleDashboardPermission(u.id, u.canCustomizeDashboard || false, u)}
                                    disabled={updatePermissionsMutation.isPending}
                                    data-testid={`switch-dashboard-${u.id}`}
                                  />
                                )}
                              </TableCell>
                              <TableCell>
                                {isAdmin ? (
                                  <div className="flex items-center gap-2">
                                    <Switch checked={true} disabled />
                                    <span className="text-xs text-muted-foreground">Always enabled</span>
                                  </div>
                                ) : (
                                  <Switch
                                    checked={u.canCustomizeColorScheme || false}
                                    onCheckedChange={() => handleToggleColorSchemePermission(u.id, u.canCustomizeColorScheme || false, u)}
                                    disabled={updatePermissionsMutation.isPending}
                                    data-testid={`switch-colorscheme-${u.id}`}
                                  />
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
