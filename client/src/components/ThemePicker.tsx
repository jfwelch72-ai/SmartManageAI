import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Palette, Check, Trash2, AlertTriangle, Sun, Moon, Building2, X } from "lucide-react";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}

function ColorInput({ label, value, onChange, description }: ColorInputProps) {
  const hslToHex = (hsl: string): string => {
    const parts = hsl.trim().split(/\s+/);
    if (parts.length !== 3) return "#888888";
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1].replace('%', '')) / 100;
    const l = parseFloat(parts[2].replace('%', '')) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
    else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
    else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
    else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const hexToHsl = (hex: string): string => {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
        case g: h = ((b - r) / d + 2) * 60; break;
        case b: h = ((r - g) / d + 4) * 60; break;
      }
    }
    return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <input
          type="color"
          value={hslToHex(value)}
          onChange={(e) => onChange(hexToHsl(e.target.value))}
          className="w-10 h-8 rounded border cursor-pointer"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs h-8"
          placeholder="220 14% 96%"
        />
      </div>
      {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
    </div>
  );
}

interface PresetColors {
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  card: string;
  cardForeground: string;
  border: string;
}

interface PresetPalette {
  name: string;
  light: PresetColors;
  dark: PresetColors;
}

interface OrgDefaultPaletteInput {
  paletteName?: string;
  name?: string;
  light?: Partial<PresetColors>;
  dark?: Partial<PresetColors>;
  lightPrimary?: string;
  lightPrimaryForeground?: string;
  lightSecondary?: string;
  lightSecondaryForeground?: string;
  lightAccent?: string;
  lightAccentForeground?: string;
  lightBackground?: string;
  lightForeground?: string;
  lightMuted?: string;
  lightMutedForeground?: string;
  lightCard?: string;
  lightCardForeground?: string;
  lightBorder?: string;
  darkPrimary?: string;
  darkPrimaryForeground?: string;
  darkSecondary?: string;
  darkSecondaryForeground?: string;
  darkAccent?: string;
  darkAccentForeground?: string;
  darkBackground?: string;
  darkForeground?: string;
  darkMuted?: string;
  darkMutedForeground?: string;
  darkCard?: string;
  darkCardForeground?: string;
  darkBorder?: string;
}

interface PresetPaletteCardProps {
  name: string;
  colors: { light: Record<string, string>; dark: Record<string, string> };
  isSelected?: boolean;
  onSelect: () => void;
}

