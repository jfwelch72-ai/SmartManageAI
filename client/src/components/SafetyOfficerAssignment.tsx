import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { UserCheck, Loader2 } from "lucide-react";

interface SafetyOfficerAssignmentProps {
  projectCode: string;
  userRole: string;
}

interface OrgUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

function isManagement(role: string) {
  return ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(role);
}

export default function SafetyOfficerAssignment({ projectCode, userRole }: SafetyOfficerAssignmentProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const qk = ["/api/projects", projectCode, "safety-officer"];

  const { data: officerData, isLoading } = useQuery<{ safetyOfficerId: string | null; safetyOfficer: OrgUser | null }>({
    queryKey: qk,
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/safety-officer`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch safety officer");
      return r.json();
    },
    enabled: !!projectCode,
  });

  const { data: orgUsers = [] } = useQuery<OrgUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const r = await fetch("/api/users", { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: (safetyOfficerId: string | null) =>
      apiRequest("PATCH", `/api/projects/${projectCode}/safety-officer`, { safetyOfficerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk });
      toast({ title: "Safety officer updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canEdit = isManagement(userRole);
  const officer = officerData?.safetyOfficer;
  const officerId = officerData?.safetyOfficerId || "";

  return (
    <Card className="bg-muted/30" data-testid="safety-officer-card">
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            <UserCheck className="h-4 w-4 text-primary" />
            Safety Officer
          </div>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : canEdit ? (
            <Select
              value={officerId || "__none__"}
              onValueChange={(v) => updateMutation.mutate(v === "__none__" ? null : v)}
            >
              <SelectTrigger className="w-56 h-8 text-sm" data-testid="select-safety-officer">
                <SelectValue placeholder="Assign safety officer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No officer assigned</SelectItem>
                {orgUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : officer ? (
            <Badge variant="secondary" className="text-sm" data-testid="text-safety-officer-name">
              {officer.firstName} {officer.lastName}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground" data-testid="text-no-safety-officer">Not assigned</span>
          )}
          {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </CardContent>
    </Card>
  );
}
