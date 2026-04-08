import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { format, parse } from "date-fns";
import { CalendarIcon, Camera, Loader2 } from "lucide-react";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "America/Honolulu", "America/Phoenix", "America/Puerto_Rico",
  "Pacific/Guam", "America/Adak", "US/Samoa", "Pacific/Palau",
  "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Australia/Sydney",
];

export default function ProfileEditSection() {
  const { user, organizationName } = useAuth();
  const { toast } = useToast();

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
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);

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

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PATCH", "/api/auth/profile", {
        firstName, lastName, phone, birthdate, timezone,
        profileDescription, tradeSpecialization, employmentType,
        emergencyContactName, emergencyContactPhone,
        emergencyContactAddress, emergencyContactEmail,
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
    } catch (error: unknown) {
      toast({ title: "Failed to upload avatar", description: error instanceof Error ? error.message : "Upload failed", variant: "destructive" });
    } finally {
      setUploadingAvatar(false);
    }
  }, [toast]);

  const { data: myPermissions } = useQuery<{ appliedPresetName?: string | null }>({
    queryKey: ["/api/dashboard/my-permissions"],
    staleTime: 60000,
    enabled: !!user,
  });

  if (!user) return null;

  const initials = `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase();
  const accessLevel = user.organizationId ? "Organization" : "Platform";
  const roleDisplay = user.role?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Not specified";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-profile">Profile & Account</h2>
        <p className="text-muted-foreground mt-1">Manage your personal information and account details</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="relative">
              <Avatar className="h-20 w-20 border-4 border-primary/20">
                <AvatarImage src={user.avatarUrl || undefined} />
                <AvatarFallback className="text-xl font-semibold bg-primary text-primary-foreground">
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
            <div>
              <p className="text-lg font-semibold" data-testid="text-profile-name">
                {`${user.firstName || ""} ${user.lastName || ""}`.trim() || "No name set"}
              </p>
              <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{user.email}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="secondary" data-testid="badge-profile-role">{user.role}</Badge>
                {myPermissions?.appliedPresetName && (
                  <Badge variant="outline" data-testid="badge-profile-preset">{myPermissions.appliedPresetName}</Badge>
                )}
              </div>
            </div>
          </div>
          <Separator className="my-4" />

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" data-testid="input-first-name" />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" data-testid="input-last-name" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" value={email} disabled className="bg-muted/50" data-testid="input-email" />
              </div>
              <div>
                <Label htmlFor="phone">Phone (Optional)</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15551234567" data-testid="input-phone" />
                <p className="text-xs text-muted-foreground mt-1">E.164 format required for SMS alerts (e.g. +15551234567)</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Birthdate</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={`w-full justify-start text-left font-normal ${!birthdate ? "text-muted-foreground" : ""}`} data-testid="input-birthdate">
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
                <Input value={organizationName || ""} disabled className="bg-muted/50" data-testid="input-organization" />
              </div>
              <div>
                <Label>Role</Label>
                <Input value={roleDisplay} disabled className="bg-muted/50" data-testid="input-role" />
              </div>
              <div>
                <Label>Access Level</Label>
                <Input value={accessLevel} disabled className="bg-muted/50" data-testid="input-access-level" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="tradeSpecialization">Trade / Specialization</Label>
                <Input id="tradeSpecialization" value={tradeSpecialization} onChange={(e) => setTradeSpecialization(e.target.value)} placeholder="e.g. Finish Carpentry, Electrical, Plumbing" data-testid="input-trade-specialization" />
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
                  <Input id="emergencyContactName" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} placeholder="Full name" data-testid="input-emergency-contact-name" />
                </div>
                <div>
                  <Label htmlFor="emergencyContactPhone">Phone</Label>
                  <Input id="emergencyContactPhone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} placeholder="Phone number" data-testid="input-emergency-contact-phone" />
                </div>
                <div>
                  <Label htmlFor="emergencyContactEmail">Email Address</Label>
                  <Input id="emergencyContactEmail" value={emergencyContactEmail} onChange={(e) => setEmergencyContactEmail(e.target.value)} placeholder="Email address" data-testid="input-emergency-contact-email" />
                </div>
                <div>
                  <Label htmlFor="emergencyContactAddress">Address</Label>
                  <Input id="emergencyContactAddress" value={emergencyContactAddress} onChange={(e) => setEmergencyContactAddress(e.target.value)} placeholder="Street address, city, state, zip" data-testid="input-emergency-contact-address" />
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="profileDescription">Profile Description</Label>
              <Textarea id="profileDescription" value={profileDescription} onChange={(e) => setProfileDescription(e.target.value)} placeholder="Write a brief description about yourself, your experience, and expertise..." rows={4} className="resize-none" data-testid="textarea-profile-description" />
            </div>

            <Button onClick={() => updateProfileMutation.mutate()} disabled={updateProfileMutation.isPending} data-testid="button-update-profile">
              {updateProfileMutation.isPending ? "Updating..." : "Update Profile"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}