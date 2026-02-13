import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface BrandingColors {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

const COMMON_COLORS = [
  { value: "#ffffff", label: "White" },
  { value: "#000000", label: "Black" },
  { value: "#f3f4f6", label: "Light Gray" },
  { value: "#1f2937", label: "Dark Gray" },
];

const TRANSPARENT_SWATCH = { value: "transparent", label: "None" };

interface BrandingColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  brandingColors?: BrandingColors;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
  "data-testid-hex"?: string;
  showHexInput?: boolean;
  showTransparent?: boolean;
  size?: "sm" | "default";
}

export default function BrandingColorPicker({
  value,
  onChange,
  brandingColors,
  placeholder = "#000000",
  className = "",
  "data-testid": testId,
  "data-testid-hex": testIdHex,
  showHexInput = true,
  showTransparent = true,
  size = "default",
}: BrandingColorPickerProps) {
  const swatchSize = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  const pickerSize = size === "sm" ? "w-6 h-6" : "h-8 w-8";
  const inputHeight = size === "sm" ? "h-7 text-xs" : "h-8";

  const isTransparentValue = value === "transparent" || value === "";

  const brandSwatches = brandingColors
    ? [
        { value: brandingColors.primaryColor, label: "Primary" },
        { value: brandingColors.secondaryColor, label: "Secondary" },
        { value: brandingColors.accentColor, label: "Accent" },
      ]
    : [];

  const allSwatches = [...brandSwatches, ...COMMON_COLORS, ...(showTransparent ? [TRANSPARENT_SWATCH] : [])];

  const colorInputValue = isTransparentValue ? placeholder : (value || placeholder);

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={colorInputValue}
          onChange={(e) => onChange(e.target.value)}
          className={`${pickerSize} rounded border cursor-pointer`}
          data-testid={testId}
        />
        {showHexInput && (
          <Input
            className={`${inputHeight} flex-1`}
            value={isTransparentValue ? "transparent" : (value || "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            data-testid={testIdHex}
          />
        )}
      </div>
      {brandingColors && (
        <div className="flex items-center gap-1 flex-wrap">
          {allSwatches.map((swatch) => {
            const isTransparent = swatch.value === "transparent";
            const isActive = isTransparent ? isTransparentValue : value === swatch.value;
            return (
              <Tooltip key={swatch.value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid={`swatch-${swatch.label.toLowerCase().replace(/\s+/g, "-")}`}
                    onClick={() => onChange(swatch.value)}
                    className={`${swatchSize} rounded-sm border cursor-pointer ${
                      isActive ? "ring-2 ring-primary ring-offset-1" : ""
                    }`}
                    style={{
                      backgroundColor: isTransparent ? "transparent" : swatch.value,
                      backgroundImage: isTransparent
                        ? "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%, #ccc)"
                        : undefined,
                      backgroundSize: isTransparent ? "6px 6px" : undefined,
                      backgroundPosition: isTransparent ? "0 0, 3px 3px" : undefined,
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <p>{swatch.label}{!isTransparent ? ` (${swatch.value})` : ""}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
