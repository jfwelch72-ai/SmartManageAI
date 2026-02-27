import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { getTradeDisplayName } from "@shared/tradeTypeUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Camera,
  X,
  Lock,
  Eye,
  EyeOff,
  Upload,
  ImageIcon,
  Trash2,
  Loader2,
  Pencil,
  Award,
  Star,
  ShieldCheck,
  FileText,
  TrendingUp,
} from "lucide-react";
import SkillsCertificationsTab from "@/components/SkillsCertificationsTab";
import PerformanceHistoryTab from "@/components/PerformanceHistoryTab";

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
  certificationName: string;
  issuedDate: string | null;
  expiryDate: string | null;
  fileUrl: string | null;
  fileName: string | null;
  status: string;
}

interface UserPhoto {
  id: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  objectKey: string | null;
  uploadedAt: string;
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Honolulu",
  "America/Phoenix",
  "America/Puerto_Rico",
  "Pacific/Guam",
  "America/Adak",
  "US/Samoa",
  "Pacific/Palau",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
];

export default function ProfilePage() {
  const { user, organizationName } = useAuth();
  const { toast } = useToast();

  const { data: tradeConfig } = useQuery<{ organization: { tradeType: string } }>({
    queryKey: ["/api/organization/trade-config"],
    enabled: !!user,
  });
  const orgTradeType = tradeConfig?.organization?.tradeType || "";
  const orgTradeLabel = orgTradeType ? getTradeDisplayName(orgTradeType as any) : "";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [timezone, setTimezone] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [tradeSpecialization, setTradeSpecialization] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [emergencyContactAddress, setEmergencyContactAddress] = useState("");
  const [emergencyContactEmail, setEmergencyContactEmail] = useState("");

  const [skillSearch, setSkillSearch] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "skills-certifications" | "performance-history">("profile");

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setEmail(user.email || "");
      setPhone(user.phone || "");
      setBirthdate(user.birthdate || "");
      setTimezone(user.timezone || "");
      setProfileDescription(user.profileDescription || "");
      setTradeSpecialization(user.tradeSpecialization || "");
      setEmploymentType(user.employmentType || "");
      setEmergencyContactName(user.emergencyContactName || "");
      setEmergencyContactPhone(user.emergencyContactPhone || "");
      setEmergencyContactAddress(user.emergencyContactAddress || "");
      setEmergencyContactEmail(user.emergencyContactEmail || "");
    }
  }, [user]);

  const { data: mySkills = [], isLoading: loadingSkills } = useQuery<UserSkill[]>({
    queryKey: ["/api/auth/my-skills"],
  });

  const { data: myCertifications = [], isLoading: loadingCerts } = useQuery<UserCertification[]>({
    queryKey: ["/api/auth/my-certifications"],
  });

  const { data: allSkills = [] } = useQuery<{ id: string; name: string; category: string | null }[]>({
    queryKey: ["/api/skills"],
  });

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/auth/profile", {
        firstName,
        lastName,
        phone,
        birthdate,
        timezone,
        profileDescription,
        tradeSpecialization,
        employmentType,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactAddress,
        emergencyContactEmail,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update profile", description: error.message, variant: "destructive" });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/auth/change-password", {
        currentPassword,
        newPassword,
      });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Password changed successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to change password", description: error.message, variant: "destructive" });
    },
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

  const { data: myPhotos = [], isLoading: loadingPhotos } = useQuery<UserPhoto[]>({
    queryKey: ["/api/auth/my-photos"],
  });

  const handleAvatarUpload = useCallback(async (file: File) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Only JPEG, PNG, GIF, and WebP are allowed.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum size is 5MB.", variant: "destructive" });
      return;
    }
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/auth/upload-avatar", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Avatar updated successfully" });
    } catch (error: any) {
      toast({ title: "Failed to upload avatar", description: error.message, variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
    }
  }, [toast]);

  const handlePhotosUpload = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    for (const file of fileArray) {
      if (!allowedTypes.includes(file.type)) {
        toast({ title: "Invalid file type", description: `${file.name}: Only JPEG, PNG, GIF, and WebP are allowed.`, variant: "destructive" });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: `${file.name}: Maximum size is 10MB.`, variant: "destructive" });
        return;
      }
    }
    setUploadingPhotos(true);
    try {
      const formData = new FormData();
      fileArray.forEach(file => formData.append("photos", file));
      const res = await fetch("/api/auth/upload-photos", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-photos"] });
      toast({ title: `${fileArray.length} photo${fileArray.length > 1 ? "s" : ""} uploaded successfully` });
    } catch (error: any) {
      toast({ title: "Failed to upload photos", description: error.message, variant: "destructive" });
    } finally {
      setUploadingPhotos(false);
    }
  }, [toast]);

  const deletePhotoMutation = useMutation({
    mutationFn: async (photoId: string) => {
      return await apiRequest("DELETE", `/api/auth/my-photos/${photoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-photos"] });
      toast({ title: "Photo deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete photo", description: error.message, variant: "destructive" });
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handlePhotosUpload(files);
  }, [handlePhotosUpload]);

  const handleSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && skillSearch.trim()) {
      e.preventDefault();
      addSkillMutation.mutate(skillSearch.trim());
    }
  };

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "All password fields are required", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "New passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    changePasswordMutation.mutate();
  };

  const filteredSuggestions = allSkills
    .filter(s => s.name.toLowerCase().includes(skillSearch.toLowerCase()))
    .filter(s => !mySkills.some(ms => ms.skillId === s.id))
    .slice(0, 8);

  const initials = user ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() : "";
  const accessLevel = user?.organizationId ? "Organization" : "Platform";
  const roleDisplay = user?.role?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Not specified";

  if (!user) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 p-4 md:p-6 max-w-7xl mx-auto overflow-auto h-full">
      <div className="w-full lg:w-72 xl:w-80 shrink-0 space-y-4">
        <Card>
          <CardContent className="pt-6 flex flex-col items-center text-center">
            <div className="relative mb-4">
              <Avatar className="h-24 w-24 border-4 border-primary/20">
                <AvatarImage src={user.avatarUrl || undefined} />
                <AvatarFallback className="text-2xl font-semibold bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleAvatarUpload(file);
                  e.target.value = "";
                }}
                data-testid="input-avatar-file"
              />
              <Button
                size="icon"
                variant="secondary"
                className="absolute bottom-0 right-0 h-7 w-7 rounded-full"
                onClick={() => avatarInputRef.current?.click()}
                disabled={uploadingAvatar}
                data-testid="button-change-avatar"
              >
                {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {profileDescription && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {profileDescription}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Organization & Access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Organization</p>
              <p className="text-sm font-medium">{organizationName || "Not specified"}</p>
            </div>
            {orgTradeLabel && (
              <div>
                <p className="text-xs text-muted-foreground">Trade</p>
                <p className="text-sm font-medium" data-testid="text-org-trade-type">{orgTradeLabel}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="text-sm font-medium">{roleDisplay}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Access Level</p>
              <Badge variant="outline" className="mt-0.5" data-testid="badge-access-level">{accessLevel}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              <button
                className="flex items-center gap-1.5 hover:underline text-left"
                onClick={() => setActiveTab("skills-certifications")}
                data-testid="link-skills-certifications"
              >
                <Award className="h-4 w-4" />
                Skills & Certifications
              </button>
            </CardTitle>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setActiveTab("skills-certifications")}
              data-testid="button-edit-skills"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingSkills ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
              </div>
            ) : mySkills.length === 0 ? (
              <p className="text-sm text-muted-foreground">No skills added yet</p>
            ) : (
              <div className="space-y-2">
                {mySkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between gap-2"
                    data-testid={`text-skill-sidebar-${skill.id}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm truncate">{skill.skillName}</span>
                      {skill.verificationStatus === "verified" && (
                        <ShieldCheck className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center shrink-0">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`h-3.5 w-3.5 ${
                            star <= (skill.starRating || 0)
                              ? "text-yellow-500 fill-yellow-500"
                              : "text-muted-foreground/40"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loadingCerts ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
              </div>
            ) : myCertifications.filter(c => {
              if (!c.expiryDate) return true;
              return new Date(c.expiryDate).getTime() > Date.now();
            }).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Certifications</p>
                {myCertifications.filter(c => {
                  if (!c.expiryDate) return true;
                  return new Date(c.expiryDate).getTime() > Date.now();
                }).map((cert) => {
                  const isExpiringSoon = cert.expiryDate && (() => {
                    const diff = (new Date(cert.expiryDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                    return diff > 0 && diff <= 30;
                  })();
                  return (
                    <div
                      key={cert.id}
                      className="flex items-center justify-between gap-2"
                      data-testid={`text-cert-sidebar-${cert.id}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-sm truncate">{cert.certificationName}</span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          isExpiringSoon
                            ? "bg-amber-500/15 text-amber-600 border-transparent text-xs no-default-hover-elevate"
                            : "bg-green-500/15 text-green-600 border-transparent text-xs no-default-hover-elevate"
                        }
                      >
                        {isExpiringSoon ? "Expiring Soon" : "Active"}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="hover-elevate cursor-pointer" onClick={() => setActiveTab("performance-history")} data-testid="card-performance-history">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4" />
                Performance & History
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Attendance, safety record, reviews, and productivity metrics
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">My Photos</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              ref={photosInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) handlePhotosUpload(e.target.files);
                e.target.value = "";
              }}
              data-testid="input-photos-file"
            />
            {loadingPhotos ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : myPhotos.length > 0 ? (
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {myPhotos.map((photo) => (
                  <div key={photo.id} className="relative group aspect-square rounded-md overflow-hidden" data-testid={`photo-item-${photo.id}`}>
                    <img
                      src={photo.fileUrl}
                      alt={photo.fileName}
                      className="w-full h-full object-cover"
                    />
                    <button
                      className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deletePhotoMutation.mutate(photo.id)}
                      data-testid={`button-delete-photo-${photo.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div
              className={`border-2 border-dashed rounded-md p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
              onClick={() => photosInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              data-testid="dropzone-photos"
            >
              {uploadingPhotos ? (
                <Loader2 className="h-8 w-8 text-muted-foreground/50 mb-2 animate-spin" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground/50 mb-2" />
              )}
              <p className="text-sm text-muted-foreground">
                {uploadingPhotos ? "Uploading..." : "Drag and drop photos here"}
              </p>
              <p className="text-xs text-muted-foreground">or click to browse</p>
            </div>
            <Button
              variant="outline"
              className="w-full mt-3"
              onClick={() => photosInputRef.current?.click()}
              disabled={uploadingPhotos}
              data-testid="button-upload-photos"
            >
              {uploadingPhotos ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Upload Photos
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 space-y-6 min-w-0">
        {activeTab === "skills-certifications" ? (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab("profile")}
                data-testid="button-back-to-profile"
              >
                Back to Profile
              </Button>
            </div>
            <SkillsCertificationsTab />
          </div>
        ) : activeTab === "performance-history" ? (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab("profile")}
                data-testid="button-back-to-profile-from-perf"
              >
                Back to Profile
              </Button>
              <h1 className="text-xl font-bold" data-testid="text-performance-title">Performance & History</h1>
            </div>
            <PerformanceHistoryTab />
          </div>
        ) : (
        <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-profile-title">My Profile</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              data-testid="input-first-name"
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last Name</Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              data-testid="input-last-name"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              value={email}
              disabled
              className="bg-muted/50"
              data-testid="input-email"
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone (Optional)</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="111-111-111"
              data-testid="input-phone"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Birthdate</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={`w-full justify-start text-left font-normal ${!birthdate ? "text-muted-foreground" : ""}`}
                  data-testid="input-birthdate"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {birthdate ? format(parse(birthdate, "yyyy-MM-dd", new Date()), "MM/dd/yyyy") : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={birthdate ? parse(birthdate, "yyyy-MM-dd", new Date()) : undefined}
                  onSelect={(date) => setBirthdate(date ? format(date, "yyyy-MM-dd") : "")}
                  defaultMonth={birthdate ? parse(birthdate, "yyyy-MM-dd", new Date()) : new Date()}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label htmlFor="timezone">Time Zone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id="timezone" data-testid="select-timezone">
                <SelectValue placeholder="Select timezone..." />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Organization</Label>
            <Input
              value={organizationName || ""}
              disabled
              className="bg-muted/50"
              placeholder="Select organization"
              data-testid="input-organization"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Input
              value={roleDisplay}
              disabled
              className="bg-muted/50"
              placeholder="Job title or role"
              data-testid="input-role"
            />
          </div>
          <div>
            <Label>Access Level</Label>
            <Input
              value={accessLevel}
              disabled
              className="bg-muted/50"
              data-testid="input-access-level"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="tradeSpecialization">Trade / Specialization</Label>
            <Input
              id="tradeSpecialization"
              value={tradeSpecialization}
              onChange={(e) => setTradeSpecialization(e.target.value)}
              placeholder="e.g. Finish Carpentry, Electrical, Plumbing"
              data-testid="input-trade-specialization"
            />
          </div>
          <div>
            <Label htmlFor="employmentType">Employment Type</Label>
            <Select value={employmentType} onValueChange={setEmploymentType}>
              <SelectTrigger id="employmentType" data-testid="select-employment-type">
                <SelectValue placeholder="Select employment type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL_TIME">Full Time</SelectItem>
                <SelectItem value="PART_TIME">Part Time</SelectItem>
                <SelectItem value="CONTRACT">Contract</SelectItem>
                <SelectItem value="TEMPORARY">Temporary</SelectItem>
                <SelectItem value="SEASONAL">Seasonal</SelectItem>
                <SelectItem value="PER_DIEM">Per Diem</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border-t pt-4 mt-2">
          <h3 className="text-sm font-semibold mb-3" data-testid="text-emergency-contact-title">Emergency Contact</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="emergencyContactName">Name</Label>
              <Input
                id="emergencyContactName"
                value={emergencyContactName}
                onChange={(e) => setEmergencyContactName(e.target.value)}
                placeholder="Full name"
                data-testid="input-emergency-contact-name"
              />
            </div>
            <div>
              <Label htmlFor="emergencyContactPhone">Phone</Label>
              <Input
                id="emergencyContactPhone"
                value={emergencyContactPhone}
                onChange={(e) => setEmergencyContactPhone(e.target.value)}
                placeholder="Phone number"
                data-testid="input-emergency-contact-phone"
              />
            </div>
            <div>
              <Label htmlFor="emergencyContactEmail">Email Address</Label>
              <Input
                id="emergencyContactEmail"
                value={emergencyContactEmail}
                onChange={(e) => setEmergencyContactEmail(e.target.value)}
                placeholder="Email address"
                data-testid="input-emergency-contact-email"
              />
            </div>
            <div>
              <Label htmlFor="emergencyContactAddress">Address</Label>
              <Input
                id="emergencyContactAddress"
                value={emergencyContactAddress}
                onChange={(e) => setEmergencyContactAddress(e.target.value)}
                placeholder="Street address, city, state, zip"
                data-testid="input-emergency-contact-address"
              />
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="profileDescription">Profile Description</Label>
          <Textarea
            id="profileDescription"
            value={profileDescription}
            onChange={(e) => setProfileDescription(e.target.value)}
            placeholder="Write a brief description about yourself, your experience, and expertise..."
            rows={5}
            className="resize-none"
            data-testid="textarea-profile-description"
          />
        </div>

        <Button
          onClick={() => updateProfileMutation.mutate()}
          disabled={updateProfileMutation.isPending}
          data-testid="button-update-profile"
        >
          {updateProfileMutation.isPending ? "Updating..." : "Update Profile"}
        </Button>

        <div className="border-t pt-6 mt-6">
          <h2 className="text-xl font-bold mb-4" data-testid="text-change-password-title">Change Password</h2>

          <div className="space-y-4 max-w-lg">
            <div>
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  className="pr-10"
                  data-testid="input-current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  data-testid="button-toggle-current-password"
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter your new password"
                  className="pr-10"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  data-testid="button-toggle-new-password"
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Password must be at least 8 characters with uppercase, lowercase, and number
              </p>
            </div>

            <div>
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  className="pr-10"
                  data-testid="input-confirm-password"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  data-testid="button-toggle-confirm-password"
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              variant="destructive"
              onClick={handleChangePassword}
              disabled={changePasswordMutation.isPending}
              data-testid="button-change-password"
            >
              <Lock className="h-4 w-4 mr-2" />
              {changePasswordMutation.isPending ? "Changing..." : "Change Password"}
            </Button>
          </div>
        </div>
        </div>
        )}
      </div>
    </div>
  );
}
