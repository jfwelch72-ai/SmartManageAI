import { useState, memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  GripVertical,
  Copy,
  LayoutGrid,
  X,
  Bookmark,
  FileText,
  Image,
  MessageSquare,
  Star,
} from "lucide-react";
import {
  type BodyComponentType,
  type BodyComponent,
  COMPONENT_TYPE_META,
} from "@/components/website-body-components";

interface PageEditorCanvasProps {
  sortedComponents: BodyComponent[];
  selectedComponentId: string | null;
  devicePreview: "desktop" | "tablet" | "mobile";
  onSelectComponent: (id: string) => void;
  onAddComponent: (type: BodyComponentType) => void;
  onAddComponentAtIndex: (type: BodyComponentType, index: number) => void;
  onRemoveComponent: (id: string) => void;
  onDuplicateComponent: (id: string) => void;
  onSaveAsGlobal: (id: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
}

export function PageEditorCanvas({
  sortedComponents,
  selectedComponentId,
  devicePreview,
  onSelectComponent,
  onAddComponent,
  onAddComponentAtIndex,
  onRemoveComponent,
  onDuplicateComponent,
  onSaveAsGlobal,
  onDragStart,
  onDragOver,
  onDragEnd,
}: PageEditorCanvasProps) {
  return (
    <div className="flex-1 overflow-auto bg-muted/20">
      <div className={`mx-auto p-6 transition-all ${
        devicePreview === "desktop" ? "max-w-full" :
        devicePreview === "tablet" ? "max-w-[768px]" :
        "max-w-[375px]"
      }`}>
        {sortedComponents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <LayoutGrid className="h-16 w-16 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium mb-2">Start building your page</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Choose a starter section below to get started, or add components from the library on the left.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-sm w-full mb-4">
              <Button
                variant="outline"
                className="flex flex-col items-center gap-2 h-auto py-4"
                onClick={() => onAddComponent("hero")}
                data-testid="button-add-first-component"
              >
                <Star className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium">Hero Section</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center gap-2 h-auto py-4"
                onClick={() => onAddComponent("content")}
                data-testid="button-add-content-section"
              >
                <FileText className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium">Content Block</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center gap-2 h-auto py-4"
                onClick={() => onAddComponent("gallery")}
                data-testid="button-add-gallery-section"
              >
                <Image className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium">Photo Gallery</span>
              </Button>
              <Button
                variant="outline"
                className="flex flex-col items-center gap-2 h-auto py-4"
                onClick={() => onAddComponent("form")}
                data-testid="button-add-contact-section"
              >
                <MessageSquare className="h-5 w-5 text-primary" />
                <span className="text-xs font-medium">Contact Form</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-0">
            {sortedComponents.map((comp, idx) => {
              const meta = COMPONENT_TYPE_META[comp.type];
              const Icon = meta.icon;
              const isSelected = selectedComponentId === comp.id;
              const visKey = devicePreview === "mobile" ? "visibleMobile" : "visibleDesktop";
              const isVisible = comp[visKey];

              return (
                <div key={comp.id}>
                  <AddBetweenZone index={idx} onAdd={onAddComponentAtIndex} />

                  <div
                    draggable
                    onDragStart={() => { onDragStart(idx); }}
                    onDragOver={(e) => { e.preventDefault(); onDragOver(idx); }}
                    onDrop={(e) => { e.preventDefault(); onDragEnd(); }}
                    onClick={() => {
                      onSelectComponent(comp.id);
                    }}
                    className={`relative group border-2 rounded-md transition-all cursor-pointer ${
                      isSelected
                        ? "border-primary ring-1 ring-primary/20"
                        : "border-transparent hover:border-muted-foreground/30"
                    } ${!comp.enabled || !isVisible ? "opacity-40" : ""}`}
                    data-testid={`canvas-component-${comp.id}`}
                  >
                    <div className={`absolute -top-3 left-3 z-10 flex items-center gap-1 ${isSelected ? "visible" : "invisible group-hover:visible"}`}>
                      <Badge variant={isSelected ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 gap-1">
                        <GripVertical className="h-3 w-3 cursor-grab" />
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </div>

                    <div
                      className={`absolute -top-3 right-3 z-30 flex items-center gap-0.5 ${isSelected ? "visible" : "invisible group-hover:visible"}`}
                      draggable={false}
                      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="secondary"
                        size="icon"
                        draggable={false}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSaveAsGlobal(comp.id); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        data-testid={`canvas-save-global-${comp.id}`}
                        title="Save as Reusable"
                      >
                        <Bookmark className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon"
                        draggable={false}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDuplicateComponent(comp.id); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        data-testid={`canvas-duplicate-${comp.id}`}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon"
                        draggable={false}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemoveComponent(comp.id); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        data-testid={`canvas-remove-${comp.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    <CanvasComponentPreview component={comp} devicePreview={devicePreview} />
                  </div>
                </div>
              );
            })}

            <AddBetweenZone index={sortedComponents.length} onAdd={onAddComponentAtIndex} />
          </div>
        )}
      </div>
    </div>
  );
}

function AddBetweenZone({ index, onAdd }: { index: number; onAdd: (type: BodyComponentType, index: number) => void }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative group/add py-1">
      <div
        className={`flex items-center justify-center ${isOpen ? "h-auto" : "h-2"}`}
      >
        {!isOpen && (
          <button
            className="absolute inset-x-0 top-0 flex items-center justify-center h-6 opacity-0 pointer-events-none group-hover/add:opacity-100 group-hover/add:pointer-events-auto transition-opacity z-20"
            onClick={() => setIsOpen(true)}
            data-testid={`button-add-between-${index}`}
          >
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-primary/40" />
              <div className="flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground">
                <Plus className="h-3 w-3" />
              </div>
              <div className="h-px flex-1 bg-primary/40" />
            </div>
          </button>
        )}
      </div>

      {isOpen && (
        <div className="border rounded-md p-3 my-1 bg-background">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Add Component</span>
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} data-testid={`button-close-add-${index}`}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(Object.entries(COMPONENT_TYPE_META) as [BodyComponentType, typeof COMPONENT_TYPE_META["banner"]][]).map(([type, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  className="flex items-center gap-1.5 p-1.5 rounded text-left hover-elevate transition-colors text-xs"
                  onClick={() => { onAdd(type, index); setIsOpen(false); }}
                  data-testid={`add-between-${type}-${index}`}
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const CanvasComponentPreview = memo(function CanvasComponentPreview({ component, devicePreview }: { component: BodyComponent; devicePreview: string }) {
  const meta = COMPONENT_TYPE_META[component.type];

  const normalizeImageUrl = (url: string): string => {
    if (!url) return url;
    const gcsMatch = url.match(/https:\/\/storage\.googleapis\.com\/[^/]+\/gallery\/([^/]+\/.+)$/);
    if (gcsMatch) {
      return `/api/website/image/${gcsMatch[1]}`;
    }
    return url;
  };

  const bgStyle: Record<string, string> = {};
  if (component.styles.background.type === "solid" && component.styles.background.color) {
    bgStyle.backgroundColor = component.styles.background.color;
  } else if (component.styles.background.type === "gradient") {
    const dir = component.styles.background.gradientDirection.replace("to-", "to ");
    bgStyle.background = `linear-gradient(${dir}, ${component.styles.background.gradientFrom || "#000"}, ${component.styles.background.gradientTo || "#fff"})`;
  } else if (component.styles.background.type === "image" && component.styles.background.imageUrl) {
    bgStyle.backgroundImage = `url(${normalizeImageUrl(component.styles.background.imageUrl)})`;
    bgStyle.backgroundSize = "cover";
    bgStyle.backgroundPosition = "center";
  }

  const renderImage = (url: string, alt: string, testIdSuffix: string, className?: string) => {
    if (!url) return null;
    const src = normalizeImageUrl(url);
    return (
      <img
        src={src}
        alt={alt}
        className={className || "w-full h-24 object-cover rounded"}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        data-testid={`preview-image-${testIdSuffix}-${component.id}`}
      />
    );
  };

  const getPreviewContent = () => {
    switch (component.type) {
      case "banner": {
        const hasSideImage = component.config.sideImageEnabled && component.config.sideImageUrl;
        return (
          <div className={hasSideImage ? "flex items-center gap-3" : "space-y-1"}>
            <div className="flex-1 space-y-1">
              <h3 className="text-lg font-bold">{component.config.title || "Banner Title"}</h3>
              <p className="text-sm text-muted-foreground">{component.config.content || "Banner content"}</p>
              {component.config.buttons.length > 0 && (
                <div className="flex gap-2 pt-1 flex-wrap">
                  {component.config.buttons.map((btn: any, i: number) => (
                    <Badge key={i} variant={btn.variant === "primary" ? "default" : "secondary"}>{btn.text}</Badge>
                  ))}
                </div>
              )}
            </div>
            {hasSideImage && (
              <div className="w-24 flex-shrink-0">
                {renderImage(component.config.sideImageUrl, "Banner side image", "banner-side", "w-full h-20 object-cover rounded")}
              </div>
            )}
          </div>
        );
      }
      case "hero": {
        const hasImage = component.config.imageEnabled && component.config.imageUrl;
        const isRight = component.config.imagePosition === "right";
        return (
          <div className={hasImage ? "flex items-center gap-3" : "space-y-1"}>
            {hasImage && !isRight && (
              <div className="w-28 flex-shrink-0">
                {renderImage(component.config.imageUrl, "Hero image", "hero", "w-full h-24 object-cover rounded")}
              </div>
            )}
            <div className="flex-1 space-y-1">
              <h2 className="text-xl font-bold">{component.config.title || "Hero Title"}</h2>
              <p className="text-sm font-medium text-muted-foreground">{component.config.subtitle || "Subtitle"}</p>
              <p className="text-xs text-muted-foreground">{component.config.content || "Hero description"}</p>
            </div>
            {hasImage && isRight && (
              <div className="w-28 flex-shrink-0">
                {renderImage(component.config.imageUrl, "Hero image", "hero", "w-full h-24 object-cover rounded")}
              </div>
            )}
          </div>
        );
      }
      case "content":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Section Title"}</h3>
            <p className="text-xs text-muted-foreground line-clamp-3">{component.config.content || "Content goes here..."}</p>
          </div>
        );
      case "cta":
        return (
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold">{component.config.title || "Call to Action"}</h3>
            <p className="text-xs text-muted-foreground">{component.config.content || "CTA description"}</p>
            <div className="flex gap-2 justify-center pt-1 flex-wrap">
              {component.config.buttons.map((btn: any, i: number) => (
                <Badge key={i} variant={btn.variant === "primary" ? "default" : "secondary"}>{btn.text}</Badge>
              ))}
            </div>
          </div>
        );
      case "form":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Form"}</h3>
            <div className="flex gap-2 flex-wrap">
              {component.config.fields.slice(0, 3).map((f: any) => (
                <Badge key={f.id} variant="outline" className="text-[10px]">{f.label}</Badge>
              ))}
              {component.config.fields.length > 3 && (
                <Badge variant="secondary" className="text-[10px]">+{component.config.fields.length - 3} more</Badge>
              )}
            </div>
          </div>
        );
      case "grid":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Grid"}</h3>
            <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(component.config.columns, 4)}, 1fr)` }}>
              {component.config.items.slice(0, component.config.columns).map((item: any) => (
                <div key={item.id} className="p-2 border rounded text-xs">
                  <div className="font-medium truncate">{item.title}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case "testimonial":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Testimonials"}</h3>
            <div className="flex gap-2 flex-wrap">
              {component.config.items.slice(0, 3).map((t: any) => (
                <div key={t.id} className="text-xs p-2 border rounded flex-1 min-w-[100px]">
                  <div className="flex items-center gap-2 mb-1">
                    {t.imageEnabled && t.imageUrl && renderImage(t.imageUrl, t.name, `testimonial-${t.id}`, "w-6 h-6 rounded-full object-cover flex-shrink-0")}
                    <p className="font-medium">{t.name}</p>
                  </div>
                  <p className="italic line-clamp-2">"{t.quote}"</p>
                </div>
              ))}
            </div>
          </div>
        );
      case "feature_highlight":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Features"}</h3>
            <div className="flex gap-3 flex-wrap">
              {component.config.items.slice(0, 4).map((f: any) => (
                <div key={f.id} className="text-xs">
                  <div className="font-medium">{f.title}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case "gallery":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Gallery"}</h3>
            <div className="grid grid-cols-3 gap-1">
              {[1, 2, 3].map(i => (
                <div key={i} className="aspect-square bg-muted rounded" />
              ))}
            </div>
          </div>
        );
      case "stats":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "Stats"}</h3>
            <div className="flex gap-4 flex-wrap">
              {component.config.items.slice(0, 4).map((s: any) => (
                <div key={s.id} className="text-center">
                  <div className="text-lg font-bold">{s.prefix}{s.value}{s.suffix}</div>
                  <div className="text-[10px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case "faq":
        return (
          <div className="space-y-1">
            <h3 className="text-base font-semibold">{component.config.title || "FAQ"}</h3>
            {component.config.items.slice(0, 3).map((f: any) => (
              <div key={f.id} className="text-xs border-b pb-1">
                <span className="font-medium">{f.question}</span>
              </div>
            ))}
          </div>
        );
      default:
        return <p className="text-sm text-muted-foreground">{meta.label}</p>;
    }
  };

  return (
    <div
      className="p-4 min-h-[60px] rounded-md"
      style={{
        ...bgStyle,
        textAlign: component.styles.alignment || "left",
      }}
    >
      {getPreviewContent()}
    </div>
  );
});
