import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, DollarSign } from "lucide-react";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  costRateRegular: string | null;
  costRateOvertime: string | null;
}

interface EmployeeRatesTabProps {
  users: User[];
  usersLoading: boolean;
  canEdit: boolean;
}

export function EmployeeRatesTab({ users, usersLoading, canEdit }: EmployeeRatesTabProps) {
  const { toast } = useToast();
  const [showEditRateDialog, setShowEditRateDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editRegularRate, setEditRegularRate] = useState("");
  const [editOvertimeRate, setEditOvertimeRate] = useState("");

  const updateRatesMutation = useMutation({
    mutationFn: async (data: { userId: string; costRateRegular: string; costRateOvertime: string }) => {
      return await apiRequest("PATCH", `/api/users/${data.userId}/cost-rates`, {
        costRateRegular: data.costRateRegular,
        costRateOvertime: data.costRateOvertime,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "Base rates updated" });
      setShowEditRateDialog(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update rates", variant: "destructive" });
    },
  });

  const handleEditRate = (user: User) => {
    setSelectedUser(user);
    setEditRegularRate(user.costRateRegular || "50");
    setEditOvertimeRate(user.costRateOvertime || "75");
    setShowEditRateDialog(true);
  };

  const handleSaveRate = () => {
    if (!selectedUser) return;
    const regularRate = parseFloat(editRegularRate);
    const overtimeRate = parseFloat(editOvertimeRate);
    if (isNaN(regularRate) || isNaN(overtimeRate) || regularRate < 0 || overtimeRate < 0) {
      toast({ title: "Invalid Input", description: "Rates must be valid non-negative numbers", variant: "destructive" });
      return;
    }
    updateRatesMutation.mutate({
      userId: selectedUser.id,
      costRateRegular: regularRate.toFixed(2),
      costRateOvertime: overtimeRate.toFixed(2),
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Base Employee Rates
          </CardTitle>
          <CardDescription>
            Default hourly rates for each employee. These are used when no classification or project-specific rate applies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Regular Rate ($/hr)</TableHead>
                      <TableHead className="text-right">Overtime Rate ($/hr)</TableHead>
                      {canEdit && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id} data-testid={`row-employee-${u.id}`}>
                        <TableCell className="font-medium">{u.firstName} {u.lastName}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                        <TableCell className="text-right font-mono">
                          {u.costRateRegular ? `$${parseFloat(u.costRateRegular).toFixed(2)}` : <span className="text-muted-foreground">Not set</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {u.costRateOvertime ? `$${parseFloat(u.costRateOvertime).toFixed(2)}` : <span className="text-muted-foreground">Not set</span>}
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" onClick={() => handleEditRate(u)} data-testid={`button-edit-rate-${u.id}`}>
                              <Edit className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="md:hidden space-y-3">
                {users.map((u) => (
                  <div key={u.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-employee-${u.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{u.firstName} {u.lastName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        <Badge variant="secondary" className="text-xs mt-1">{u.role}</Badge>
                      </div>
                      {canEdit && (
                        <Button size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0" onClick={() => handleEditRate(u)} data-testid={`button-edit-rate-m-${u.id}`}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Regular</span>
                        <p className="font-mono font-medium">{u.costRateRegular ? `$${parseFloat(u.costRateRegular).toFixed(2)}/hr` : "Not set"}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Overtime</span>
                        <p className="font-mono font-medium">{u.costRateOvertime ? `$${parseFloat(u.costRateOvertime).toFixed(2)}/hr` : "Not set"}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEditRateDialog} onOpenChange={setShowEditRateDialog}>
        <DialogContent data-testid="dialog-edit-base-rate">
          <DialogHeader>
            <DialogTitle>Edit Base Rates</DialogTitle>
            <DialogDescription>
              {selectedUser && `Update base cost rates for ${selectedUser.firstName} ${selectedUser.lastName}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="regular-rate">Regular Hourly Rate ($)</Label>
              <Input id="regular-rate" type="number" step="0.01" value={editRegularRate} onChange={(e) => setEditRegularRate(e.target.value)} data-testid="input-base-regular-rate" />
            </div>
            <div>
              <Label htmlFor="overtime-rate">Overtime Hourly Rate ($)</Label>
              <Input id="overtime-rate" type="number" step="0.01" value={editOvertimeRate} onChange={(e) => setEditOvertimeRate(e.target.value)} data-testid="input-base-overtime-rate" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditRateDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveRate} disabled={updateRatesMutation.isPending} data-testid="button-save-base-rate">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
