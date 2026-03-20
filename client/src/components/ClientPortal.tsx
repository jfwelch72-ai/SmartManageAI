import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Loader2, 
  CheckCircle2, 
  Plus,
  Pencil,
  Trash2,
  Link2,
  Copy,
  ExternalLink,
  Mail,
  Users,
  Shield,
  Eye,
  Clock,
  Activity,
  Globe,
  Lock,
  Send
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO, formatDistanceToNow } from "date-fns";

interface PortalAccess {
  id: string;
  projectId: string;
  projectName: string;
  email: string;
  name: string;
  accessType: "OWNER_REP" | "GC_REP" | "STAKEHOLDER" | "VIEWER";
  permissions: {
    viewProgress: boolean;
    viewPhotos: boolean;
    viewSchedule: boolean;
    viewDocuments: boolean;
    viewChangeOrders: boolean;
    viewInvoices: boolean;
    submitRequests: boolean;
  };
  isActive: boolean;
  lastAccessedAt?: string;
  expiresAt?: string;
  createdAt: string;
}

interface ClientPortalProps {
  projectId: string;
  projectName: string;
}

const ACCESS_TYPE_CONFIG = {
  OWNER_REP: { label: "Owner Representative", icon: Shield, color: "text-purple-500" },
  GC_REP: { label: "GC Representative", icon: Users, color: "text-blue-500" },
  STAKEHOLDER: { label: "Stakeholder", icon: Eye, color: "text-green-500" },
  VIEWER: { label: "Viewer", icon: Globe, color: "text-gray-500" },
};

