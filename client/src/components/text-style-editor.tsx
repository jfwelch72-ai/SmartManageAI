import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Type, AlignLeft, AlignCenter, AlignRight, AlignJustify, Check } from "lucide-react";

export const GOOGLE_FONTS = [
  "Abel", "Abril Fatface", "Alegreya", "Alegreya Sans", "Archivo", "Archivo Narrow",
  "Arimo", "Arvo", "Asap", "Assistant", "Barlow", "Barlow Condensed", "Bebas Neue",
  "Bitter", "Cabin", "Cairo", "Catamaran", "Comfortaa", "Cormorant Garamond",
  "Crimson Text", "DM Sans", "DM Serif Display", "Dosis", "EB Garamond", "Exo 2",
  "Fira Sans", "Fira Sans Condensed", "Fjalla One", "Francois One", "Heebo",
  "Hind", "IBM Plex Sans", "IBM Plex Serif", "Inconsolata", "Inter", "Josefin Sans",
  "Josefin Slab", "Kanit", "Karla", "Lato", "Lexend", "Libre Baskerville",
  "Libre Franklin", "Lora", "Manrope", "Maven Pro", "Merriweather", "Merriweather Sans",
  "Montserrat", "Mukta", "Mulish", "Noto Sans", "Noto Serif", "Nunito", "Nunito Sans",
  "Old Standard TT", "Open Sans", "Oswald", "Outfit", "Overpass", "Oxygen",
  "PT Sans", "PT Serif", "Pacifico", "Permanent Marker", "Playfair Display",
  "Plus Jakarta Sans", "Poppins", "Prompt", "Public Sans", "Quicksand",
  "Rajdhani", "Raleway", "Roboto", "Roboto Condensed", "Roboto Mono", "Roboto Slab",
  "Rubik", "Saira", "Satisfy", "Signika", "Slabo 27px", "Source Code Pro",
  "Source Sans 3", "Source Serif 4", "Space Grotesk", "Space Mono", "Spectral",
  "Syne", "Teko", "Titillium Web", "Ubuntu", "Ubuntu Mono", "Urbanist",
  "Varela Round", "Work Sans", "Yanone Kaffeesatz", "Zilla Slab"
];

export function loadGoogleFont(fontFamily: string) {
  if (!fontFamily || fontFamily === 'inherit') return;
  const linkId = `google-font-${fontFamily.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap`;
  document.head.appendChild(link);
}

interface TextStyleEditorProps {
  content: Record<string, string>;
  onUpdate: (updates: Record<string, string>) => void;
  elementId: string;
  defaultFontSize?: string;
  defaultColor?: string;
  showFontFamily?: boolean;
}

