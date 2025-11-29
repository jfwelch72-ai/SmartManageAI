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
import { ChevronLeft, Plus, Users, Search, Mail, Building2, KeyRound } from "lucide-react";
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
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import AppHeader from "@/components/AppHeader";
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

export default function PlatformSupportTools() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  const userName = user ? `${user.firstName} ${user.lastName}` : "Admin";
  const userRole = user?.role || "SUPER_ADMIN";

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const { data: users, isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ["/api/platform/users"],
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

  const filteredUsers = users?.filter((user) => {
    const matchesSearch =
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      `${user.firstName} ${user.lastName}`.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

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
      <AppHeader userName={userName} userRole={userRole} onLogout={logout} />
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
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="h-4 w-4 mr-2" />
            All Users
          </TabsTrigger>
          <TabsTrigger value="sow" data-testid="tab-sow">
            <Building2 className="h-4 w-4 mr-2" />
            SOW Items
          </TabsTrigger>
          <TabsTrigger value="worktypes" data-testid="tab-worktypes">
            <Building2 className="h-4 w-4 mr-2" />
            Work Types
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Platform Users</CardTitle>
              <CardDescription>View all users across all organizations</CardDescription>
              <div className="relative max-w-sm mt-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-users"
                />
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
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredUsers?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No users found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
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
        </Tabs>
      </main>
    </div>
  );
}
