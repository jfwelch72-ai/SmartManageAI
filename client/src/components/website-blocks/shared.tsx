import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import BrandingColorPicker, { type BrandingColors } from "@/components/branding-color-picker";
import { GOOGLE_FONTS, loadGoogleFont } from "../text-style-editor";
import {
  Plus,
  Trash2,
  Palette,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import type { ButtonConfig } from "@/components/website-body-components";

function ButtonStyleFontPicker({ value, onChange, btnIndex }: { value: string; onChange: (font: string) => void; btnIndex: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={(o) => {
      setOpen(o);
      if (o) GOOGLE_FONTS.slice(0, 20).forEach(f => loadGoogleFont(f));
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between text-xs" data-testid={`button-btn-style-fontFamily-${btnIndex}`} style={value ? { fontFamily: `"${value}", sans-serif` } : undefined}>
          {value || "Default"}
          <ChevronsUpDown className="h-3 w-3 ml-1 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fonts..." data-testid={`input-btn-style-fontSearch-${btnIndex}`} />
          <CommandList>
            <CommandEmpty>No fonts found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="default" onSelect={() => { onChange(""); setOpen(false); }} data-testid={`item-btn-style-font-default-${btnIndex}`}>
                <span className="flex-1">Default</span>
                {!value && <Check className="h-3.5 w-3.5" />}
              </CommandItem>
              {GOOGLE_FONTS.map((font) => (
                <CommandItem key={font} value={font} onSelect={() => { loadGoogleFont(font); onChange(font); setOpen(false); }} data-testid={`item-btn-style-font-${font.replace(/\s+/g, '-').toLowerCase()}-${btnIndex}`}>
                  <span className="flex-1" style={{ fontFamily: `"${font}", sans-serif` }}>{font}</span>
                  {value === font && <Check className="h-3.5 w-3.5" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ButtonListEditor({ buttons, onChange, brandingColors }: { buttons: ButtonConfig[]; onChange: (b: ButtonConfig[]) => void; brandingColors?: BrandingColors }) {
  const addButton = () => onChange([...buttons, { text: "Button", url: "#", variant: "primary" }]);
  const removeButton = (i: number) => onChange(buttons.filter((_, idx) => idx !== i));
  const updateButton = (i: number, updates: Partial<ButtonConfig>) => {
    const newBtns = [...buttons];
    newBtns[i] = { ...newBtns[i], ...updates };
    onChange(newBtns);
  };
  const updateButtonStyle = (i: number, styleUpdates: Record<string, string>) => {
    const newBtns = [...buttons];
    newBtns[i] = { ...newBtns[i], style: { ...(newBtns[i].style || {}), ...styleUpdates } };
    onChange(newBtns);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">Buttons</Label>
      {buttons.map((btn, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Input value={btn.text} onChange={(e) => updateButton(i, { text: e.target.value })} placeholder="Text" className="flex-1 min-w-[100px]" data-testid={`input-btn-text-${i}`} />
            <Input value={btn.url} onChange={(e) => updateButton(i, { url: e.target.value })} placeholder="URL" className="flex-1 min-w-[100px]" data-testid={`input-btn-url-${i}`} />
            <Select value={btn.variant} onValueChange={(v) => updateButton(i, { variant: v as ButtonConfig["variant"] })}>
              <SelectTrigger className="w-[110px]" data-testid={`select-btn-variant-${i}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Primary</SelectItem>
                <SelectItem value="secondary">Secondary</SelectItem>
                <SelectItem value="outline">Outline</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={() => removeButton(i)} data-testid={`button-remove-btn-${i}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-start gap-1 text-xs text-muted-foreground" data-testid={`button-btn-style-toggle-${i}`}>
                <Palette className="h-3.5 w-3.5" /> Button Style
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-1 pl-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Background Color</Label>
                  <BrandingColorPicker
                    value={btn.style?.backgroundColor || ""}
                    onChange={(color) => updateButtonStyle(i, { backgroundColor: color })}
                    brandingColors={brandingColors}
                    placeholder="#3b82f6"
                    data-testid={`input-btn-style-bgColor-${i}`}
                    data-testid-hex={`input-btn-style-bgColorHex-${i}`}
                    size="sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Text Color</Label>
                  <BrandingColorPicker
                    value={btn.style?.textColor || ""}
                    onChange={(color) => updateButtonStyle(i, { textColor: color })}
                    brandingColors={brandingColors}
                    placeholder="#ffffff"
                    data-testid={`input-btn-style-textColor-${i}`}
                    data-testid-hex={`input-btn-style-textColorHex-${i}`}
                    size="sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Border Color</Label>
                  <BrandingColorPicker
                    value={btn.style?.borderColor || ""}
                    onChange={(color) => updateButtonStyle(i, { borderColor: color })}
                    brandingColors={brandingColors}
                    placeholder="#3b82f6"
                    data-testid={`input-btn-style-borderColor-${i}`}
                    data-testid-hex={`input-btn-style-borderColorHex-${i}`}
                    size="sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Border Width (px)</Label>
                  <Input type="number" className="h-8" min={0} max={10} value={btn.style?.borderWidth || ""} onChange={(e) => updateButtonStyle(i, { borderWidth: e.target.value })} placeholder="1" data-testid={`input-btn-style-borderWidth-${i}`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Border Radius (px)</Label>
                  <Input type="number" className="h-8" min={0} max={50} value={btn.style?.borderRadius || ""} onChange={(e) => updateButtonStyle(i, { borderRadius: e.target.value })} placeholder="6" data-testid={`input-btn-style-borderRadius-${i}`} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Font Size (px)</Label>
                  <Input type="number" className="h-8" min={8} max={48} value={btn.style?.fontSize || ""} onChange={(e) => updateButtonStyle(i, { fontSize: e.target.value })} placeholder="16" data-testid={`input-btn-style-fontSize-${i}`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Padding X (px)</Label>
                  <Input type="number" className="h-8" min={0} max={60} value={btn.style?.paddingX || ""} onChange={(e) => updateButtonStyle(i, { paddingX: e.target.value })} placeholder="16" data-testid={`input-btn-style-paddingX-${i}`} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Padding Y (px)</Label>
                  <Input type="number" className="h-8" min={0} max={40} value={btn.style?.paddingY || ""} onChange={(e) => updateButtonStyle(i, { paddingY: e.target.value })} placeholder="8" data-testid={`input-btn-style-paddingY-${i}`} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Font Family</Label>
                <ButtonStyleFontPicker value={btn.style?.fontFamily || ""} onChange={(font) => updateButtonStyle(i, { fontFamily: font })} btnIndex={i} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Font Weight</Label>
                <Select value={btn.style?.fontWeight || ""} onValueChange={(v) => updateButtonStyle(i, { fontWeight: v })}>
                  <SelectTrigger className="h-8" data-testid={`select-btn-style-fontWeight-${i}`}><SelectValue placeholder="Default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="400">400 Regular</SelectItem>
                    <SelectItem value="500">500 Medium</SelectItem>
                    <SelectItem value="600">600 Semi Bold</SelectItem>
                    <SelectItem value="700">700 Bold</SelectItem>
                    <SelectItem value="800">800 Extra Bold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addButton} data-testid="button-add-btn">
        <Plus className="h-3 w-3 mr-1" /> Add Button
      </Button>
    </div>
  );
}
