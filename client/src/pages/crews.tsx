import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Plus, Trash2, Edit, UserPlus, Award, X, Search, Filter } from "lucide-react";

interface Crew {
  id: string;
  name: string;
  description: string | null;
  leadId: string | null;
  isActive: boolean;
  lead: { id: string; firstName: string; lastName: string } | null;
  memberCount: number;
}

interface Skill {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  costRateRegular: string | null;
  costRateOvertime: string | null;
}

interface CrewMember {
  crewMember: {
    id: string;
    crewId: string;
    userId: string;
    role: string | null;
    addedAt: string;
  };
  user: User;
}

export default function CrewsPage() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();

  // Filter state
  const [crewSearchTerm, setCrewSearchTerm] = useState("");
  const [crewStatusFilter, setCrewStatusFilter] = useState("ALL");
  const [skillSearchTerm, setSkillSearchTerm] = useState("");
  const [skillCategoryFilter, setSkillCategoryFilter] = useState("ALL");

  // Crews state
  const [showCrewDialog, setShowCrewDialog] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState<Crew | null>(null);
  const [crewName, setCrewName] = useState("");
  const [crewDescription, setCrewDescription] = useState("");
  const [crewLeadId, setCrewLeadId] = useState("");
  const [crewIsActive, setCrewIsActive] = useState(true);

  // Skills state
  const [showSkillDialog, setShowSkillDialog] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillCategory, setSkillCategory] = useState("");
  const [skillDescription, setSkillDescription] = useState("");

  // Crew members state
  const [showMembersDialog, setShowMembersDialog] = useState(false);
  const [selectedCrewForMembers, setSelectedCrewForMembers] = useState<Crew | null>(null);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [memberRole, setMemberRole] = useState("");

  // Data queries
  const { data: crews = [], isLoading: crewsLoading, refetch: refetchCrews } = useQuery<Crew[]>({
    queryKey: ["/api/crews"],
  });

  const { data: skills = [], isLoading: skillsLoading, refetch: refetchSkills } = useQuery<Skill[]>({
    queryKey: ["/api/skills"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: crewMembers = [], refetch: refetchMembers } = useQuery<CrewMember[]>({
    queryKey: ["/api/crews", selectedCrewForMembers?.id, "members"],
    enabled: !!selectedCrewForMembers,
  });

  // Filtering logic
  const filteredCrews = useMemo(() => {
    const searchLower = crewSearchTerm.toLowerCase();
    
    return crews.filter(crew => {
      // Search filter - safely handle optional fields
      const crewName = (crew.name ?? "").toLowerCase();
      const crewDescription = (crew.description ?? "").toLowerCase();
      const leadName = crew.lead 
        ? `${crew.lead.firstName ?? ""} ${crew.lead.lastName ?? ""}`.toLowerCase() 
        : "";
      
      const matchesSearch = 
        crewName.includes(searchLower) ||
        crewDescription.includes(searchLower) ||
        leadName.includes(searchLower);
      
      if (crewSearchTerm && !matchesSearch) return false;
      
      // Status filter
      if (crewStatusFilter === "ACTIVE" && !crew.isActive) return false;
      if (crewStatusFilter === "INACTIVE" && crew.isActive) return false;
      
      return true;
    });
  }, [crews, crewSearchTerm, crewStatusFilter]);

  // Get unique skill categories
  const uniqueSkillCategories = useMemo(() => {
    const categories = skills.map(s => s.category).filter(Boolean) as string[];
    return Array.from(new Set(categories)).sort();
  }, [skills]);

  const filteredSkills = useMemo(() => {
    const searchLower = skillSearchTerm.toLowerCase();
    
    return skills.filter(skill => {
      // Search filter - safely handle optional fields
      const skillNameVal = (skill.name ?? "").toLowerCase();
      const skillDescVal = (skill.description ?? "").toLowerCase();
      const skillCatVal = (skill.category ?? "").toLowerCase();
      
      const matchesSearch = 
        skillNameVal.includes(searchLower) ||
        skillDescVal.includes(searchLower) ||
        skillCatVal.includes(searchLower);
      
      if (skillSearchTerm && !matchesSearch) return false;
      
      // Category filter
      if (skillCategoryFilter !== "ALL" && skill.category !== skillCategoryFilter) return false;
      
      return true;
    });
  }, [skills, skillSearchTerm, skillCategoryFilter]);

  const hasCrewFilters = crewSearchTerm || crewStatusFilter !== "ALL";
  const hasSkillFilters = skillSearchTerm || skillCategoryFilter !== "ALL";

  // Crew mutations
  const createCrewMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/crews", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews"] });
      toast({ title: "Success", description: "Crew created successfully" });
      setShowCrewDialog(false);
      resetCrewForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create crew", variant: "destructive" });
    },
  });

  const updateCrewMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => 
      apiRequest("PATCH", `/api/crews/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews"] });
      toast({ title: "Success", description: "Crew updated successfully" });
      setShowCrewDialog(false);
      resetCrewForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update crew", variant: "destructive" });
    },
  });

  const deleteCrewMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/crews/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews"] });
      toast({ title: "Success", description: "Crew deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete crew", variant: "destructive" });
    },
  });

  // Skill mutations
  const createSkillMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/skills", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      toast({ title: "Success", description: "Skill created successfully" });
      setShowSkillDialog(false);
      resetSkillForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create skill", variant: "destructive" });
    },
  });

  const deleteSkillMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/skills/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      toast({ title: "Success", description: "Skill deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete skill", variant: "destructive" });
    },
  });

  // Crew member mutations
  const addMemberMutation = useMutation({
    mutationFn: async ({ crewId, userId, role }: { crewId: string; userId: string; role: string }) =>
      apiRequest("POST", `/api/crews/${crewId}/members`, { userId, role: role || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews"] });
      refetchMembers();
      toast({ title: "Success", description: "Member added to crew" });
      setShowAddMemberDialog(false);
      setSelectedUserId("");
      setMemberRole("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add member", variant: "destructive" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async ({ crewId, userId }: { crewId: string; userId: string }) =>
      apiRequest("DELETE", `/api/crews/${crewId}/members/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews"] });
      refetchMembers();
      toast({ title: "Success", description: "Member removed from crew" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to remove member", variant: "destructive" });
    },
  });

  const resetCrewForm = () => {
    setSelectedCrew(null);
    setCrewName("");
    setCrewDescription("");
    setCrewLeadId("");
    setCrewIsActive(true);
  };

  const resetSkillForm = () => {
    setSkillName("");
    setSkillCategory("");
    setSkillDescription("");
  };

  const handleEditCrew = (crew: Crew) => {
    setSelectedCrew(crew);
    setCrewName(crew.name);
    setCrewDescription(crew.description || "");
    setCrewLeadId(crew.leadId || "");
    setCrewIsActive(crew.isActive);
    setShowCrewDialog(true);
  };

  const handleSaveCrew = () => {
    if (!crewName.trim()) {
      toast({ title: "Error", description: "Crew name is required", variant: "destructive" });
      return;
    }

    const data = {
      name: crewName,
      description: crewDescription || null,
      leadId: crewLeadId || null,
      isActive: crewIsActive,
    };

    if (selectedCrew) {
      updateCrewMutation.mutate({ id: selectedCrew.id, data });
    } else {
      createCrewMutation.mutate(data);
    }
  };

  const handleSaveSkill = () => {
    if (!skillName.trim()) {
      toast({ title: "Error", description: "Skill name is required", variant: "destructive" });
      return;
    }

    createSkillMutation.mutate({
      name: skillName,
      category: skillCategory || null,
      description: skillDescription || null,
    });
  };

  const handleViewMembers = (crew: Crew) => {
    setSelectedCrewForMembers(crew);
    setShowMembersDialog(true);
  };

  const handleAddMember = () => {
    if (!selectedUserId) {
      toast({ title: "Error", description: "Please select a user", variant: "destructive" });
      return;
    }

    if (!selectedCrewForMembers) return;

    addMemberMutation.mutate({
      crewId: selectedCrewForMembers.id,
      userId: selectedUserId,
      role: memberRole || "",
    });
  };

  if (!user) {
    return null;
  }

  const isManagerOrAdmin = user.role === "ADMIN" || user.role === "MANAGER";

  if (!isManagerOrAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-2xl font-bold">Access Denied</h2>
              <p className="text-muted-foreground">Admin or Manager access required</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-2">
            <Users className="h-8 w-8 text-primary" />
            Crews & Skills Management
          </h1>
          <p className="text-muted-foreground">
            Organize crews, assign members, and track employee skills
          </p>
        </div>

        <Tabs defaultValue="crews" className="space-y-6">
          <TabsList data-testid="tabs-crews-skills">
            <TabsTrigger value="crews" data-testid="tab-crews">Crews</TabsTrigger>
            <TabsTrigger value="skills" data-testid="tab-skills">Skills</TabsTrigger>
          </TabsList>

          <TabsContent value="crews" className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-4">
              <h2 className="text-xl font-semibold">Crews</h2>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search crews..."
                    className="pl-9 w-[200px]"
                    value={crewSearchTerm}
                    onChange={(e) => setCrewSearchTerm(e.target.value)}
                    data-testid="input-search-crews"
                  />
                </div>
                
                <Select value={crewStatusFilter} onValueChange={setCrewStatusFilter}>
                  <SelectTrigger className="w-[130px]" data-testid="select-crew-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Status</SelectItem>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                
                <Button
                  onClick={() => {
                    resetCrewForm();
                    setShowCrewDialog(true);
                  }}
                  data-testid="button-create-crew"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Crew
                </Button>
              </div>
            </div>
            
            {/* Active filter badges for crews */}
            {hasCrewFilters && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Active filters:</span>
                {crewSearchTerm && (
                  <Badge variant="secondary" className="gap-1">
                    Search: "{crewSearchTerm}"
                    <X 
                      className="w-3 h-3 cursor-pointer" 
                      onClick={() => setCrewSearchTerm("")}
                      data-testid="button-clear-crew-search"
                    />
                  </Badge>
                )}
                {crewStatusFilter !== "ALL" && (
                  <Badge variant="secondary" className="gap-1">
                    {crewStatusFilter}
                    <X 
                      className="w-3 h-3 cursor-pointer" 
                      onClick={() => setCrewStatusFilter("ALL")}
                      data-testid="button-clear-crew-status-filter"
                    />
                  </Badge>
                )}
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setCrewSearchTerm("");
                    setCrewStatusFilter("ALL");
                  }}
                  data-testid="button-clear-all-crew-filters"
                >
                  Clear all
                </Button>
              </div>
            )}

            <Card>
              <CardContent className="p-0">
                {crewsLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading crews...</div>
                ) : filteredCrews.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    {hasCrewFilters ? "No crews match your filters" : "No crews found"}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Lead</TableHead>
                        <TableHead>Members</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCrews.map((crew) => (
                        <TableRow key={crew.id} data-testid={`crew-row-${crew.id}`}>
                          <TableCell className="font-medium">{crew.name}</TableCell>
                          <TableCell>
                            {crew.lead ? `${crew.lead.firstName} ${crew.lead.lastName}` : "-"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewMembers(crew)}
                              data-testid={`button-view-members-${crew.id}`}
                            >
                              {crew.memberCount} members
                            </Button>
                          </TableCell>
                          <TableCell>
                            {crew.isActive ? (
                              <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>
                            ) : (
                              <Badge variant="secondary">Inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-xs truncate">
                            {crew.description || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-2 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditCrew(crew)}
                                data-testid={`button-edit-crew-${crew.id}`}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              {user.role === "ADMIN" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteCrewMutation.mutate(crew.id)}
                                  data-testid={`button-delete-crew-${crew.id}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="skills" className="space-y-4">
            <div className="flex flex-wrap justify-between items-center gap-4">
              <h2 className="text-xl font-semibold">Skills</h2>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search skills..."
                    className="pl-9 w-[200px]"
                    value={skillSearchTerm}
                    onChange={(e) => setSkillSearchTerm(e.target.value)}
                    data-testid="input-search-skills"
                  />
                </div>
                
                {uniqueSkillCategories.length > 0 && (
                  <Select value={skillCategoryFilter} onValueChange={setSkillCategoryFilter}>
                    <SelectTrigger className="w-[160px]" data-testid="select-skill-category-filter">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Categories</SelectItem>
                      {uniqueSkillCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                
                <Button
                  onClick={() => setShowSkillDialog(true)}
                  data-testid="button-create-skill"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Skill
                </Button>
              </div>
            </div>
            
            {/* Active filter badges for skills */}
            {hasSkillFilters && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Active filters:</span>
                {skillSearchTerm && (
                  <Badge variant="secondary" className="gap-1">
                    Search: "{skillSearchTerm}"
                    <X 
                      className="w-3 h-3 cursor-pointer" 
                      onClick={() => setSkillSearchTerm("")}
                      data-testid="button-clear-skill-search"
                    />
                  </Badge>
                )}
                {skillCategoryFilter !== "ALL" && (
                  <Badge variant="secondary" className="gap-1">
                    {skillCategoryFilter}
                    <X 
                      className="w-3 h-3 cursor-pointer" 
                      onClick={() => setSkillCategoryFilter("ALL")}
                      data-testid="button-clear-skill-category-filter"
                    />
                  </Badge>
                )}
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setSkillSearchTerm("");
                    setSkillCategoryFilter("ALL");
                  }}
                  data-testid="button-clear-all-skill-filters"
                >
                  Clear all
                </Button>
              </div>
            )}

            <Card>
              <CardContent className="p-0">
                {skillsLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading skills...</div>
                ) : filteredSkills.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    {hasSkillFilters ? "No skills match your filters" : "No skills found"}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSkills.map((skill) => (
                        <TableRow key={skill.id} data-testid={`skill-row-${skill.id}`}>
                          <TableCell className="font-medium">{skill.name}</TableCell>
                          <TableCell>
                            {skill.category ? (
                              <Badge variant="outline">{skill.category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-md truncate">
                            {skill.description || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {user.role === "ADMIN" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteSkillMutation.mutate(skill.id)}
                                data-testid={`button-delete-skill-${skill.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Create/Edit Crew Dialog */}
      <Dialog open={showCrewDialog} onOpenChange={setShowCrewDialog}>
        <DialogContent data-testid="dialog-crew">
          <DialogHeader>
            <DialogTitle>{selectedCrew ? "Edit Crew" : "Create New Crew"}</DialogTitle>
            <DialogDescription>
              {selectedCrew ? "Update crew information" : "Add a new crew to organize your team"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="crew-name">Crew Name</Label>
              <Input
                id="crew-name"
                value={crewName}
                onChange={(e) => setCrewName(e.target.value)}
                placeholder="e.g., Concrete Crew A"
                data-testid="input-crew-name"
              />
            </div>
            <div>
              <Label htmlFor="crew-description">Description</Label>
              <Textarea
                id="crew-description"
                value={crewDescription}
                onChange={(e) => setCrewDescription(e.target.value)}
                placeholder="Brief description of the crew's responsibilities"
                data-testid="input-crew-description"
              />
            </div>
            <div>
              <Label htmlFor="crew-lead">Crew Lead</Label>
              <Select value={crewLeadId || "none"} onValueChange={(val) => setCrewLeadId(val === "none" ? "" : val)}>
                <SelectTrigger id="crew-lead" data-testid="select-crew-lead">
                  <SelectValue placeholder="Select a crew lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {users
                    .filter((u) => u.role === "SUPERINTENDENT" || u.role === "MANAGER")
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName} ({u.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="crew-active"
                checked={crewIsActive}
                onChange={(e) => setCrewIsActive(e.target.checked)}
                className="h-4 w-4"
                data-testid="checkbox-crew-active"
              />
              <Label htmlFor="crew-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCrewDialog(false)}
              data-testid="button-cancel-crew"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveCrew}
              disabled={createCrewMutation.isPending || updateCrewMutation.isPending}
              data-testid="button-save-crew"
            >
              {selectedCrew ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Skill Dialog */}
      <Dialog open={showSkillDialog} onOpenChange={setShowSkillDialog}>
        <DialogContent data-testid="dialog-skill">
          <DialogHeader>
            <DialogTitle>Create New Skill</DialogTitle>
            <DialogDescription>Add a skill that can be assigned to employees</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="skill-name">Skill Name</Label>
              <Input
                id="skill-name"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="e.g., Welding, Carpentry"
                data-testid="input-skill-name"
              />
            </div>
            <div>
              <Label htmlFor="skill-category">Category</Label>
              <Input
                id="skill-category"
                value={skillCategory}
                onChange={(e) => setSkillCategory(e.target.value)}
                placeholder="e.g., Trades, Equipment, Safety"
                data-testid="input-skill-category"
              />
            </div>
            <div>
              <Label htmlFor="skill-description">Description</Label>
              <Textarea
                id="skill-description"
                value={skillDescription}
                onChange={(e) => setSkillDescription(e.target.value)}
                placeholder="Brief description of the skill"
                data-testid="input-skill-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSkillDialog(false)}
              data-testid="button-cancel-skill"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveSkill}
              disabled={createSkillMutation.isPending}
              data-testid="button-save-skill"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Crew Members Dialog */}
      <Dialog open={showMembersDialog} onOpenChange={setShowMembersDialog}>
        <DialogContent className="max-w-2xl" data-testid="dialog-crew-members">
          <DialogHeader>
            <DialogTitle>
              {selectedCrewForMembers?.name} - Members
            </DialogTitle>
            <DialogDescription>
              Manage crew members and their roles
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Button
              onClick={() => setShowAddMemberDialog(true)}
              size="sm"
              data-testid="button-add-member"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Add Member
            </Button>
            {crewMembers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No members in this crew
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Cost Rates</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {crewMembers.map(({ crewMember, user }) => (
                    <TableRow key={crewMember.id} data-testid={`member-row-${user.id}`}>
                      <TableCell className="font-medium">
                        {user.firstName} {user.lastName}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        {crewMember.role ? (
                          <Badge variant="outline">{crewMember.role}</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {user.costRateRegular && user.costRateOvertime ? (
                          <span className="text-muted-foreground">
                            ${user.costRateRegular} / ${user.costRateOvertime}
                          </span>
                        ) : (
                          <span className="text-destructive">Not set</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            removeMemberMutation.mutate({
                              crewId: selectedCrewForMembers!.id,
                              userId: user.id,
                            })
                          }
                          data-testid={`button-remove-member-${user.id}`}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog open={showAddMemberDialog} onOpenChange={setShowAddMemberDialog}>
        <DialogContent data-testid="dialog-add-member">
          <DialogHeader>
            <DialogTitle>Add Member to Crew</DialogTitle>
            <DialogDescription>Select a user to add to this crew</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="select-user">User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id="select-user" data-testid="select-member-user">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((u) => 
                      !crewMembers.some((cm) => cm.user.id === u.id)
                    )
                    .map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName} ({u.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="member-role">Role (Optional)</Label>
              <Input
                id="member-role"
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value)}
                placeholder="e.g., Foreman, Laborer"
                data-testid="input-member-role"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddMemberDialog(false)}
              data-testid="button-cancel-add-member"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddMember}
              disabled={addMemberMutation.isPending}
              data-testid="button-confirm-add-member"
            >
              Add Member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
