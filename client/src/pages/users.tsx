import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Search, Filter, X } from "lucide-react";
import type { SelectUser } from "@shared/schema";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Project Manager",
  SUPERINTENDENT: "Field Superintendent",
  ESTIMATOR: "Estimator",
  OFFICE_MANAGER: "Office Manager",
  HOURLY_EMPLOYEE: "Hourly Employee",
};

const ROLE_COLORS: Record<string, "default" | "secondary" | "destructive"> = {
  ADMIN: "destructive",
  MANAGER: "default",
  SUPERINTENDENT: "default",
  ESTIMATOR: "default",
  OFFICE_MANAGER: "default",
  HOURLY_EMPLOYEE: "secondary",
};

// Status filter options
const STATUS_FILTERS = [
  { value: "ALL", label: "All Status" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

export default function UsersPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  
  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { data: users = [], isLoading } = useQuery<SelectUser[]>({
    queryKey: ["/api/users"],
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

  if (!user) {
    return null;
  }

  // Only admins can access this page
  if (user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user.firstName} ${user.lastName}`}
          userRole={user.role}
          onLogout={logout}
          organizationName={organizationName || undefined}
        />
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
      <AppHeader
        userName={`${user.firstName} ${user.lastName}`}
        userRole={user.role}
        onLogout={logout}
        organizationName={organizationName || undefined}
      />
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">User Management</h1>
            <p className="text-muted-foreground">Manage user accounts and permissions</p>
          </div>
          <Button data-testid="button-invite-user">
            <UserPlus className="w-4 h-4 mr-2" />
            Invite User
          </Button>
        </div>

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
          
          {/* Active filter badges */}
          {(searchTerm || roleFilter !== "ALL" || statusFilter !== "ALL") && (
            <div className="px-6 pb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Active filters:</span>
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
              <div className="text-center py-8" data-testid="text-loading">Loading users...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm || roleFilter !== "ALL" || statusFilter !== "ALL" 
                  ? "No users match your filters" 
                  : "No users found"}
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
                      <TableCell className="font-medium" data-testid={`text-name-${u.id}`}>
                        {u.firstName} {u.lastName}
                      </TableCell>
                      <TableCell data-testid={`text-email-${u.id}`}>{u.email}</TableCell>
                      <TableCell className="text-muted-foreground" data-testid={`text-phone-${u.id}`}>
                        {u.phone || "—"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          onValueChange={(newRole) => handleRoleChange(u.id, newRole)}
                          disabled={updateUserMutation.isPending}
                        >
                          <SelectTrigger className="w-[180px]" data-testid={`select-role-${u.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ROLE_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
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
                          onCheckedChange={() => handleToggleActive(u.id, u.isActive)}
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
      </main>
    </div>
  );
}
