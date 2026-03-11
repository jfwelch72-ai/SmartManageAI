import { Dispatch, SetStateAction } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Globe,
  Image,
  Palette,
  Target,
  Share2,
  Check,
  RefreshCw,
  Save,
  Upload,
  LayoutTemplate,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok } from "react-icons/si";
import type { Website, SocialLinks, WebsiteFormState } from "./types";
import { WEBSITE_TEMPLATES } from "./types";

interface WebsiteSetupTabProps {
  website: Website | undefined | null;
  websiteForm: WebsiteFormState;
  setWebsiteForm: Dispatch<SetStateAction<WebsiteFormState>>;
  selectedTemplateId: string | null;
  onTemplateSelect: (templateId: string) => void;
  onSave: () => void;
  saveIsPending: boolean;
  socialForm: SocialLinks;
  setSocialForm: Dispatch<SetStateAction<SocialLinks>>;
  socialLinks: SocialLinks | undefined;
}

export default function WebsiteSetupTab({
  website,
  websiteForm,
  setWebsiteForm,
  selectedTemplateId,
  onTemplateSelect,
  onSave,
  saveIsPending,
  socialForm,
  setSocialForm,
  socialLinks,
}: WebsiteSetupTabProps) {
  const { toast } = useToast();

  const saveSocialMutation = useMutation({
    mutationFn: async (data: SocialLinks) => {
      return await apiRequest("POST", "/api/website/social", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/website/social"] });
      toast({ title: "Social links saved successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error saving social links", description: error.message, variant: "destructive" });
    }
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Basic Settings
            </CardTitle>
            <CardDescription>Configure your website's basic information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="siteTitle">Site Title</Label>
              <Input
                id="siteTitle"
                value={websiteForm.siteTitle || website?.siteTitle || ""}
                onChange={(e) => setWebsiteForm(prev => ({ ...prev, siteTitle: e.target.value }))}
                placeholder="Your Company Name"
                data-testid="input-site-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siteTagline">Tagline</Label>
              <Input
                id="siteTagline"
                value={websiteForm.siteTagline || website?.siteTagline || ""}
                onChange={(e) => setWebsiteForm(prev => ({ ...prev, siteTagline: e.target.value }))}
                placeholder="Building Excellence Since 1990"
                data-testid="input-site-tagline"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input
                id="contactEmail"
                type="email"
                value={websiteForm.contactEmail || website?.contactEmail || ""}
                onChange={(e) => setWebsiteForm(prev => ({ ...prev, contactEmail: e.target.value }))}
                placeholder="info@yourcompany.com"
                data-testid="input-contact-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact Phone</Label>
              <Input
                id="contactPhone"
                value={websiteForm.contactPhone || website?.contactPhone || ""}
                onChange={(e) => setWebsiteForm(prev => ({ ...prev, contactPhone: e.target.value }))}
                placeholder="(555) 123-4567"
                data-testid="input-contact-phone"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="h-5 w-5" />
              Website Logo & Favicon
            </CardTitle>
            <CardDescription>Upload your brand logo and site favicon</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Website Logo</Label>
                <label
                  htmlFor="logo-upload"
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md p-4 cursor-pointer hover-elevate"
                  style={{ minHeight: 100 }}
                  data-testid="upload-logo"
                >
                  {websiteForm.logoUrl ? (
                    <>
                      <img
                        src={websiteForm.logoUrl}
                        alt="Logo"
                        style={{ maxHeight: 60, maxWidth: '100%', objectFit: 'contain' }}
                      />
                      <span className="text-xs text-muted-foreground">Replace logo</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Upload logo</span>
                    </>
                  )}
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const formData = new FormData();
                      formData.append('image', file);
                      try {
                        const response = await fetch('/api/website/upload-image', {
                          method: 'POST',
                          body: formData,
                          credentials: 'include'
                        });
                        if (!response.ok) throw new Error('Upload failed');
                        const data = await response.json();
                        setWebsiteForm(prev => ({ ...prev, logoUrl: data.url }));
                        toast({ title: "Logo uploaded successfully" });
                      } catch (err: any) {
                        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                      }
                    }}
                  />
                </label>
              </div>
              <div className="space-y-2">
                <Label>Favicon</Label>
                <label
                  htmlFor="favicon-upload"
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-md p-4 cursor-pointer hover-elevate"
                  style={{ minHeight: 100 }}
                  data-testid="upload-favicon"
                >
                  {websiteForm.faviconUrl ? (
                    <>
                      <img
                        src={websiteForm.faviconUrl}
                        alt="Favicon"
                        style={{ maxHeight: 60, maxWidth: '100%', objectFit: 'contain' }}
                      />
                      <span className="text-xs text-muted-foreground">Replace favicon</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Upload favicon</span>
                    </>
                  )}
                  <input
                    id="favicon-upload"
                    type="file"
                    accept="image/*,.ico"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const formData = new FormData();
                      formData.append('image', file);
                      try {
                        const response = await fetch('/api/website/upload-image', {
                          method: 'POST',
                          body: formData,
                          credentials: 'include'
                        });
                        if (!response.ok) throw new Error('Upload failed');
                        const data = await response.json();
                        setWebsiteForm(prev => ({ ...prev, faviconUrl: data.url }));
                        toast({ title: "Favicon uploaded successfully" });
                      } catch (err: any) {
                        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="logoHeight">Logo Height</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="logoHeight"
                  type="number"
                  min={20}
                  max={300}
                  value={websiteForm.logoHeight}
                  onChange={(e) => setWebsiteForm(prev => ({ ...prev, logoHeight: parseInt(e.target.value) || 55 }))}
                  data-testid="input-logo-height"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">px</span>
              </div>
              <p className="text-xs text-muted-foreground">Default: 55px</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Branding & Colors
            </CardTitle>
            <CardDescription>Customize your website's look and feel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium text-sm">Choose Template</h4>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {WEBSITE_TEMPLATES.map((template) => {
                  const isSelected = selectedTemplateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => onTemplateSelect(template.id)}
                      className={`relative text-left rounded-md border-2 p-3 transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-border hover-elevate"}`}
                      data-testid={`template-${template.id}`}
                    >
                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <Check className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className="mb-2 h-16 rounded-sm overflow-hidden relative" style={{ background: template.previewColors[3] }}>
                        <div className="absolute top-0 left-0 right-0 h-4 flex items-center px-2 gap-1" style={{ background: template.previewColors[1] }}>
                          <div className="w-1 h-1 rounded-full" style={{ background: template.previewColors[4] }} />
                          <div className="w-1 h-1 rounded-full" style={{ background: template.previewColors[4] }} />
                          <div className="w-1 h-1 rounded-full" style={{ background: template.previewColors[4] }} />
                        </div>
                        <div className="absolute top-5 left-2 right-2 h-5 rounded-sm" style={{ background: template.previewColors[0], opacity: 0.9 }} />
                        <div className="absolute bottom-1 left-2 flex gap-1">
                          <div className="w-6 h-2 rounded-sm" style={{ background: template.previewColors[2] }} />
                          <div className="w-4 h-2 rounded-sm" style={{ background: template.previewColors[1], opacity: 0.5 }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium">{template.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-snug">{template.description}</p>
                      <div className="flex gap-1 mt-2">
                        {template.previewColors.slice(0, 3).map((color, i) => (
                          <div key={i} className="w-4 h-4 rounded-full border border-border/50" style={{ background: color }} />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t">
              <h4 className="font-medium text-sm mb-3">Custom Colors</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="primaryColor">Primary</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      id="primaryColor"
                      value={websiteForm.primaryColor || website?.primaryColor || "#3B82F6"}
                      onChange={(e) => { setWebsiteForm(prev => ({ ...prev, primaryColor: e.target.value, templateId: "" })); }}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-primary-color"
                    />
                    <Input 
                      value={websiteForm.primaryColor || website?.primaryColor || "#3B82F6"} 
                      onChange={(e) => { setWebsiteForm(prev => ({ ...prev, primaryColor: e.target.value, templateId: "" })); }}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="secondaryColor">Secondary</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      id="secondaryColor"
                      value={websiteForm.secondaryColor || website?.secondaryColor || "#1E40AF"}
                      onChange={(e) => { setWebsiteForm(prev => ({ ...prev, secondaryColor: e.target.value, templateId: "" })); }}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-secondary-color"
                    />
                    <Input 
                      value={websiteForm.secondaryColor || website?.secondaryColor || "#1E40AF"} 
                      onChange={(e) => { setWebsiteForm(prev => ({ ...prev, secondaryColor: e.target.value, templateId: "" })); }}
                      className="flex-1"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accentColor">Accent</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      id="accentColor"
                      value={websiteForm.accentColor || website?.accentColor || "#F59E0B"}
                      onChange={(e) => { setWebsiteForm(prev => ({ ...prev, accentColor: e.target.value, templateId: "" })); }}
                      className="w-10 h-10 rounded border cursor-pointer"
                      data-testid="input-accent-color"
                    />
                    <Input 
                      value={websiteForm.accentColor || website?.accentColor || "#F59E0B"} 
                      onChange={(e) => { setWebsiteForm(prev => ({ ...prev, accentColor: e.target.value, templateId: "" })); }}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              SEO Settings
            </CardTitle>
            <CardDescription>Optimize your website for search engines</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="metaTitle">Meta Title (60 characters max)</Label>
              <Input
                id="metaTitle"
                value={websiteForm.metaTitle || website?.metaTitle || ""}
                onChange={(e) => setWebsiteForm(prev => ({ ...prev, metaTitle: e.target.value }))}
                maxLength={60}
                placeholder="Your Company | Quality Construction Services"
                data-testid="input-meta-title"
              />
              <p className="text-xs text-muted-foreground">
                {(websiteForm.metaTitle || website?.metaTitle || "").length}/60 characters
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="metaDescription">Meta Description (160 characters max)</Label>
              <Textarea
                id="metaDescription"
                value={websiteForm.metaDescription || website?.metaDescription || ""}
                onChange={(e) => setWebsiteForm(prev => ({ ...prev, metaDescription: e.target.value }))}
                maxLength={160}
                placeholder="We provide top-quality construction services in the greater metro area. Contact us for a free estimate."
                data-testid="input-meta-description"
              />
              <p className="text-xs text-muted-foreground">
                {(websiteForm.metaDescription || website?.metaDescription || "").length}/160 characters
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ogImageUrl">Social Share Image URL</Label>
              <Input
                id="ogImageUrl"
                value={websiteForm.ogImageUrl || website?.ogImageUrl || ""}
                onChange={(e) => setWebsiteForm(prev => ({ ...prev, ogImageUrl: e.target.value }))}
                placeholder="https://example.com/share-image.jpg"
                data-testid="input-og-image-url"
              />
              <p className="text-xs text-muted-foreground">
                Image displayed when your site is shared on social media (recommended: 1200×630px)
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button 
              onClick={onSave}
              disabled={saveIsPending}
              data-testid="button-save-settings"
            >
              {saveIsPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save Settings
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Social Media Links
          </CardTitle>
          <CardDescription>Connect your social media profiles to display on your website</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <SiFacebook className="h-4 w-4 text-blue-600" />
                Facebook
              </Label>
              <Input
                value={socialForm.facebookUrl || socialLinks?.facebookUrl || ""}
                onChange={(e) => setSocialForm(prev => ({ ...prev, facebookUrl: e.target.value }))}
                placeholder="https://facebook.com/yourcompany"
                data-testid="input-facebook-url"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <SiInstagram className="h-4 w-4 text-pink-600" />
                Instagram
              </Label>
              <Input
                value={socialForm.instagramUrl || socialLinks?.instagramUrl || ""}
                onChange={(e) => setSocialForm(prev => ({ ...prev, instagramUrl: e.target.value }))}
                placeholder="https://instagram.com/yourcompany"
                data-testid="input-instagram-url"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <SiLinkedin className="h-4 w-4 text-blue-700" />
                LinkedIn
              </Label>
              <Input
                value={socialForm.linkedinUrl || socialLinks?.linkedinUrl || ""}
                onChange={(e) => setSocialForm(prev => ({ ...prev, linkedinUrl: e.target.value }))}
                placeholder="https://linkedin.com/company/yourcompany"
                data-testid="input-linkedin-url"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <SiYoutube className="h-4 w-4 text-red-600" />
                YouTube
              </Label>
              <Input
                value={socialForm.youtubeUrl || socialLinks?.youtubeUrl || ""}
                onChange={(e) => setSocialForm(prev => ({ ...prev, youtubeUrl: e.target.value }))}
                placeholder="https://youtube.com/@yourcompany"
                data-testid="input-youtube-url"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <SiTiktok className="h-4 w-4" />
                TikTok
              </Label>
              <Input
                value={socialForm.tiktokUrl || socialLinks?.tiktokUrl || ""}
                onChange={(e) => setSocialForm(prev => ({ ...prev, tiktokUrl: e.target.value }))}
                placeholder="https://tiktok.com/@yourcompany"
                data-testid="input-tiktok-url"
              />
            </div>
          </div>
          <Button 
            className="w-full mt-4"
            onClick={() => saveSocialMutation.mutate(socialForm)}
            disabled={saveSocialMutation.isPending}
            data-testid="button-save-social"
          >
            {saveSocialMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Save Social Links
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
