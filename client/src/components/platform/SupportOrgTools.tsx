import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Organization {
  id: string;
  name: string;
  slug: string;
  tradeType: string;
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

interface SupportOrgToolsProps {
  tab: "sow" | "worktypes";
}

export function SupportOrgTools({ tab }: SupportOrgToolsProps) {
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");

  const { data: organizations } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
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

  if (tab === "sow") {
    return (
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
                        <TableCell>{item.code}</TableCell>
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
    );
  }

  return (
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
  );
}
