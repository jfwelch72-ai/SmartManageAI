import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  costRateRegular: string | null;
  costRateOvertime: string | null;
}

export default function CostRatesPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editRegularRate, setEditRegularRate] = useState("");
  const [editOvertimeRate, setEditOvertimeRate] = useState("");

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const updateRatesMutation = useMutation({
    mutationFn: async (data: { userId: string; costRateRegular: string; costRateOvertime: string }) => {
      return await apiRequest("PATCH", `/api/users/${data.userId}/cost-rates`, {
        costRateRegular: data.costRateRegular,
        costRateOvertime: data.costRateOvertime,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Success", description: "Cost rates updated" });
      setShowEditDialog(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update cost rates", variant: "destructive" });
    },
  });

  const handleEdit = (user: User) => {
    setSelectedUser(user);
    setEditRegularRate(user.costRateRegular || "50");
    setEditOvertimeRate(user.costRateOvertime || "75");
    setShowEditDialog(true);
  };

  const handleSave = () => {
    if (!selectedUser) return;

    const regularRate = parseFloat(editRegularRate);
    const overtimeRate = parseFloat(editOvertimeRate);

    if (isNaN(regularRate) || isNaN(overtimeRate) || regularRate < 0 || overtimeRate < 0) {
      toast({ 
        title: "Invalid Input", 
        description: "Cost rates must be valid non-negative numbers", 
        variant: "destructive" 
      });
      return;
    }

    updateRatesMutation.mutate({
      userId: selectedUser.id,
      costRateRegular: regularRate.toFixed(2),
      costRateOvertime: overtimeRate.toFixed(2),
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">Labor Cost Rates</h1>
          <p className="text-muted-foreground">
            Manage hourly cost rates for labor profitability tracking
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>User Cost Rates</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Regular Rate ($/hr)</TableHead>
                    <TableHead className="text-right">Overtime Rate ($/hr)</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.firstName} {user.lastName}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.role}</TableCell>
                      <TableCell className="text-right font-mono">
                        {user.costRateRegular ? `$${parseFloat(user.costRateRegular).toFixed(2)}` : "Not set"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {user.costRateOvertime ? `$${parseFloat(user.costRateOvertime).toFixed(2)}` : "Not set"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(user)}
                          data-testid={`button-edit-${user.id}`}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent data-testid="dialog-edit-cost-rates">
            <DialogHeader>
              <DialogTitle>Edit Cost Rates</DialogTitle>
              <DialogDescription>
                {selectedUser && `Update cost rates for ${selectedUser.firstName} ${selectedUser.lastName}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="regular-rate">Regular Hourly Rate ($)</Label>
                <Input
                  id="regular-rate"
                  type="number"
                  step="0.01"
                  value={editRegularRate}
                  onChange={(e) => setEditRegularRate(e.target.value)}
                  placeholder="50.00"
                  data-testid="input-regular-rate"
                />
              </div>
              <div>
                <Label htmlFor="overtime-rate">Overtime Hourly Rate ($)</Label>
                <Input
                  id="overtime-rate"
                  type="number"
                  step="0.01"
                  value={editOvertimeRate}
                  onChange={(e) => setEditOvertimeRate(e.target.value)}
                  placeholder="75.00"
                  data-testid="input-overtime-rate"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={updateRatesMutation.isPending} data-testid="button-save">
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
