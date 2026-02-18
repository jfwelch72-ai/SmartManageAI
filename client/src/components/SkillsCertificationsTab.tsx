import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Star,
  X,
  Pencil,
  Trash2,
  Upload,
  Download,
  Shield,
  ShieldCheck,
  Clock,
  Plus,
  FileText,
  Loader2,
  CalendarIcon,
} from "lucide-react";

interface UserSkill {
  id: string;
  skillId: string;
  skillName: string;
  category: string | null;
  starRating: number | null;
  verificationStatus: string | null;
  verifiedByUserId: string | null;
  verifiedByName: string | null;
  verifiedByRole: string | null;
  verifiedAt: string | null;
}

interface UserCertification {
  id: string;
  userId: string;
  organizationId: string;
  certificationName: string;
  issuedDate: string | null;
  expiryDate: string | null;
  fileUrl: string | null;
  fileName: string | null;
  status: string;
  createdAt: string;
}

interface EquipmentCompetency {
  id: string;
  userId: string;
  organizationId: string;
  equipmentName: string;
  createdAt: string;
}

function getCertStatus(cert: UserCertification): { label: string; variant: "default" | "destructive" | "secondary" | "outline"; className: string } {
  if (!cert.expiryDate) {
    return { label: "Active", variant: "default", className: "bg-green-600 text-white border-transparent no-default-hover-elevate" };
  }
  const now = new Date();
  const expiry = new Date(cert.expiryDate);
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) {
    return { label: "Expired", variant: "destructive", className: "no-default-hover-elevate" };
  }
  if (diffDays <= 35) {
    return { label: "Expiring Soon", variant: "outline", className: "bg-amber-500 text-white border-transparent no-default-hover-elevate" };
  }
  return { label: "Active", variant: "default", className: "bg-green-600 text-white border-transparent no-default-hover-elevate" };
}

function StarRating({ rating, onRate, skillId }: { rating: number; onRate: (r: number) => void; skillId: string }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onRate(star)}
          className="p-0.5"
          data-testid={`button-star-${skillId}-${star}`}
        >
          <Star
            className={`h-4 w-4 ${star <= rating ? "text-yellow-500" : "text-muted-foreground"}`}
            {...(star <= rating ? { fill: "currentColor" } : {})}
          />
        </button>
      ))}
    </div>
  );
}

