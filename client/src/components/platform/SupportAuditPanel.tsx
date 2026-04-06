import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Trash2, RotateCcw } from "lucide-react";
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

export function SupportAuditPanel() {
  const { toast } = useToast();

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const { data: archivedUsers, isLoading: archivedUsersLoading } = useQuery<User[]>({
    queryKey: ["/api/platform/users/archived"],
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

  return (
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
  );
}