export default function ClientPortal({ projectId, projectName }: ClientPortalProps) {
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editingAccess, setEditingAccess] = useState<PortalAccess | null>(null);
  const [permissions, setPermissions] = useState({
    viewProgress: true,
    viewPhotos: true,
    viewSchedule: true,
    viewDocuments: false,
    viewChangeOrders: false,
    viewInvoices: false,
    submitRequests: false,
  });
  
  const { toast } = useToast();

  interface PortalResponse {
    accessList: PortalAccess[];
    stats: {
      totalAccess: number;
      activeUsers: number;
      lastActivity: string | null;
    };
    portalUrl?: string;
  }

  const { data, isLoading, refetch } = useQuery<PortalResponse>({
    queryKey: ["/api/ai-features/client-portal", projectId],
  });

  const inviteMutation = useMutation({
    mutationFn: async (invite: { email: string; name: string; accessType: string; permissions: typeof permissions }) => {
      const response = await apiRequest("POST", "/api/ai-features/client-portal/invite", {
        projectId,
        ...invite,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/client-portal", projectId] });
      setInviteDialogOpen(false);
      toast({
        title: "Invitation Sent",
        description: "The client will receive an email with portal access instructions",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Invitation Failed",
        description: error.message || "Failed to send invitation",
        variant: "destructive",
      });
    },
  });

  const updateAccessMutation = useMutation({
    mutationFn: async ({ accessId, updates }: { accessId: string; updates: Partial<PortalAccess> }) => {
      const response = await apiRequest("PATCH", `/api/ai-features/client-portal/access/${accessId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/client-portal", projectId] });
      setEditingAccess(null);
      toast({
        title: "Access Updated",
        description: "Portal access has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update access",
        variant: "destructive",
      });
    },
  });

  const revokeAccessMutation = useMutation({
    mutationFn: async (accessId: string) => {
      const response = await apiRequest("DELETE", `/api/ai-features/client-portal/access/${accessId}`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-features/client-portal", projectId] });
      toast({
        title: "Access Revoked",
        description: "Portal access has been revoked",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Revocation Failed",
        description: error.message || "Failed to revoke access",
        variant: "destructive",
      });
    },
  });

  const handleCopyLink = () => {
    if (data?.portalUrl) {
      navigator.clipboard.writeText(data.portalUrl);
      toast({
        title: "Link Copied",
        description: "Portal link has been copied to clipboard",
      });
    }
  };

  const handleInvite = (formData: FormData) => {
    inviteMutation.mutate({
      email: formData.get("email") as string,
      name: formData.get("name") as string,
      accessType: formData.get("accessType") as string,
      permissions,
    });
  };

  const accessList = data?.accessList || [];
  const stats = data?.stats || { totalAccess: 0, activeUsers: 0, lastActivity: null };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Client Portal</h2>
          <p className="text-muted-foreground">
            Share project visibility with clients and stakeholders
          </p>
        </div>
        <div className="flex gap-2">
          {data?.portalUrl && (
            <Button variant="outline" onClick={handleCopyLink} data-testid="button-copy-link">
              <Copy className="w-4 h-4 mr-2" />
              Copy Link
            </Button>
          )}
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-invite-client">
                <Plus className="w-4 h-4 mr-2" />
                Invite Client
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Invite to Client Portal</DialogTitle>
                <DialogDescription>
                  Send a portal invitation to a client or stakeholder
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => {
                e.preventDefault();
                handleInvite(new FormData(e.currentTarget));
              }}>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      name="name"
                      placeholder="John Smith"
                      required
                      data-testid="input-invite-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="john@company.com"
                      required
                      data-testid="input-invite-email"
                    />
                  </div>
                  <div>
                    <Label>Access Type</Label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {Object.entries(ACCESS_TYPE_CONFIG).map(([key, config]) => {
                        const Icon = config.icon;
                        return (
                          <label
                            key={key}
                            className={cn(
                              "flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover-elevate"
                            )}
                          >
                            <input
                              type="radio"
                              name="accessType"
                              value={key}
                              defaultChecked={key === "STAKEHOLDER"}
                              className="sr-only"
                            />
                            <Icon className={cn("w-4 h-4", config.color)} />
                            <span className="text-sm">{config.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <Label className="mb-3 block">Permissions</Label>
                    <div className="space-y-3">
                      {[
                        { key: "viewProgress", label: "View Progress Updates" },
                        { key: "viewPhotos", label: "View Photos & Media" },
                        { key: "viewSchedule", label: "View Schedule" },
                        { key: "viewDocuments", label: "View Documents" },
                        { key: "viewChangeOrders", label: "View Change Orders" },
                        { key: "viewInvoices", label: "View Invoices & Payments" },
                        { key: "submitRequests", label: "Submit Requests" },
                      ].map(perm => (
                        <div key={perm.key} className="flex items-center justify-between">
                          <Label htmlFor={perm.key} className="font-normal cursor-pointer">
                            {perm.label}
                          </Label>
                          <Switch
                            id={perm.key}
                            checked={permissions[perm.key as keyof typeof permissions]}
                            onCheckedChange={(checked) => 
                              setPermissions(prev => ({ ...prev, [perm.key]: checked }))
                            }
                            data-testid={`switch-${perm.key}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={inviteMutation.isPending}>
                    {inviteMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send Invitation
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Access</p>
                <p className="text-2xl font-bold">{stats.totalAccess}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Activity className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Users</p>
                <p className="text-2xl font-bold">{stats.activeUsers}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Activity</p>
                <p className="text-lg font-bold">
                  {stats.lastActivity 
                    ? formatDistanceToNow(parseISO(stats.lastActivity), { addSuffix: true })
                    : "Never"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Portal Access</CardTitle>
          <CardDescription>
            Manage who can view your project through the client portal
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accessList.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Portal Access Yet</h3>
              <p className="text-muted-foreground mb-4">
                Invite clients and stakeholders to view project updates
              </p>
              <Button onClick={() => setInviteDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Invite First Client
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Access Type</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Access</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accessList.map(access => {
                  const TypeConfig = ACCESS_TYPE_CONFIG[access.accessType];
                  const TypeIcon = TypeConfig.icon;
                  const permCount = Object.values(access.permissions).filter(Boolean).length;
                  
                  return (
                    <TableRow key={access.id} data-testid={`row-access-${access.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{access.name}</p>
                          <p className="text-sm text-muted-foreground">{access.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TypeIcon className={cn("w-4 h-4", TypeConfig.color)} />
                          <span className="text-sm">{TypeConfig.label}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{permCount} permissions</Badge>
                      </TableCell>
                      <TableCell>
                        {access.isActive ? (
                          <Badge className="bg-green-100 text-green-600">Active</Badge>
                        ) : (
                          <Badge variant="outline">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {access.lastAccessedAt 
                          ? formatDistanceToNow(parseISO(access.lastAccessedAt), { addSuffix: true })
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingAccess(access)}
                            data-testid={`button-edit-access-${access.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => updateAccessMutation.mutate({
                              accessId: access.id,
                              updates: { isActive: !access.isActive }
                            })}
                            data-testid={`button-toggle-access-${access.id}`}
                          >
                            {access.isActive ? (
                              <Lock className="w-4 h-4" />
                            ) : (
                              <Globe className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => revokeAccessMutation.mutate(access.id)}
                            data-testid={`button-revoke-access-${access.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingAccess} onOpenChange={(open) => !open && setEditingAccess(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Portal Access</DialogTitle>
            <DialogDescription>
              Update permissions for {editingAccess?.name}
            </DialogDescription>
          </DialogHeader>
          {editingAccess && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <Mail className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{editingAccess.name}</p>
                  <p className="text-sm text-muted-foreground">{editingAccess.email}</p>
                </div>
              </div>
              <Separator />
              <div>
                <Label className="mb-3 block">Permissions</Label>
                <div className="space-y-3">
                  {[
                    { key: "viewProgress", label: "View Progress Updates" },
                    { key: "viewPhotos", label: "View Photos & Media" },
                    { key: "viewSchedule", label: "View Schedule" },
                    { key: "viewDocuments", label: "View Documents" },
                    { key: "viewChangeOrders", label: "View Change Orders" },
                    { key: "viewInvoices", label: "View Invoices & Payments" },
                    { key: "submitRequests", label: "Submit Requests" },
                  ].map(perm => (
                    <div key={perm.key} className="flex items-center justify-between">
                      <Label htmlFor={`edit-${perm.key}`} className="font-normal cursor-pointer">
                        {perm.label}
                      </Label>
                      <Switch
                        id={`edit-${perm.key}`}
                        checked={!!editingAccess.permissions[perm.key as keyof typeof editingAccess.permissions]}
                        onCheckedChange={(checked) => {
                          const newPermissions = { 
                            ...editingAccess.permissions, 
                            [perm.key]: checked 
                          };
                          setEditingAccess({ ...editingAccess, permissions: newPermissions });
                        }}
                        data-testid={`edit-switch-${perm.key}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccess(null)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (editingAccess) {
                  updateAccessMutation.mutate({
                    accessId: editingAccess.id,
                    updates: { permissions: editingAccess.permissions }
                  });
                }
              }}
              disabled={updateAccessMutation.isPending}
            >
              {updateAccessMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
