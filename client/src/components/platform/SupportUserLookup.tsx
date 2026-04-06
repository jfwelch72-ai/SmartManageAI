import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Mail, Building2, KeyRound, Trash2, LogIn, ShieldCheck, ShieldX, UserPlus, ArrowRightLeft, UserCog } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  emailVerified: boolean;
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "Platform Admin",
  ADMIN: "Admin",
  HUSTLER: "Hustler",
  MANAGER: "Manager",
  SUPERINTENDENT: "Superintendent",
  ESTIMATOR: "Estimator",
  FIELD_WORKER: "Field Worker",
  VENDOR: "Vendor",
};

export function SupportUserLookup() {
  const { toast } = useToast();
  const [selectedUserOrgId, setSelectedUserOrgId] = useState<string>("");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [roleChangeUser, setRoleChangeUser] = useState<User | null>(null);
  const [newRole, setNewRole] = useState("");
  const [transferUser, setTransferUser] = useState<User | null>(null);
  const [targetOrgId, setTargetOrgId] = useState("");
  const [newUserForm, setNewUserForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    organizationId: "",
    role: "FIELD_WORKER",
  });

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/platform/users"],
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: typeof newUserForm) => {
      return apiRequest("POST", "/api/platform/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      setCreateDialogOpen(false);
      setNewUserForm({ firstName: "", lastName: "", email: "", password: "", organizationId: "", role: "FIELD_WORKER" });
      toast({ title: "User created", description: "The new user account has been created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create user", description: error.message, variant: "destructive" });
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

  const toggleEmailVerifiedMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest("PATCH", `/api/platform/users/${userId}/verify-email`);
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      toast({ title: data.message || "Email verification status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update verification status", description: error.message, variant: "destructive" });
    },
  });

  const impersonateUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("POST", `/api/platform/users/${userId}/impersonate`);
      return response.json();
    },
    onSuccess: (data, userId) => {
      const impersonatedUser = users?.find(u => u.id === userId);
      const baseUrl = window.location.origin;
      const impersonationUrl = `${baseUrl}/impersonate?code=${encodeURIComponent(data.code)}`;
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

  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/platform/users/${userId}/role`, { role });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      setRoleChangeUser(null);
      setNewRole("");
      toast({ title: "Role updated", description: data.message });
    },
    onError: (error: any) => {
      toast({ title: "Failed to change role", description: error.message, variant: "destructive" });
    },
  });

  const transferUserMutation = useMutation({
    mutationFn: async ({ userId, targetOrganizationId }: { userId: string; targetOrganizationId: string }) => {
      const res = await apiRequest("POST", `/api/platform/users/${userId}/transfer`, { targetOrganizationId });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/organizations"] });
      setTransferUser(null);
      setTargetOrgId("");
      toast({ title: "User transferred", description: data.message });
    },
    onError: (error: any) => {
      toast({ title: "Failed to transfer user", description: error.message, variant: "destructive" });
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>Platform Users</CardTitle>
            <CardDescription>Select an organization to view and manage its users</CardDescription>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-user">
                <UserPlus className="h-4 w-4 mr-2" />
                Create User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>Create a user account for any organization</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input
                      value={newUserForm.firstName}
                      onChange={(e) => setNewUserForm(f => ({ ...f, firstName: e.target.value }))}
                      placeholder="First name"
                      data-testid="input-create-first-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input
                      value={newUserForm.lastName}
                      onChange={(e) => setNewUserForm(f => ({ ...f, lastName: e.target.value }))}
                      placeholder="Last name"
                      data-testid="input-create-last-name"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={newUserForm.email}
                    onChange={(e) => setNewUserForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="user@example.com"
                    data-testid="input-create-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={newUserForm.password}
                    onChange={(e) => setNewUserForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Minimum 8 characters"
                    data-testid="input-create-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Organization</Label>
                  <Select
                    value={newUserForm.organizationId}
                    onValueChange={(val) => setNewUserForm(f => ({ ...f, organizationId: val }))}
                  >
                    <SelectTrigger data-testid="select-create-organization">
                      <SelectValue placeholder="Select an organization..." />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations?.map((org) => (
                        <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={newUserForm.role}
                    onValueChange={(val) => setNewUserForm(f => ({ ...f, role: val }))}
                  >
                    <SelectTrigger data-testid="select-create-role">
                      <SelectValue placeholder="Select a role..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="MANAGER">Manager</SelectItem>
                      <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                      <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                      <SelectItem value="FIELD_WORKER">Field Worker</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                  data-testid="button-cancel-create-user"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => createUserMutation.mutate(newUserForm)}
                  disabled={createUserMutation.isPending || !newUserForm.firstName || !newUserForm.lastName || !newUserForm.email || !newUserForm.password || !newUserForm.organizationId}
                  data-testid="button-submit-create-user"
                >
                  {createUserMutation.isPending ? "Creating..." : "Create User"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
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
                <SelectItem value="HUSTLER">Hustler</SelectItem>
                <SelectItem value="MANAGER">Manager</SelectItem>
                <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                <SelectItem value="FIELD_WORKER">Field Worker</SelectItem>
                <SelectItem value="VENDOR">Vendor</SelectItem>
                <SelectItem value="HUSTLER">Hustler</SelectItem>
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
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Email Verified</TableHead>
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
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={user.emailVerified ? "default" : "outline"}
                        className={user.emailVerified ? "bg-green-600" : "text-amber-600 border-amber-400"}
                        data-testid={`badge-email-verified-${user.id}`}
                      >
                        {user.emailVerified ? (
                          <><ShieldCheck className="h-3 w-3 mr-1" />Verified</>
                        ) : (
                          <><ShieldX className="h-3 w-3 mr-1" />Unverified</>
                        )}
                      </Badge>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={toggleEmailVerifiedMutation.isPending}
                            onClick={() => toggleEmailVerifiedMutation.mutate(user.id)}
                            data-testid={`button-toggle-verified-${user.id}`}
                          >
                            {user.emailVerified ? <ShieldX className="h-4 w-4 text-muted-foreground" /> : <ShieldCheck className="h-4 w-4 text-green-600" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{user.emailVerified ? "Mark as unverified" : "Mark as verified"}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
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
                              onClick={() => { setRoleChangeUser(user); setNewRole(user.role); }}
                              data-testid={`button-change-role-${user.id}`}
                            >
                              <UserCog className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Change role</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {user.role !== "SUPER_ADMIN" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setTransferUser(user); setTargetOrgId(""); }}
                              data-testid={`button-transfer-user-${user.id}`}
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Transfer to another org</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
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
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No users found matching your filters
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </div>

          <div className="md:hidden space-y-3">
            {filteredUsers?.map((user) => (
              <div key={user.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-user-${user.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm truncate" data-testid={`text-name-${user.id}`}>{user.firstName} {user.lastName}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge
                      variant={user.emailVerified ? "default" : "outline"}
                      className={user.emailVerified ? "bg-green-600" : "text-amber-600 border-amber-400"}
                      data-testid={`badge-email-verified-mobile-${user.id}`}
                    >
                      {user.emailVerified ? (
                        <><ShieldCheck className="h-3 w-3 mr-1" />Verified</>
                      ) : (
                        <><ShieldX className="h-3 w-3 mr-1" />Unverified</>
                      )}
                    </Badge>
                    <Badge variant={user.isActive ? "default" : "destructive"} data-testid={`status-active-${user.id}`}>
                      {user.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground truncate" data-testid={`text-email-${user.id}`}>
                  {user.email}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant={user.role === "SUPER_ADMIN" ? "default" : "secondary"} data-testid={`badge-role-${user.id}`}>
                    {roleLabels[user.role] || user.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 truncate" data-testid={`text-org-${user.id}`}>
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">{organizations?.find((o) => o.id === user.organizationId)?.name || "-"}</span>
                  </span>
                </div>
                <div className="flex items-center flex-wrap gap-1 pt-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggleEmailVerifiedMutation.isPending}
                    onClick={() => toggleEmailVerifiedMutation.mutate(user.id)}
                    data-testid={`button-toggle-verified-mobile-${user.id}`}
                  >
                    {user.emailVerified ? <><ShieldX className="h-3 w-3 mr-1" />Unverify</> : <><ShieldCheck className="h-3 w-3 mr-1" />Verify</>}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={resetPasswordMutation.isPending}
                        data-testid={`button-reset-password-mobile-${user.id}`}
                      >
                        <KeyRound className="h-3 w-3 mr-1" />
                        Reset PW
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
                        <AlertDialogAction onClick={() => resetPasswordMutation.mutate(user.id)}>
                          Send Reset Email
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  {user.role !== "SUPER_ADMIN" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setRoleChangeUser(user); setNewRole(user.role); }}
                      data-testid={`button-change-role-mobile-${user.id}`}
                    >
                      <UserCog className="h-3 w-3 mr-1" />
                      Role
                    </Button>
                  )}
                  {user.role !== "SUPER_ADMIN" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setTransferUser(user); setTargetOrgId(""); }}
                      data-testid={`button-transfer-mobile-${user.id}`}
                    >
                      <ArrowRightLeft className="h-3 w-3 mr-1" />
                      Transfer
                    </Button>
                  )}
                  {user.role !== "SUPER_ADMIN" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={impersonateUserMutation.isPending}
                      onClick={() => impersonateUserMutation.mutate(user.id)}
                      data-testid={`button-login-as-mobile-${user.id}`}
                    >
                      <LogIn className="h-3 w-3 mr-1" />
                      Login As
                    </Button>
                  )}
                  {user.role !== "SUPER_ADMIN" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive ml-auto"
                          disabled={softDeleteMutation.isPending}
                          data-testid={`button-delete-user-mobile-${user.id}`}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Archive
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
                            className="bg-destructive text-destructive-foreground"
                          >
                            Yes, Archive User
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            ))}
            {filteredUsers?.length === 0 && (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-users-mobile">
                No users found matching your filters
              </div>
            )}
          </div>
          </div>
        )}
      </CardContent>

      <Dialog open={!!roleChangeUser} onOpenChange={(v) => { if (!v) { setRoleChangeUser(null); setNewRole(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change User Role</DialogTitle>
            <DialogDescription>
              Change the role for <strong>{roleChangeUser?.firstName} {roleChangeUser?.lastName}</strong> ({roleChangeUser?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Current Role</Label>
              <Badge variant="secondary">{roleLabels[roleChangeUser?.role || ""] || roleChangeUser?.role}</Badge>
            </div>
            <div className="space-y-2">
              <Label>New Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue placeholder="Select a role..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="HUSTLER">Hustler</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="SUPERINTENDENT">Superintendent</SelectItem>
                  <SelectItem value="ESTIMATOR">Estimator</SelectItem>
                  <SelectItem value="FIELD_WORKER">Field Worker</SelectItem>
                  <SelectItem value="VENDOR">Vendor</SelectItem>
                  <SelectItem value="HUSTLER">Hustler</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRoleChangeUser(null); setNewRole(""); }} data-testid="button-cancel-role-change">
              Cancel
            </Button>
            <Button
              onClick={() => roleChangeUser && changeRoleMutation.mutate({ userId: roleChangeUser.id, role: newRole })}
              disabled={!newRole || newRole === roleChangeUser?.role || changeRoleMutation.isPending}
              data-testid="button-confirm-role-change"
            >
              {changeRoleMutation.isPending ? "Updating..." : "Change Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!transferUser} onOpenChange={(v) => { if (!v) { setTransferUser(null); setTargetOrgId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer User to Organization</DialogTitle>
            <DialogDescription>
              Transfer <strong>{transferUser?.firstName} {transferUser?.lastName}</strong> ({transferUser?.email}) to a different organization.
              {transferUser?.role === "ADMIN" && (
                <span className="block mt-1 text-amber-600">
                  This user is an Admin. They cannot be transferred if they are the last admin in their current organization.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Current Organization</Label>
              <p className="text-sm font-medium">
                {organizations?.find(o => o.id === transferUser?.organizationId)?.name || "None"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Transfer To</Label>
              <Select value={targetOrgId} onValueChange={setTargetOrgId}>
                <SelectTrigger data-testid="select-transfer-org">
                  <SelectValue placeholder="Select target organization..." />
                </SelectTrigger>
                <SelectContent>
                  {organizations
                    ?.filter(org => org.id !== transferUser?.organizationId)
                    .map((org) => (
                      <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTransferUser(null); setTargetOrgId(""); }} data-testid="button-cancel-transfer">
              Cancel
            </Button>
            <Button
              onClick={() => transferUser && transferUserMutation.mutate({ userId: transferUser.id, targetOrganizationId: targetOrgId })}
              disabled={!targetOrgId || transferUserMutation.isPending}
              data-testid="button-confirm-transfer"
            >
              {transferUserMutation.isPending ? "Transferring..." : "Transfer User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