export function TextStyleEditor({
  content,
  onUpdate,
  elementId,
  defaultFontSize = "14",
  defaultColor = "#ffffff",
  showFontFamily = true,
}: TextStyleEditorProps) {
  const [fontPopoverOpen, setFontPopoverOpen] = useState(false);

  const handleUpdate = (key: string, value: string) => {
    onUpdate({ [key]: value });
  };

  const currentFont = content.fontFamily || "";
  const currentAlign = content.textAlign || "left";

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-1 text-xs text-muted-foreground" data-testid={`button-textstyle-toggle-${elementId}`}>
          <Type className="h-3.5 w-3.5" /> Text Style
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {showFontFamily && (
          <div className="space-y-1">
            <Label className="text-xs">Font Family</Label>
            <Popover open={fontPopoverOpen} onOpenChange={(open) => {
              setFontPopoverOpen(open);
              if (open) {
                GOOGLE_FONTS.slice(0, 20).forEach(f => loadGoogleFont(f));
              }
            }}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between text-xs"
                  data-testid={`button-textstyle-fontFamily-${elementId}`}
                  style={currentFont ? { fontFamily: `"${currentFont}", sans-serif` } : undefined}
                >
                  {currentFont || "Inherit"}
                  <Type className="h-3 w-3 ml-1 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search fonts..." data-testid={`input-textstyle-fontSearch-${elementId}`} />
                  <CommandList>
                    <CommandEmpty>No fonts found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="inherit"
                        onSelect={() => {
                          handleUpdate("fontFamily", "");
                          setFontPopoverOpen(false);
                        }}
                        data-testid={`item-textstyle-font-inherit-${elementId}`}
                      >
                        <span className="flex-1">Inherit</span>
                        {!currentFont && <Check className="h-3.5 w-3.5" />}
                      </CommandItem>
                      {GOOGLE_FONTS.map((font) => (
                        <CommandItem
                          key={font}
                          value={font}
                          onSelect={() => {
                            loadGoogleFont(font);
                            handleUpdate("fontFamily", font);
                            setFontPopoverOpen(false);
                          }}
                          data-testid={`item-textstyle-font-${font.replace(/\s+/g, '-').toLowerCase()}-${elementId}`}
                        >
                          <span className="flex-1" style={{ fontFamily: `"${font}", sans-serif` }}>{font}</span>
                          {currentFont === font && <Check className="h-3.5 w-3.5" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Font Size (px)</Label>
            <Input
              type="number"
              className="h-8"
              min={8}
              max={120}
              value={content.fontSize || defaultFontSize}
              onChange={(e) => handleUpdate("fontSize", e.target.value)}
              data-testid={`input-textstyle-fontSize-${elementId}`}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Font Weight</Label>
            <Select
              value={content.fontWeight || ""}
              onValueChange={(val) => handleUpdate("fontWeight", val)}
            >
              <SelectTrigger className="h-8" data-testid={`select-textstyle-fontWeight-${elementId}`}>
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">100 Thin</SelectItem>
                <SelectItem value="200">200 Extra Light</SelectItem>
                <SelectItem value="300">300 Light</SelectItem>
                <SelectItem value="400">400 Regular</SelectItem>
                <SelectItem value="500">500 Medium</SelectItem>
                <SelectItem value="600">600 Semi Bold</SelectItem>
                <SelectItem value="700">700 Bold</SelectItem>
                <SelectItem value="800">800 Extra Bold</SelectItem>
                <SelectItem value="900">900 Black</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Text Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={content.textColor || defaultColor}
                onChange={(e) => handleUpdate("textColor", e.target.value)}
                className="h-8 w-8 rounded border cursor-pointer"
                data-testid={`input-textstyle-textColor-${elementId}`}
              />
              <Input
                className="h-8 flex-1"
                value={content.textColor || defaultColor}
                onChange={(e) => handleUpdate("textColor", e.target.value)}
                data-testid={`input-textstyle-textColorHex-${elementId}`}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Font Style</Label>
            <Select
              value={content.fontStyle || "normal"}
              onValueChange={(val) => handleUpdate("fontStyle", val)}
            >
              <SelectTrigger className="h-8" data-testid={`select-textstyle-fontStyle-${elementId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="italic">Italic</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Text Alignment</Label>
          <div className="flex gap-1">
            {([
              { value: "left", icon: AlignLeft },
              { value: "center", icon: AlignCenter },
              { value: "right", icon: AlignRight },
              { value: "justify", icon: AlignJustify },
            ] as const).map(({ value, icon: Icon }) => (
              <Button
                key={value}
                size="icon"
                variant="ghost"
                className={`toggle-elevate ${currentAlign === value ? "toggle-elevated" : ""}`}
                onClick={() => handleUpdate("textAlign", value)}
                data-testid={`button-textstyle-textAlign-${value}-${elementId}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Text Transform</Label>
            <Select
              value={content.textTransform || "none"}
              onValueChange={(val) => handleUpdate("textTransform", val)}
            >
              <SelectTrigger className="h-8" data-testid={`select-textstyle-textTransform-${elementId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="uppercase">UPPERCASE</SelectItem>
                <SelectItem value="lowercase">lowercase</SelectItem>
                <SelectItem value="capitalize">Capitalize</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Line Height</Label>
            <Input
              type="number"
              className="h-8"
              step={0.1}
              min={0.5}
              max={5}
              value={content.lineHeight || ""}
              onChange={(e) => handleUpdate("lineHeight", e.target.value)}
              placeholder="Auto"
              data-testid={`input-textstyle-lineHeight-${elementId}`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Letter Spacing (px)</Label>
            <Input
              type="number"
              className="h-8"
              step={0.5}
              min={-5}
              max={20}
              value={content.letterSpacing || ""}
              onChange={(e) => handleUpdate("letterSpacing", e.target.value)}
              placeholder="0"
              data-testid={`input-textstyle-letterSpacing-${elementId}`}
            />
          </div>
          <div />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Padding (px)</Label>
            <Input
              type="number"
              className="h-8"
              min={0}
              max={100}
              value={content.padding || "0"}
              onChange={(e) => handleUpdate("padding", e.target.value)}
              data-testid={`input-textstyle-padding-${elementId}`}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Margin (px)</Label>
            <Input
              type="number"
              className="h-8"
              min={0}
              max={100}
              value={content.margin || "0"}
              onChange={(e) => handleUpdate("margin", e.target.value)}
              data-testid={`input-textstyle-margin-${elementId}`}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
