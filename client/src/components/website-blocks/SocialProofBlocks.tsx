import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUploadField } from "@/components/website-body-components";
import type { BodyComponent, TestimonialItem } from "@/components/website-body-components";
import { Plus, Trash2 } from "lucide-react";

interface TestimonialConfig {
  layout: "carousel" | "grid";
  columns: number;
  items: TestimonialItem[];
  title: string;
}

interface TeamMember {
  id: string;
  photoUrl: string;
  name: string;
  role: string;
  bio: string;
}

interface TeamConfig {
  title: string;
  columns: number;
  items: TeamMember[];
}

interface CertificationItem {
  id: string;
  logoUrl: string;
  label: string;
}

interface CertificationsConfig {
  title: string;
  columns: number;
  items: CertificationItem[];
}

interface LogoItem {
  id: string;
  imageUrl: string;
  altText: string;
}

interface LogoShowcaseConfig {
  title: string;
  items: LogoItem[];
  desktopColumns: number;
  tabletColumns: number;
  mobileColumns: number;
  continuousSlide: boolean;
  slideSpeed: number;
}

export function TestimonialEditor({ comp, onChange }: { comp: BodyComponent & { type: "testimonial" }; onChange: (c: TestimonialConfig) => void }) {
  const addItem = () => {
    onChange({ ...comp.config, items: [...comp.config.items, { id: `t-${Date.now()}`, name: "Name", role: "Role", quote: "Quote text", imageEnabled: false, imageUrl: "" }] });
  };
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_: TestimonialItem, idx: number) => idx !== i) });
  const updateItem = (i: number, updates: Partial<TestimonialItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Section Title</Label>
        <Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-testimonial-title" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Layout</Label>
          <Select value={comp.config.layout} onValueChange={(v) => onChange({ ...comp.config, layout: v as TestimonialConfig["layout"] })}>
            <SelectTrigger data-testid="select-testimonial-layout"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="carousel">Carousel</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Columns</Label>
          <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
            <SelectTrigger data-testid="select-testimonial-cols"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Testimonials</Label>
        {comp.config.items.map((item: TestimonialItem, i: number) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Input value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} placeholder="Name" className="flex-1 min-w-[80px]" data-testid={`input-testimonial-name-${i}`} />
              <Input value={item.role} onChange={(e) => updateItem(i, { role: e.target.value })} placeholder="Role" className="flex-1 min-w-[80px]" data-testid={`input-testimonial-role-${i}`} />
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-testimonial-${i}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Textarea value={item.quote} onChange={(e) => updateItem(i, { quote: e.target.value })} className="resize-none text-xs" rows={2} placeholder="Quote" data-testid={`input-testimonial-quote-${i}`} />
            <div className="flex items-center gap-3">
              <Switch checked={item.imageEnabled} onCheckedChange={(v) => updateItem(i, { imageEnabled: v })} data-testid={`switch-testimonial-img-${i}`} />
              <Label className="text-[10px]">Profile Image</Label>
            </div>
            {item.imageEnabled && (
              <ImageUploadField value={item.imageUrl} onChange={(url) => updateItem(i, { imageUrl: url })} label="Profile Image" testId={`input-testimonial-img-${i}`} />
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-testimonial">
          <Plus className="h-3 w-3 mr-1" /> Add Testimonial
        </Button>
      </div>
    </div>
  );
}

export function TeamEditor({ comp, onChange }: { comp: BodyComponent & { type: "team" }; onChange: (c: TeamConfig) => void }) {
  const addItem = () => onChange({ ...comp.config, items: [...comp.config.items, { id: `tm-${Date.now()}`, photoUrl: "", name: "New Member", role: "", bio: "" }] });
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_: TeamMember, idx: number) => idx !== i) });
  const updateItem = (i: number, updates: Partial<TeamMember>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };
  return (
    <div className="space-y-3">
      <div><Label className="text-xs">Section Title</Label><Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-team-title" /></div>
      <div><Label className="text-xs">Columns</Label>
        <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
          <SelectTrigger data-testid="select-team-cols"><SelectValue /></SelectTrigger>
          <SelectContent>{[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Team Members</Label>
        {comp.config.items.map((item: TeamMember, i: number) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Member {i + 1}</Label>
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-team-${i}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <ImageUploadField value={item.photoUrl} onChange={(url) => updateItem(i, { photoUrl: url })} label="Photo" placeholder="Upload team member photo" testId={`input-team-photo-${i}`} />
            <div><Label className="text-xs">Name</Label><Input value={item.name} onChange={(e) => updateItem(i, { name: e.target.value })} placeholder="Full name" data-testid={`input-team-name-${i}`} /></div>
            <div><Label className="text-xs">Role / Title</Label><Input value={item.role} onChange={(e) => updateItem(i, { role: e.target.value })} placeholder="e.g. Project Manager" data-testid={`input-team-role-${i}`} /></div>
            <div><Label className="text-xs">Bio</Label><Textarea value={item.bio} onChange={(e) => updateItem(i, { bio: e.target.value })} className="resize-none text-xs" rows={2} data-testid={`input-team-bio-${i}`} /></div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-team"><Plus className="h-3 w-3 mr-1" /> Add Member</Button>
      </div>
    </div>
  );
}

export function CertificationsEditor({ comp, onChange }: { comp: BodyComponent & { type: "certifications" }; onChange: (c: CertificationsConfig) => void }) {
  const addItem = () => onChange({ ...comp.config, items: [...comp.config.items, { id: `c-${Date.now()}`, logoUrl: "", label: "New Certification" }] });
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_: CertificationItem, idx: number) => idx !== i) });
  const updateItem = (i: number, updates: Partial<CertificationItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };
  return (
    <div className="space-y-3">
      <div><Label className="text-xs">Section Title</Label><Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-cert-title" /></div>
      <div><Label className="text-xs">Columns</Label>
        <Select value={String(comp.config.columns)} onValueChange={(v) => onChange({ ...comp.config, columns: parseInt(v) })}>
          <SelectTrigger data-testid="select-cert-cols"><SelectValue /></SelectTrigger>
          <SelectContent>{[2, 3, 4, 5, 6].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Certifications</Label>
        {comp.config.items.map((item: CertificationItem, i: number) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Certification {i + 1}</Label>
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-cert-${i}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <ImageUploadField value={item.logoUrl} onChange={(url) => updateItem(i, { logoUrl: url })} label="Logo" placeholder="Upload certification logo" testId={`input-cert-logo-${i}`} />
            <div><Label className="text-xs">Label</Label><Input value={item.label} onChange={(e) => updateItem(i, { label: e.target.value })} placeholder="Certification name" data-testid={`input-cert-label-${i}`} /></div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-cert"><Plus className="h-3 w-3 mr-1" /> Add Certification</Button>
      </div>
    </div>
  );
}

export function LogoShowcaseEditor({ comp, onChange }: { comp: BodyComponent & { type: "logo_showcase" }; onChange: (c: LogoShowcaseConfig) => void }) {
  const addItem = () => onChange({ ...comp.config, items: [...comp.config.items, { id: `l-${Date.now()}`, imageUrl: "", altText: "" }] });
  const removeItem = (i: number) => onChange({ ...comp.config, items: comp.config.items.filter((_: LogoItem, idx: number) => idx !== i) });
  const updateItem = (i: number, updates: Partial<LogoItem>) => {
    const items = [...comp.config.items];
    items[i] = { ...items[i], ...updates };
    onChange({ ...comp.config, items });
  };
  return (
    <div className="space-y-3">
      <div><Label className="text-xs">Section Title</Label><Input value={comp.config.title} onChange={(e) => onChange({ ...comp.config, title: e.target.value })} data-testid="input-logo-title" /></div>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Desktop Columns</Label><Input type="number" min={1} max={10} value={comp.config.desktopColumns} onChange={(e) => onChange({ ...comp.config, desktopColumns: parseInt(e.target.value) || 5 })} data-testid="input-logo-desktop-cols" /></div>
        <div><Label className="text-xs">Tablet Columns</Label><Input type="number" min={1} max={6} value={comp.config.tabletColumns} onChange={(e) => onChange({ ...comp.config, tabletColumns: parseInt(e.target.value) || 3 })} data-testid="input-logo-tablet-cols" /></div>
        <div><Label className="text-xs">Mobile Columns</Label><Input type="number" min={1} max={4} value={comp.config.mobileColumns} onChange={(e) => onChange({ ...comp.config, mobileColumns: parseInt(e.target.value) || 2 })} data-testid="input-logo-mobile-cols" /></div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={comp.config.continuousSlide} onCheckedChange={(v) => onChange({ ...comp.config, continuousSlide: v })} data-testid="switch-logo-slide" />
        <Label className="text-xs">Continuous Sliding</Label>
      </div>
      {comp.config.continuousSlide && (
        <div><Label className="text-xs">Slide Speed (seconds per cycle)</Label><Input type="number" min={5} max={120} value={comp.config.slideSpeed || 30} onChange={(e) => onChange({ ...comp.config, slideSpeed: parseInt(e.target.value) || 30 })} data-testid="input-logo-speed" /></div>
      )}
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Logos</Label>
        {comp.config.items.map((item: LogoItem, i: number) => (
          <div key={item.id} className="border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Logo {i + 1}</Label>
              <Button variant="ghost" size="icon" onClick={() => removeItem(i)} data-testid={`button-remove-logo-${i}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <ImageUploadField value={item.imageUrl} onChange={(url) => updateItem(i, { imageUrl: url })} label="Logo Image" placeholder="Upload logo" testId={`input-logo-img-${i}`} />
            <div><Label className="text-xs">Alt Text</Label><Input value={item.altText} onChange={(e) => updateItem(i, { altText: e.target.value })} placeholder="Logo description" data-testid={`input-logo-alt-${i}`} /></div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addItem} data-testid="button-add-logo"><Plus className="h-3 w-3 mr-1" /> Add Logo</Button>
      </div>
    </div>
  );
}