export default function SkillsCertificationsTab() {
  const { toast } = useToast();

  const [skillSearch, setSkillSearch] = useState("");
  const [verificationDialogSkill, setVerificationDialogSkill] = useState<UserSkill | null>(null);

  const [certName, setCertName] = useState("");
  const [certIssuedDate, setCertIssuedDate] = useState<Date | undefined>(undefined);
  const [certExpiryDate, setCertExpiryDate] = useState<Date | undefined>(undefined);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [addingCert, setAddingCert] = useState(false);
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCertId, setUploadingCertId] = useState<string | null>(null);

  const [editingCert, setEditingCert] = useState<UserCertification | null>(null);
  const [editCertName, setEditCertName] = useState("");
  const [editCertIssuedDate, setEditCertIssuedDate] = useState<Date | undefined>(undefined);
  const [editCertExpiryDate, setEditCertExpiryDate] = useState<Date | undefined>(undefined);
  const [savingEdit, setSavingEdit] = useState(false);

  const [equipmentInput, setEquipmentInput] = useState("");

  const { data: mySkills = [], isLoading: loadingSkills } = useQuery<UserSkill[]>({
    queryKey: ["/api/auth/my-skills"],
  });

  const { data: allSkills = [] } = useQuery<{ id: string; name: string; category: string | null }[]>({
    queryKey: ["/api/skills"],
  });

  const { data: certifications = [], isLoading: loadingCerts } = useQuery<UserCertification[]>({
    queryKey: ["/api/auth/my-certifications"],
  });

  const { data: equipment = [], isLoading: loadingEquipment } = useQuery<EquipmentCompetency[]>({
    queryKey: ["/api/auth/my-equipment-competencies"],
  });

  const addSkillMutation = useMutation({
    mutationFn: async (skillName: string) => {
      return await apiRequest("POST", "/api/auth/my-skills", { skillName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-skills"] });
      setSkillSearch("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add skill", description: error.message, variant: "destructive" });
    },
  });

  const removeSkillMutation = useMutation({
    mutationFn: async (userSkillId: string) => {
      return await apiRequest("DELETE", `/api/auth/my-skills/${userSkillId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-skills"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove skill", description: error.message, variant: "destructive" });
    },
  });

  const rateSkillMutation = useMutation({
    mutationFn: async ({ skillId, starRating }: { skillId: string; starRating: number }) => {
      return await apiRequest("PATCH", `/api/auth/my-skills/${skillId}/rating`, { starRating });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-skills"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update rating", description: error.message, variant: "destructive" });
    },
  });

  const requestVerificationMutation = useMutation({
    mutationFn: async (skillId: string) => {
      return await apiRequest("POST", `/api/auth/my-skills/${skillId}/request-verification`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-skills"] });
      toast({ title: "Verification requested" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to request verification", description: error.message, variant: "destructive" });
    },
  });

  const deleteCertMutation = useMutation({
    mutationFn: async (certId: string) => {
      return await apiRequest("DELETE", `/api/auth/my-certifications/${certId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-certifications"] });
      toast({ title: "Certification deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete certification", description: error.message, variant: "destructive" });
    },
  });

  const addEquipmentMutation = useMutation({
    mutationFn: async (equipmentName: string) => {
      return await apiRequest("POST", "/api/auth/my-equipment-competencies", { equipmentName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-equipment-competencies"] });
      setEquipmentInput("");
      toast({ title: "Equipment competency added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add equipment", description: error.message, variant: "destructive" });
    },
  });

  const removeEquipmentMutation = useMutation({
    mutationFn: async (compId: string) => {
      return await apiRequest("DELETE", `/api/auth/my-equipment-competencies/${compId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-equipment-competencies"] });
      toast({ title: "Equipment competency removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove equipment", description: error.message, variant: "destructive" });
    },
  });

  const handleAddCertification = useCallback(async () => {
    if (!certName.trim()) {
      toast({ title: "Certification name is required", variant: "destructive" });
      return;
    }
    setAddingCert(true);
    try {
      const formData = new FormData();
      formData.append("certificationName", certName.trim());
      if (certIssuedDate) formData.append("issuedDate", format(certIssuedDate, "yyyy-MM-dd"));
      if (certExpiryDate) formData.append("expiryDate", format(certExpiryDate, "yyyy-MM-dd"));
      if (certFile) formData.append("file", certFile);
      const res = await fetch("/api/auth/my-certifications", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add certification");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-certifications"] });
      setCertName("");
      setCertIssuedDate(undefined);
      setCertExpiryDate(undefined);
      setCertFile(null);
      toast({ title: "Certification added" });
    } catch (error: any) {
      toast({ title: "Failed to add certification", description: error.message, variant: "destructive" });
    } finally {
      setAddingCert(false);
    }
  }, [certName, certIssuedDate, certExpiryDate, certFile, toast]);

  const handleUploadCertFile = useCallback(async (certId: string, file: File) => {
    setUploadingCertId(certId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/auth/my-certifications/${certId}/upload`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-certifications"] });
      toast({ title: "File uploaded" });
    } catch (error: any) {
      toast({ title: "Failed to upload file", description: error.message, variant: "destructive" });
    } finally {
      setUploadingCertId(null);
    }
  }, [toast]);

  const openEditCert = useCallback((cert: UserCertification) => {
    setEditingCert(cert);
    setEditCertName(cert.certificationName);
    setEditCertIssuedDate(cert.issuedDate ? new Date(cert.issuedDate) : undefined);
    setEditCertExpiryDate(cert.expiryDate ? new Date(cert.expiryDate) : undefined);
  }, []);

  const handleSaveEditCert = useCallback(async () => {
    if (!editingCert || !editCertName.trim()) return;
    setSavingEdit(true);
    try {
      await apiRequest("PATCH", `/api/auth/my-certifications/${editingCert.id}`, {
        certificationName: editCertName.trim(),
        issuedDate: editCertIssuedDate ? format(editCertIssuedDate, "yyyy-MM-dd") : null,
        expiryDate: editCertExpiryDate ? format(editCertExpiryDate, "yyyy-MM-dd") : null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-certifications"] });
      setEditingCert(null);
      toast({ title: "Certification updated" });
    } catch (error: any) {
      toast({ title: "Failed to update certification", description: error.message, variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  }, [editingCert, editCertName, editCertIssuedDate, editCertExpiryDate, toast]);

  const handleSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && skillSearch.trim()) {
      e.preventDefault();
      addSkillMutation.mutate(skillSearch.trim());
    }
  };

  const handleEquipmentKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && equipmentInput.trim()) {
      e.preventDefault();
      addEquipmentMutation.mutate(equipmentInput.trim());
    }
  };

  const filteredSuggestions = allSkills
    .filter((s) => s.name.toLowerCase().includes(skillSearch.toLowerCase()))
    .filter((s) => !mySkills.some((ms) => ms.skillId === s.id))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="skills" data-testid="tabs-skills-certifications">
        <TabsList className="toggle-elevate" data-testid="tabslist-skills-certifications">
          <TabsTrigger value="skills" data-testid="tab-skills">Skills</TabsTrigger>
          <TabsTrigger value="certifications" data-testid="tab-certifications">Certifications</TabsTrigger>
          <TabsTrigger value="equipment" data-testid="tab-equipment">Equipment</TabsTrigger>
        </TabsList>

        <TabsContent value="skills">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
              <CardTitle className="text-base">My Skills</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Input
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  onKeyDown={handleSkillKeyDown}
                  placeholder="Search for skills or type to add custom ones..."
                  data-testid="input-skill-search-tab"
                />
                {skillSearch.trim() && filteredSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-auto">
                    {filteredSuggestions.map((skill) => (
                      <button
                        key={skill.id}
                        className="w-full text-left px-3 py-2 text-sm hover-elevate"
                        onClick={() => {
                          addSkillMutation.mutate(skill.name);
                          setSkillSearch("");
                        }}
                        data-testid={`button-skill-suggestion-${skill.id}`}
                      >
                        {skill.name}
                        {skill.category && (
                          <span className="ml-2 text-muted-foreground text-xs">({skill.category})</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {loadingSkills ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : mySkills.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-skills">No skills added yet. Use the search above to add skills.</p>
              ) : (
                <div className="space-y-2">
                  {mySkills.map((skill) => (
                    <div
                      key={skill.id}
                      className="flex items-center gap-3 p-3 rounded-md border flex-wrap"
                      data-testid={`row-skill-${skill.id}`}
                    >
                      <span className="text-sm font-medium min-w-[120px]" data-testid={`text-skill-name-${skill.id}`}>
                        {skill.skillName}
                      </span>

                      <StarRating
                        rating={skill.starRating || 0}
                        onRate={(r) => rateSkillMutation.mutate({ skillId: skill.id, starRating: r })}
                        skillId={skill.id}
                      />

                      <div className="flex items-center gap-2 ml-auto flex-wrap">
                        {skill.verificationStatus === "verified" ? (
                          <Badge
                            className="bg-green-600 text-white border-transparent cursor-pointer gap-1"
                            onClick={() => setVerificationDialogSkill(skill)}
                            data-testid={`badge-verified-${skill.id}`}
                          >
                            <ShieldCheck className="h-3 w-3" />
                            Verified
                          </Badge>
                        ) : skill.verificationStatus === "pending" ? (
                          <Badge
                            className="bg-amber-500 text-white border-transparent no-default-hover-elevate gap-1"
                            data-testid={`badge-pending-${skill.id}`}
                          >
                            <Clock className="h-3 w-3" />
                            Pending
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => requestVerificationMutation.mutate(skill.id)}
                            disabled={requestVerificationMutation.isPending}
                            data-testid={`button-request-verification-${skill.id}`}
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            Request Verification
                          </Button>
                        )}

                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeSkillMutation.mutate(skill.id)}
                          data-testid={`button-remove-skill-${skill.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certifications">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
              <CardTitle className="text-base">My Certifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3 p-4 border rounded-md">
                <p className="text-sm font-medium">Add Certification</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="cert-name">Certification Name</Label>
                    <Input
                      id="cert-name"
                      value={certName}
                      onChange={(e) => setCertName(e.target.value)}
                      placeholder="e.g. OSHA 30"
                      data-testid="input-cert-name"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Issued Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "justify-start text-left font-normal",
                            !certIssuedDate && "text-muted-foreground"
                          )}
                          data-testid="input-cert-issued-date"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {certIssuedDate ? format(certIssuedDate, "MM/dd/yyyy") : "Select date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={certIssuedDate}
                          onSelect={setCertIssuedDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Expiry Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "justify-start text-left font-normal",
                            !certExpiryDate && "text-muted-foreground"
                          )}
                          data-testid="input-cert-expiry-date"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {certExpiryDate ? format(certExpiryDate, "MM/dd/yyyy") : "Select date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={certExpiryDate}
                          onSelect={setCertExpiryDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <input
                      ref={certFileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setCertFile(file);
                        e.target.value = "";
                      }}
                      data-testid="input-cert-file"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => certFileInputRef.current?.click()}
                      data-testid="button-cert-choose-file"
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      Choose File
                    </Button>
                    {certFile && (
                      <span className="text-xs text-muted-foreground" data-testid="text-cert-file-name">
                        {certFile.name}
                      </span>
                    )}
                  </div>
                  <Button
                    onClick={handleAddCertification}
                    disabled={addingCert || !certName.trim()}
                    data-testid="button-add-cert"
                  >
                    {addingCert ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                    Add Certification
                  </Button>
                </div>
              </div>

              {loadingCerts ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : certifications.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-certs">No certifications added yet.</p>
              ) : (
                <div className="space-y-2">
                  {certifications.map((cert) => {
                    const status = getCertStatus(cert);
                    return (
                      <div
                        key={cert.id}
                        className="flex items-center gap-3 p-3 rounded-md border"
                        data-testid={`row-cert-${cert.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium" data-testid={`text-cert-name-${cert.id}`}>{cert.certificationName}</p>
                            <Badge className={status.className} data-testid={`badge-cert-status-${cert.id}`}>
                              {status.label}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                            {cert.issuedDate && <span>Issued: {new Date(cert.issuedDate).toLocaleDateString()}</span>}
                            {cert.expiryDate && <span>Expires: {new Date(cert.expiryDate).toLocaleDateString()}</span>}
                          </div>
                          {cert.fileName && cert.fileUrl ? (
                            <a
                              href={cert.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-muted-foreground hover:underline mt-1 w-fit"
                              data-testid={`link-cert-file-${cert.id}`}
                            >
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="truncate">{cert.fileName}</span>
                              <Download className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <div className="mt-1">
                              <input
                                ref={cert.id === uploadingCertId ? uploadFileInputRef : undefined}
                                type="file"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleUploadCertFile(cert.id, file);
                                  e.target.value = "";
                                }}
                                data-testid={`input-cert-upload-${cert.id}`}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setUploadingCertId(cert.id);
                                  setTimeout(() => {
                                    const input = document.querySelector(`[data-testid="input-cert-upload-${cert.id}"]`) as HTMLInputElement;
                                    input?.click();
                                  }, 0);
                                }}
                                disabled={uploadingCertId === cert.id}
                                data-testid={`button-upload-cert-file-${cert.id}`}
                              >
                                {uploadingCertId === cert.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Upload className="h-3 w-3" />
                                )}
                                <span className="text-xs ml-1">Attach file</span>
                              </Button>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditCert(cert)}
                            data-testid={`button-edit-cert-${cert.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteCertMutation.mutate(cert.id)}
                            data-testid={`button-delete-cert-${cert.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipment">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
              <CardTitle className="text-base">Equipment Competencies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  value={equipmentInput}
                  onChange={(e) => setEquipmentInput(e.target.value)}
                  onKeyDown={handleEquipmentKeyDown}
                  placeholder="Type equipment name and press Enter..."
                  data-testid="input-equipment-name"
                />
                <Button
                  onClick={() => {
                    if (equipmentInput.trim()) {
                      addEquipmentMutation.mutate(equipmentInput.trim());
                    }
                  }}
                  disabled={addEquipmentMutation.isPending || !equipmentInput.trim()}
                  data-testid="button-add-equipment"
                >
                  {addEquipmentMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                  Add
                </Button>
              </div>

              {loadingEquipment ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-8 w-28" />
                </div>
              ) : equipment.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-equipment">No equipment competencies added yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {equipment.map((eq) => (
                    <Badge
                      key={eq.id}
                      variant="secondary"
                      className="gap-1 pl-3 pr-1.5 py-1"
                      data-testid={`badge-equipment-${eq.id}`}
                    >
                      {eq.equipmentName}
                      <button
                        onClick={() => removeEquipmentMutation.mutate(eq.id)}
                        className="ml-1 rounded-full p-0.5"
                        data-testid={`button-remove-equipment-${eq.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!verificationDialogSkill}
        onOpenChange={(open) => { if (!open) setVerificationDialogSkill(null); }}
      >
        <DialogContent data-testid="dialog-verification-details">
          <DialogHeader>
            <DialogTitle>Verification Details</DialogTitle>
            <DialogDescription>
              Skill verification information for {verificationDialogSkill?.skillName}
            </DialogDescription>
          </DialogHeader>
          {verificationDialogSkill && (
            <div className="space-y-3 pt-2">
              <div>
                <p className="text-xs text-muted-foreground">Verified By</p>
                <p className="text-sm font-medium" data-testid="text-verifier-name">
                  {verificationDialogSkill.verifiedByName || "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Verifier Role</p>
                <p className="text-sm font-medium" data-testid="text-verifier-role">
                  {verificationDialogSkill.verifiedByRole || "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Date Verified</p>
                <p className="text-sm font-medium" data-testid="text-verified-date">
                  {verificationDialogSkill.verifiedAt
                    ? new Date(verificationDialogSkill.verifiedAt).toLocaleDateString()
                    : "Unknown"}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingCert}
        onOpenChange={(open) => { if (!open) setEditingCert(null); }}
      >
        <DialogContent data-testid="dialog-edit-certification">
          <DialogHeader>
            <DialogTitle>Edit Certification</DialogTitle>
            <DialogDescription>
              Update the details for this certification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="edit-cert-name">Certification Name</Label>
              <Input
                id="edit-cert-name"
                value={editCertName}
                onChange={(e) => setEditCertName(e.target.value)}
                data-testid="input-edit-cert-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Issued Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "justify-start text-left font-normal",
                        !editCertIssuedDate && "text-muted-foreground"
                      )}
                      data-testid="input-edit-cert-issued-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editCertIssuedDate ? format(editCertIssuedDate, "MM/dd/yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editCertIssuedDate}
                      onSelect={setEditCertIssuedDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Expiry Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "justify-start text-left font-normal",
                        !editCertExpiryDate && "text-muted-foreground"
                      )}
                      data-testid="input-edit-cert-expiry-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editCertExpiryDate ? format(editCertExpiryDate, "MM/dd/yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editCertExpiryDate}
                      onSelect={setEditCertExpiryDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingCert(null)} data-testid="button-cancel-edit-cert">
                Cancel
              </Button>
              <Button onClick={handleSaveEditCert} disabled={savingEdit || !editCertName.trim()} data-testid="button-save-edit-cert">
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}