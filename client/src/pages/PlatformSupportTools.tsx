import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Plus, Users, Search, Mail, Building2, KeyRound, Trash2, Archive, RotateCcw, LogIn, Database, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface Organization {
  id: string;
  name: string;
  slug: string;
  tradeType: string;
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string | null;
  isActive: boolean;
}

interface SowItem {
  id: string;
  name: string;
  categoryName: string;
  code: string;
  unit: string | null;
}

interface WorkType {
  id: string;
  name: string;
  unit: string;
  defaultProductionRate: string | null;
}

interface SowLinkStats {
  metric: string;
  count: number;
}

interface BackfillResult {
  message: string;
  scopeItemsUpdated: number;
  estimateLineItemsUpdated: number;
  dailyProgressUpdated: number;
  sovLineItemsUpdated: number;
}

export default function PlatformSupportTools() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedUserOrgId, setSelectedUserOrgId] = useState<string>("");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showArchivedUsers, setShowArchivedUsers] = useState(false);

  const userName = user ? `${user.firstName} ${user.lastName}` : "Admin";
  const userRole = user?.role || "SUPER_ADMIN";

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/platform/users"],
  });

  const { data: archivedUsers, isLoading: archivedUsersLoading } = useQuery<User[]>({
    queryKey: ["/api/platform/users/archived"],
    enabled: showArchivedUsers,
  });

  const { data: sowItems, isLoading: sowLoading } = useQuery<SowItem[]>({
    queryKey: ["/api/platform/organizations", selectedOrgId, "sow-items"],
    enabled: !!selectedOrgId,
  });

  const { data: workTypes, isLoading: workTypesLoading } = useQuery<WorkType[]>({
    queryKey: ["/api/platform/organizations", selectedOrgId, "work-types"],
    enabled: !!selectedOrgId,
  });

  const [newSowItem, setNewSowItem] = useState({
    name: "",
    categoryName: "General",
    code: "",
    unit: "EACH",
  });

  const [newWorkType, setNewWorkType] = useState({
    name: "",
    unit: "SF",
  });

  const createSowItemMutation = useMutation({
    mutationFn: async (data: typeof newSowItem) => {
      return apiRequest("POST", `/api/platform/organizations/${selectedOrgId}/sow-items`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/organizations", selectedOrgId, "sow-items"] });
      setNewSowItem({ name: "", categoryName: "General", code: "", unit: "EACH" });
      toast({ title: "SOW item created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create SOW item", description: error.message, variant: "destructive" });
    },
  });

  const createWorkTypeMutation = useMutation({
    mutationFn: async (data: typeof newWorkType) => {
      return apiRequest("POST", `/api/platform/organizations/${selectedOrgId}/work-types`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/organizations", selectedOrgId, "work-types"] });
      setNewWorkType({ name: "", unit: "SF" });
      toast({ title: "Work type created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create work type", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("POST", `/api/platform/users/${userId}/reset-password`);
    },
    onSuccess: (_, userId) => {
      const user = users?.find(u => u.id === userId);
      toast({ 
        title: "Password reset email sent", 
        description: `A password reset link has been sent to ${user?.email}` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to send reset email", description: error.message, variant: "destructive" });
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("POST", `/api/platform/users/${userId}/soft-delete`);
    },
    onSuccess: (_, userId) => {
      const deletedUser = users?.find(u => u.id === userId);
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users/archived"] });
      toast({ 
        title: "User archived", 
        description: `${deletedUser?.email} has been deactivated and moved to archived users` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to archive user", description: error.message, variant: "destructive" });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("DELETE", `/api/platform/users/${userId}`);
    },
    onSuccess: (_, userId) => {
      const deletedUser = archivedUsers?.find(u => u.id === userId);
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users/archived"] });
      toast({ 
        title: "User permanently deleted", 
        description: `${deletedUser?.email} has been permanently removed from the system` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete user", description: error.message, variant: "destructive" });
    },
  });

  const restoreUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("POST", `/api/platform/users/${userId}/restore`);
    },
    onSuccess: (_, userId) => {
      const restoredUser = archivedUsers?.find(u => u.id === userId);
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users/archived"] });
      toast({ 
        title: "User account restored", 
        description: `${restoredUser?.email} has been reactivated and can now log in` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to restore user", description: error.message, variant: "destructive" });
    },
  });

  const impersonateUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("POST", `/api/platform/users/${userId}/impersonate`);
      return response.json();
    },
    onSuccess: (data, userId) => {
      const impersonatedUser = users?.find(u => u.id === userId);
      // Open a new tab with the impersonation token
      const baseUrl = window.location.origin;
      const impersonationUrl = `${baseUrl}/impersonate?token=${encodeURIComponent(data.token)}`;
      window.open(impersonationUrl, '_blank');
      toast({ 
        title: "Login session started", 
        description: `Opening ${impersonatedUser?.email}'s account in a new tab` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Failed to login as user", description: error.message, variant: "destructive" });
    },
  });

  // SOW Link Stats Query
  const { data: sowLinkStats, isLoading: sowStatsLoading, refetch: refetchSowStats } = useQuery<SowLinkStats[]>({
    queryKey: ["/api/platform/sow-link-stats"],
  });

  // SOW Backfill Mutation
  const backfillSowLinksMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/platform/backfill-sow-links");
      return response.json() as Promise<BackfillResult>;
    },
    onSuccess: (data) => {
      refetchSowStats();
      toast({ 
        title: "SOW Links Backfill Complete", 
        description: `Updated ${data.scopeItemsUpdated} scope items, ${data.estimateLineItemsUpdated} estimate line items, ${data.dailyProgressUpdated} daily progress entries, and ${data.sovLineItemsUpdated} SOV line items` 
      });
    },
    onError: (error: any) => {
      toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
    },
  });

  const filteredUsers = users?.filter((u) => {
    const matchesOrg = !selectedUserOrgId || selectedUserOrgId === "all" || u.organizationId === selectedUserOrgId;
    const matchesRole = selectedRoleFilter === "all" || u.role === selectedRoleFilter;
    const matchesSearch =
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesOrg && matchesRole && matchesSearch;
  });
  
  const selectedOrgName = selectedUserOrgId && selectedUserOrgId !== "all" 
    ? organizations?.find(o => o.id === selectedUserOrgId)?.name 
    : null;

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: "Platform Admin",
    ADMIN: "Admin",
    MANAGER: "Manager",
    SUPERINTENDENT: "Superintendent",
    ESTIMATOR: "Estimator",
    OFFICE_MANAGER: "Office Manager",
    HOURLY_EMPLOYEE: "Hourly Employee",
    MAINTENANCE_MANAGER: "Maintenance Manager",
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-support-title">Support Tools</h1>
            <p className="text-muted-foreground">Backend support tools for resolving user issues</p>
          </div>
        </div>

        <Tabs defaultValue="users" className="space-y-6">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users" onClick={() => setShowArchivedUsers(false)}>
            <Users className="h-4 w-4 mr-2" />
            All Users
          </TabsTrigger>
          <TabsTrigger value="archived" data-testid="tab-archived" onClick={() => setShowArchivedUsers(true)}>
            <Archive className="h-4 w-4 mr-2" />
            Archived Users
          </TabsTrigger>
          <TabsTrigger value="sow" data-testid="tab-sow">
            <Building2 className="h-4 w-4 mr-2" />
            SOW Items
          </TabsTrigger>
          <TabsTrigger value="worktypes" data-testid="tab-worktypes">
            <Building2 className="h-4 w-4 mr-2" />
            Work Types
          </TabsTrigger>
          <TabsTrigger value="datatools" data-testid="tab-datatools">
            <Database className="h-4 w-4 mr-2" />
            Data Tools
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Platform Users</CardTitle>
              <CardDescription>Select an organization to view and manage its users</CardDescription>
              <div className="flex flex-wrap items-end gap-4 mt-4">
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Organization</Label>
                  <Select value={selectedUserOrgId} onValueChange={setSelectedUserOrgId}>
                    <SelectTrigger className="w-[280px]" data-testid="select-org-users">
                      <SelectValue placeholder="Select an organization..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Organizations</SelectItem>
                      {organizations?.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-muted-foreground">Role</Label>
                  <Select value={selectedRoleFilter} onValueChange={setSelectedRoleFilter}>
                    <SelectTrigger className="w-[200px]" data-testid="select-role-filter">
                      <SelectValue placeholder="Filter by role..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="SUPER_ADMIN">Platform Admin</SelectItem>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="MANAGER">Manager</SelectItem>
                      <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                      <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                      <SelectItem value="OFFICE_MANAGER">Office Manager</SelectItem>
                      <SelectItem value="MAINTENANCE_MANAGER">Maintenance Manager</SelectItem>
                      <SelectItem value="HOURLY_EMPLOYEE">Hourly Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative flex-1 min-w-[200px]">
                  <Label className="text-sm text-muted-foreground">Search</Label>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name or email..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-search-users"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm text-muted-foreground border-b pb-3">
                    <span>
                      Showing <strong className="text-foreground">{filteredUsers?.length || 0}</strong> users
                      {selectedOrgName && <> from <strong className="text-foreground">{selectedOrgName}</strong></>}
                      {selectedRoleFilter !== "all" && <> with role <strong className="text-foreground">{roleLabels[selectedRoleFilter]}</strong></>}
                    </span>
                  </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Organization</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers?.map((user) => (
                      <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                        <TableCell className="font-medium">
                          {user.firstName} {user.lastName}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            {user.email}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === "SUPER_ADMIN" ? "default" : "secondary"}>
                            {roleLabels[user.role] || user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {organizations?.find((o) => o.id === user.organizationId)?.name || "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.isActive ? "default" : "destructive"}>
                            {user.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  disabled={resetPasswordMutation.isPending}
                                  data-testid={`button-reset-password-${user.id}`}
                                >
                                  <KeyRound className="h-4 w-4 mr-1" />
                                  Reset Password
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Reset Password</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will send a password reset email to <strong>{user.email}</strong>. 
                                    The user will receive a link to set a new password.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => resetPasswordMutation.mutate(user.id)}
                                    data-testid={`button-confirm-reset-${user.id}`}
                                  >
                                    Send Reset Email
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            {user.role !== "SUPER_ADMIN" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    disabled={impersonateUserMutation.isPending}
                                    onClick={() => impersonateUserMutation.mutate(user.id)}
                                    data-testid={`button-login-as-${user.id}`}
                                  >
                                    <LogIn className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Login as this user</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {user.role !== "SUPER_ADMIN" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    disabled={softDeleteMutation.isPending}
                                    data-testid={`button-delete-user-${user.id}`}
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Archive User Account</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to archive this user account?
                                      <br /><br />
                                      <strong>{user.firstName} {user.lastName}</strong> ({user.email}) will be:
                                      <ul className="list-disc list-inside mt-2 space-y-1">
                                        <li>Deactivated and unable to log in</li>
                                        <li>Moved to Archived Users</li>
                                        <li>Available for permanent deletion later</li>
                                      </ul>
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => softDeleteMutation.mutate(user.id)}
                                      data-testid={`button-confirm-delete-${user.id}`}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Yes, Archive User
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredUsers?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No users found matching your filters
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="archived" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Archived Users</CardTitle>
              <CardDescription>Users who have been deactivated and can be permanently deleted</CardDescription>
            </CardHeader>
            <CardContent>
              {archivedUsersLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm text-muted-foreground border-b pb-3">
                    <span>
                      Showing <strong className="text-foreground">{archivedUsers?.length || 0}</strong> archived users
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {archivedUsers?.map((archivedUser) => (
                        <TableRow key={archivedUser.id} data-testid={`row-archived-user-${archivedUser.id}`}>
                          <TableCell className="font-medium">
                            {archivedUser.firstName} {archivedUser.lastName}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              {archivedUser.email}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {roleLabels[archivedUser.role] || archivedUser.role}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {organizations?.find((o) => o.id === archivedUser.organizationId)?.name || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive">Archived</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    disabled={restoreUserMutation.isPending}
                                    data-testid={`button-restore-user-${archivedUser.id}`}
                                  >
                                    <RotateCcw className="h-4 w-4 mr-1" />
                                    Restore Account
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Restore User Account</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to restore this user account?
                                      <br /><br />
                                      <strong>{archivedUser.firstName} {archivedUser.lastName}</strong> ({archivedUser.email}) will be:
                                      <ul className="list-disc list-inside mt-2 space-y-1">
                                        <li>Reactivated and able to log in again</li>
                                        <li>Moved back to All Users</li>
                                        <li>Status updated to Active</li>
                                      </ul>
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => restoreUserMutation.mutate(archivedUser.id)}
                                      data-testid={`button-confirm-restore-${archivedUser.id}`}
                                    >
                                      Yes, Restore Account
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    disabled={permanentDeleteMutation.isPending}
                                    data-testid={`button-permanent-delete-${archivedUser.id}`}
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Permanently Delete User</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      <span className="text-destructive font-semibold">Warning: This action cannot be undone!</span>
                                      <br /><br />
                                      You are about to permanently delete the account for:
                                      <br />
                                      <strong>{archivedUser.firstName} {archivedUser.lastName}</strong> ({archivedUser.email})
                                      <br /><br />
                                      All data associated with this user will be permanently removed from the database.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => permanentDeleteMutation.mutate(archivedUser.id)}
                                      data-testid={`button-confirm-permanent-delete-${archivedUser.id}`}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Yes, Permanently Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!archivedUsers || archivedUsers.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No archived users found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sow" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization SOW Items</CardTitle>
              <CardDescription>Add scope of work items for organizations</CardDescription>
              <div className="mt-4">
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger className="w-[300px]" data-testid="select-org-sow">
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {selectedOrgId ? (
                <div className="space-y-6">
                  <div className="border rounded-lg p-4 space-y-4">
                    <h3 className="font-medium">Add New SOW Item</h3>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                          value={newSowItem.name}
                          onChange={(e) => setNewSowItem({ ...newSowItem, name: e.target.value })}
                          placeholder="Item name"
                          data-testid="input-sow-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Input
                          value={newSowItem.categoryName}
                          onChange={(e) => setNewSowItem({ ...newSowItem, categoryName: e.target.value })}
                          placeholder="Category"
                          data-testid="input-sow-category"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Code</Label>
                        <Input
                          value={newSowItem.code}
                          onChange={(e) => setNewSowItem({ ...newSowItem, code: e.target.value })}
                          placeholder="Item code"
                          data-testid="input-sow-code"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit</Label>
                        <Input
                          value={newSowItem.unit}
                          onChange={(e) => setNewSowItem({ ...newSowItem, unit: e.target.value })}
                          placeholder="Unit"
                          data-testid="input-sow-unit"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={() => createSowItemMutation.mutate(newSowItem)}
                      disabled={!newSowItem.name || !newSowItem.code || createSowItemMutation.isPending}
                      data-testid="button-add-sow"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add SOW Item
                    </Button>
                  </div>

                  {sowLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Unit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sowItems?.map((item) => (
                          <TableRow key={item.id} data-testid={`row-sow-${item.id}`}>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>{item.categoryName}</TableCell>
                            <TableCell className="font-mono">{item.code}</TableCell>
                            <TableCell>{item.unit || "-"}</TableCell>
                          </TableRow>
                        ))}
                        {sowItems?.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              No SOW items for this organization
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">Select an organization to manage SOW items</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="worktypes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization Work Types</CardTitle>
              <CardDescription>Add work types for organizations</CardDescription>
              <div className="mt-4">
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger className="w-[300px]" data-testid="select-org-worktypes">
                    <SelectValue placeholder="Select an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {selectedOrgId ? (
                <div className="space-y-6">
                  <div className="border rounded-lg p-4 space-y-4">
                    <h3 className="font-medium">Add New Work Type</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                          value={newWorkType.name}
                          onChange={(e) => setNewWorkType({ ...newWorkType, name: e.target.value })}
                          placeholder="Work type name"
                          data-testid="input-worktype-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit</Label>
                        <Input
                          value={newWorkType.unit}
                          onChange={(e) => setNewWorkType({ ...newWorkType, unit: e.target.value })}
                          placeholder="Unit (e.g., SF, LF)"
                          data-testid="input-worktype-unit"
                        />
                      </div>
                    </div>
                    <Button
                      onClick={() => createWorkTypeMutation.mutate(newWorkType)}
                      disabled={!newWorkType.name || createWorkTypeMutation.isPending}
                      data-testid="button-add-worktype"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Work Type
                    </Button>
                  </div>

                  {workTypesLoading ? (
                    <Skeleton className="h-40 w-full" />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Production Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workTypes?.map((type) => (
                          <TableRow key={type.id} data-testid={`row-worktype-${type.id}`}>
                            <TableCell className="font-medium">{type.name}</TableCell>
                            <TableCell>{type.unit}</TableCell>
                            <TableCell>{type.defaultProductionRate || "-"}</TableCell>
                          </TableRow>
                        ))}
                        {workTypes?.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                              No work types for this organization
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">Select an organization to manage work types</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="datatools" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                SOW Link Backfill Tool
              </CardTitle>
              <CardDescription>
                Link existing scope items and estimate line items to their master SOW items for production rate tracking across projects
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {sowStatsLoading ? (
                  <>
                    <Skeleton className="h-24" />
                    <Skeleton className="h-24" />
                    <Skeleton className="h-24" />
                    <Skeleton className="h-24" />
                  </>
                ) : (
                  <>
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        {(sowLinkStats?.find(s => s.metric === "scope_items_without_sow")?.count || 0) > 0 ? (
                          <AlertCircle className="h-5 w-5 text-amber-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        <span className="text-sm font-medium">Scope Items</span>
                      </div>
                      <div className="text-2xl font-bold">
                        {sowLinkStats?.find(s => s.metric === "scope_items_without_sow")?.count || 0}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        of {sowLinkStats?.find(s => s.metric === "total_scope_items")?.count || 0} unlinked
                      </div>
                    </Card>
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        {(sowLinkStats?.find(s => s.metric === "estimate_line_items_without_sow")?.count || 0) > 0 ? (
                          <AlertCircle className="h-5 w-5 text-amber-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        <span className="text-sm font-medium">Estimate Line Items</span>
                      </div>
                      <div className="text-2xl font-bold">
                        {sowLinkStats?.find(s => s.metric === "estimate_line_items_without_sow")?.count || 0}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        of {sowLinkStats?.find(s => s.metric === "total_estimate_line_items")?.count || 0} unlinked
                      </div>
                    </Card>
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        {(sowLinkStats?.find(s => s.metric === "daily_progress_without_sow")?.count || 0) > 0 ? (
                          <AlertCircle className="h-5 w-5 text-amber-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        <span className="text-sm font-medium">Daily Progress</span>
                      </div>
                      <div className="text-2xl font-bold">
                        {sowLinkStats?.find(s => s.metric === "daily_progress_without_sow")?.count || 0}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        of {sowLinkStats?.find(s => s.metric === "total_daily_progress")?.count || 0} unlinked
                      </div>
                    </Card>
                    <Card className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        {(sowLinkStats?.find(s => s.metric === "sov_line_items_without_sow")?.count || 0) > 0 ? (
                          <AlertCircle className="h-5 w-5 text-amber-500" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        <span className="text-sm font-medium">SOV Line Items</span>
                      </div>
                      <div className="text-2xl font-bold">
                        {sowLinkStats?.find(s => s.metric === "sov_line_items_without_sow")?.count || 0}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        of {sowLinkStats?.find(s => s.metric === "total_sov_line_items")?.count || 0} unlinked
                      </div>
                    </Card>
                  </>
                )}
              </div>

              <div className="flex items-center gap-4">
                <Button
                  onClick={() => backfillSowLinksMutation.mutate()}
                  disabled={backfillSowLinksMutation.isPending}
                  data-testid="button-backfill-sow"
                >
                  {backfillSowLinksMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Running Backfill...
                    </>
                  ) : (
                    <>
                      <Database className="h-4 w-4 mr-2" />
                      Run SOW Link Backfill
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => refetchSowStats()}
                  data-testid="button-refresh-stats"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Stats
                </Button>
              </div>

              <div className="text-sm text-muted-foreground p-4 bg-muted rounded-lg">
                <p className="font-medium mb-2">What this tool does:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Matches existing scope items, estimate line items, and SOV line items to your organization's master SOW library by description</li>
                  <li>Updates daily progress entries to inherit the SOW link from their parent scope items</li>
                  <li>Enables production rate tracking, billing analytics, and cross-project analytics for historical data</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