function PresetPaletteCard({ name, colors, isSelected, onSelect }: PresetPaletteCardProps) {
  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all hover-elevate",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={onSelect}
      data-testid={`preset-${name.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">{name}</span>
          {isSelected && <Check className="w-4 h-4 text-primary" />}
        </div>
        <div className="flex gap-1">
          <div className="w-6 h-6 rounded" style={{ backgroundColor: `hsl(${colors.light.primary})` }} />
          <div className="w-6 h-6 rounded" style={{ backgroundColor: `hsl(${colors.light.secondary})` }} />
          <div className="w-6 h-6 rounded" style={{ backgroundColor: `hsl(${colors.light.accent})` }} />
          <div className="w-6 h-6 rounded border" style={{ backgroundColor: `hsl(${colors.light.background})` }} />
        </div>
      </CardContent>
    </Card>
  );
}

export function ThemePicker() {
  const { 
    permissions, 
    activePalette, 
    orgPalette,
    isOrgDefault,
    savedPalettes, 
    presetPalettes,
    savePalette,
    saveOrgPalette,
    deactivateOrgPalette,
    activatePalette,
    deactivatePalette,
    deletePalette,
    isSavingPalette,
    applyPaletteToDOM
  } = useDashboardCustomization();

  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("presets");
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");
  const [paletteName, setPaletteName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [customColors, setCustomColors] = useState({
    lightPrimary: "222 47% 11%",
    lightPrimaryForeground: "210 40% 98%",
    lightSecondary: "210 40% 96%",
    lightSecondaryForeground: "222 47% 11%",
    lightAccent: "210 40% 96%",
    lightAccentForeground: "222 47% 11%",
    lightBackground: "0 0% 100%",
    lightForeground: "222 47% 11%",
    lightMuted: "210 40% 96%",
    lightMutedForeground: "215 16% 47%",
    lightCard: "0 0% 100%",
    lightCardForeground: "222 47% 11%",
    lightBorder: "214 32% 91%",
    darkPrimary: "210 40% 98%",
    darkPrimaryForeground: "222 47% 11%",
    darkSecondary: "217 33% 17%",
    darkSecondaryForeground: "210 40% 98%",
    darkAccent: "217 33% 17%",
    darkAccentForeground: "210 40% 98%",
    darkBackground: "222 47% 11%",
    darkForeground: "210 40% 98%",
    darkMuted: "217 33% 17%",
    darkMutedForeground: "215 20% 65%",
    darkCard: "222 47% 11%",
    darkCardForeground: "210 40% 98%",
    darkBorder: "217 33% 17%",
  });

  const handleSelectPreset = async (presetKey: string) => {
    const preset = presetPalettes[presetKey];
    if (!preset) return;
    
    await savePalette({
      paletteName: preset.name,
      isPreset: true,
      setActive: true,
      lightPrimary: preset.light.primary,
      lightPrimaryForeground: preset.light.primaryForeground,
      lightSecondary: preset.light.secondary,
      lightSecondaryForeground: preset.light.secondaryForeground,
      lightAccent: preset.light.accent,
      lightAccentForeground: preset.light.accentForeground,
      lightBackground: preset.light.background,
      lightForeground: preset.light.foreground,
      lightMuted: preset.light.muted,
      lightMutedForeground: preset.light.mutedForeground,
      lightCard: preset.light.card,
      lightCardForeground: preset.light.cardForeground,
      lightBorder: preset.light.border,
      darkPrimary: preset.dark.primary,
      darkPrimaryForeground: preset.dark.primaryForeground,
      darkSecondary: preset.dark.secondary,
      darkSecondaryForeground: preset.dark.secondaryForeground,
      darkAccent: preset.dark.accent,
      darkAccentForeground: preset.dark.accentForeground,
      darkBackground: preset.dark.background,
      darkForeground: preset.dark.foreground,
      darkMuted: preset.dark.muted,
      darkMutedForeground: preset.dark.mutedForeground,
      darkCard: preset.dark.card,
      darkCardForeground: preset.dark.cardForeground,
      darkBorder: preset.dark.border,
    });
  };

  const handleSaveCustom = async () => {
    if (!paletteName.trim()) return;
    await savePalette({
      paletteName: paletteName.trim(),
      isPreset: false,
      setActive: true,
      ...customColors,
    });
    setPaletteName("");
  };

  const handleUseDefault = async () => {
    await deactivatePalette();
    const isDark = document.documentElement.classList.contains('dark');
    if (orgPalette) {
      applyPaletteToDOM(orgPalette, isDark);
    } else {
      applyPaletteToDOM(null, isDark);
    }
  };

  const handleSetOrgDefault = async (palette: OrgDefaultPaletteInput) => {
    await saveOrgPalette({
      paletteName: palette.paletteName || palette.name || "Organization Default",
      lightPrimary: palette.lightPrimary || palette.light?.primary,
      lightPrimaryForeground: palette.lightPrimaryForeground || palette.light?.primaryForeground,
      lightSecondary: palette.lightSecondary || palette.light?.secondary,
      lightSecondaryForeground: palette.lightSecondaryForeground || palette.light?.secondaryForeground,
      lightAccent: palette.lightAccent || palette.light?.accent,
      lightAccentForeground: palette.lightAccentForeground || palette.light?.accentForeground,
      lightBackground: palette.lightBackground || palette.light?.background,
      lightForeground: palette.lightForeground || palette.light?.foreground,
      lightMuted: palette.lightMuted || palette.light?.muted,
      lightMutedForeground: palette.lightMutedForeground || palette.light?.mutedForeground,
      lightCard: palette.lightCard || palette.light?.card,
      lightCardForeground: palette.lightCardForeground || palette.light?.cardForeground,
      lightBorder: palette.lightBorder || palette.light?.border,
      darkPrimary: palette.darkPrimary || palette.dark?.primary,
      darkPrimaryForeground: palette.darkPrimaryForeground || palette.dark?.primaryForeground,
      darkSecondary: palette.darkSecondary || palette.dark?.secondary,
      darkSecondaryForeground: palette.darkSecondaryForeground || palette.dark?.secondaryForeground,
      darkAccent: palette.darkAccent || palette.dark?.accent,
      darkAccentForeground: palette.darkAccentForeground || palette.dark?.accentForeground,
      darkBackground: palette.darkBackground || palette.dark?.background,
      darkForeground: palette.darkForeground || palette.dark?.foreground,
      darkMuted: palette.darkMuted || palette.dark?.muted,
      darkMutedForeground: palette.darkMutedForeground || palette.dark?.mutedForeground,
      darkCard: palette.darkCard || palette.dark?.card,
      darkCardForeground: palette.darkCardForeground || palette.dark?.cardForeground,
      darkBorder: palette.darkBorder || palette.dark?.border,
    });
  };

  const handleRemoveOrgDefault = async () => {
    await deactivateOrgPalette();
  };

  const handleDeletePalette = async () => {
    if (deleteId) {
      await deletePalette(deleteId);
      setDeleteId(null);
    }
  };

  const updateColor = (key: keyof typeof customColors) => (value: string) => {
    setCustomColors(prev => ({ ...prev, [key]: value }));
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" data-testid="button-theme-picker">
            <Palette className="w-4 h-4 mr-2" />
            Theme
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Color Scheme</DialogTitle>
            <DialogDescription>
              Customize your dashboard colors. All themes meet WCAG AA accessibility standards.
            </DialogDescription>
          </DialogHeader>

          {isOrgDefault && (
            <div className="flex items-center gap-2 p-3 bg-blue-500/10 rounded-lg" data-testid="org-theme-indicator">
              <Building2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Using organization default theme{orgPalette?.paletteName ? `: ${orgPalette.paletteName}` : ""}
              </p>
            </div>
          )}

          {isAdmin && orgPalette && (
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg" data-testid="org-theme-admin-controls">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">
                  Org default: <span className="font-medium text-foreground">{orgPalette.paletteName}</span>
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={handleRemoveOrgDefault}
                disabled={isSavingPalette}
                data-testid="button-remove-org-default"
              >
                <X className="w-3 h-3 mr-1" />
                Remove
              </Button>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="presets" className="flex-1">Presets</TabsTrigger>
              <TabsTrigger value="custom" className="flex-1">Custom</TabsTrigger>
              <TabsTrigger value="saved" className="flex-1">Saved ({savedPalettes.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="presets" className="mt-4">
              <div className="grid grid-cols-2 gap-3">
                {(Object.entries(presetPalettes) as [string, PresetPalette][]).map(([key, preset]) => (
                  <PresetPaletteCard
                    key={key}
                    name={preset.name}
                    colors={preset}
                    isSelected={activePalette?.paletteName === preset.name}
                    onSelect={() => handleSelectPreset(key)}
                  />
                ))}
              </div>
              {isAdmin && (
                <>
                  <Separator className="my-4" />
                  <p className="text-xs text-muted-foreground mb-2">Select a preset above, then set it as the org default:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(presetPalettes) as [string, PresetPalette][]).map(([key, preset]) => (
                      <Button
                        key={key}
                        size="sm"
                        variant="outline"
                        className="text-xs justify-start"
                        onClick={() => handleSetOrgDefault({ name: preset.name, ...preset })}
                        disabled={isSavingPalette}
                        data-testid={`button-org-default-${key}`}
                      >
                        <Building2 className="w-3 h-3 mr-1 shrink-0" />
                        {preset.name}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              <Separator className="my-4" />
              <Button variant="outline" className="w-full" onClick={handleUseDefault} data-testid="button-use-default">
                {orgPalette ? "Use Organization Default" : "Use System Default"}
              </Button>
            </TabsContent>

            <TabsContent value="custom" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Preview Mode</Label>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant={previewMode === "light" ? "default" : "outline"}
                      onClick={() => setPreviewMode("light")}
                    >
                      <Sun className="w-4 h-4 mr-1" /> Light
                    </Button>
                    <Button 
                      size="sm" 
                      variant={previewMode === "dark" ? "default" : "outline"}
                      onClick={() => setPreviewMode("dark")}
                    >
                      <Moon className="w-4 h-4 mr-1" /> Dark
                    </Button>
                  </div>
                </div>

                <ScrollArea className="h-[300px] pr-4">
                  <div className="grid grid-cols-2 gap-4">
                    {previewMode === "light" ? (
                      <>
                        <ColorInput label="Primary" value={customColors.lightPrimary} onChange={updateColor("lightPrimary")} description="Main brand color" />
                        <ColorInput label="Primary Foreground" value={customColors.lightPrimaryForeground} onChange={updateColor("lightPrimaryForeground")} description="Text on primary" />
                        <ColorInput label="Secondary" value={customColors.lightSecondary} onChange={updateColor("lightSecondary")} />
                        <ColorInput label="Secondary Foreground" value={customColors.lightSecondaryForeground} onChange={updateColor("lightSecondaryForeground")} />
                        <ColorInput label="Accent" value={customColors.lightAccent} onChange={updateColor("lightAccent")} />
                        <ColorInput label="Accent Foreground" value={customColors.lightAccentForeground} onChange={updateColor("lightAccentForeground")} />
                        <ColorInput label="Background" value={customColors.lightBackground} onChange={updateColor("lightBackground")} />
                        <ColorInput label="Foreground" value={customColors.lightForeground} onChange={updateColor("lightForeground")} />
                        <ColorInput label="Muted" value={customColors.lightMuted} onChange={updateColor("lightMuted")} />
                        <ColorInput label="Muted Foreground" value={customColors.lightMutedForeground} onChange={updateColor("lightMutedForeground")} />
                        <ColorInput label="Card" value={customColors.lightCard} onChange={updateColor("lightCard")} />
                        <ColorInput label="Card Foreground" value={customColors.lightCardForeground} onChange={updateColor("lightCardForeground")} />
                      </>
                    ) : (
                      <>
                        <ColorInput label="Primary" value={customColors.darkPrimary} onChange={updateColor("darkPrimary")} description="Main brand color" />
                        <ColorInput label="Primary Foreground" value={customColors.darkPrimaryForeground} onChange={updateColor("darkPrimaryForeground")} description="Text on primary" />
                        <ColorInput label="Secondary" value={customColors.darkSecondary} onChange={updateColor("darkSecondary")} />
                        <ColorInput label="Secondary Foreground" value={customColors.darkSecondaryForeground} onChange={updateColor("darkSecondaryForeground")} />
                        <ColorInput label="Accent" value={customColors.darkAccent} onChange={updateColor("darkAccent")} />
                        <ColorInput label="Accent Foreground" value={customColors.darkAccentForeground} onChange={updateColor("darkAccentForeground")} />
                        <ColorInput label="Background" value={customColors.darkBackground} onChange={updateColor("darkBackground")} />
                        <ColorInput label="Foreground" value={customColors.darkForeground} onChange={updateColor("darkForeground")} />
                        <ColorInput label="Muted" value={customColors.darkMuted} onChange={updateColor("darkMuted")} />
                        <ColorInput label="Muted Foreground" value={customColors.darkMutedForeground} onChange={updateColor("darkMutedForeground")} />
                        <ColorInput label="Card" value={customColors.darkCard} onChange={updateColor("darkCard")} />
                        <ColorInput label="Card Foreground" value={customColors.darkCardForeground} onChange={updateColor("darkCardForeground")} />
                      </>
                    )}
                  </div>
                </ScrollArea>

                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label>Theme Name</Label>
                    <Input 
                      value={paletteName} 
                      onChange={(e) => setPaletteName(e.target.value)}
                      placeholder="My Custom Theme"
                      data-testid="input-palette-name"
                    />
                  </div>
                  <Button onClick={handleSaveCustom} disabled={!paletteName.trim() || isSavingPalette} data-testid="button-save-custom-theme">
                    Save & Apply
                  </Button>
                </div>
                {isAdmin && (
                  <Button
                    variant="outline"
                    className="w-full text-sm"
                    onClick={() => handleSetOrgDefault({ paletteName: paletteName.trim() || "Custom Org Theme", ...customColors })}
                    disabled={isSavingPalette}
                    data-testid="button-set-custom-org-default"
                  >
                    <Building2 className="w-4 h-4 mr-2" />
                    Set as Organization Default
                  </Button>
                )}
                
                <div className="flex items-center gap-2 p-3 bg-amber-500/10 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Colors are validated for WCAG AA contrast (4.5:1). Invalid combinations will be rejected.
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="saved" className="mt-4">
              {savedPalettes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No saved themes yet. Create a custom theme to save it.
                </div>
              ) : (
                <div className="space-y-2">
                  {savedPalettes.map((palette) => (
                    <Card key={palette.id} className={cn(palette.isActive && "ring-2 ring-primary")}>
                      <CardContent className="p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex gap-1">
                            <div className="w-5 h-5 rounded" style={{ backgroundColor: `hsl(${palette.lightPrimary})` }} />
                            <div className="w-5 h-5 rounded" style={{ backgroundColor: `hsl(${palette.lightSecondary})` }} />
                          </div>
                          <div>
                            <span className="font-medium text-sm">{palette.paletteName}</span>
                            {palette.isActive && <Badge variant="secondary" className="ml-2 text-xs">Active</Badge>}
                            {palette.isPreset && <Badge variant="outline" className="ml-2 text-xs">Preset</Badge>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {!palette.isActive && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => palette.id && activatePalette(palette.id)}
                              disabled={isSavingPalette}
                              data-testid={`button-activate-${palette.id}`}
                            >
                              Apply
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSetOrgDefault(palette)}
                              disabled={isSavingPalette}
                              data-testid={`button-org-default-saved-${palette.id}`}
                            >
                              <Building2 className="w-3 h-3 mr-1" />
                              Org
                            </Button>
                          )}
                          <Button 
                            size="icon" 
                            variant="ghost"
                            onClick={() => palette.id && setDeleteId(palette.id)}
                            data-testid={`button-delete-${palette.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Theme?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this color scheme. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePalette}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
