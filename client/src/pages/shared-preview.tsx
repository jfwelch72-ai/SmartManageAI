import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock } from "lucide-react";

interface PreviewData {
  page: {
    pageTitle: string;
    pageSlug: string;
    contentJson: string | null;
    isPublished: boolean;
    metaTitle: string | null;
    metaDescription: string | null;
  };
  website: {
    siteName: string;
    logoUrl: string | null;
    primaryColor: string | null;
  } | null;
  organization: {
    name: string;
    tradeType: string | null;
    logoUrl: string | null;
  } | null;
  expiresAt: string;
}

export default function SharedPreviewPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/website/shared-preview/${token}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? "This preview link has expired or been revoked." : "Failed to load preview");
        return res.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3 p-8">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Preview Not Available</h1>
          <p className="text-muted-foreground max-w-md">
            {error || "This preview link is no longer valid."}
          </p>
        </div>
      </div>
    );
  }

  const { page, website, organization, expiresAt } = data;

  const renderComponents = () => {
    if (!page.contentJson) return null;
    try {
      const parsed = JSON.parse(page.contentJson);
      const components = parsed.components || [];
      if (components.length === 0) return <p className="text-muted-foreground text-center py-8">This page has no content yet.</p>;

      return components
        .filter((c: any) => c.enabled !== false)
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((comp: any) => (
          <div key={comp.id} className="mb-4" style={{ textAlign: comp.styles?.alignment || "left" }}>
            {renderComponent(comp)}
          </div>
        ));
    } catch {
      return <p className="text-muted-foreground text-center py-8">Unable to render page content.</p>;
    }
  };

  const renderComponent = (comp: any) => {
    const bgStyle: Record<string, string> = {};
    if (comp.styles?.background?.type === "solid" && comp.styles.background.color) {
      bgStyle.backgroundColor = comp.styles.background.color;
    }

    switch (comp.type) {
      case "hero":
        return (
          <div className="py-16 px-6 rounded-md" style={bgStyle}>
            <h1 className="text-3xl font-bold mb-3">{comp.config?.heading || "Hero Section"}</h1>
            {comp.config?.subheading && <p className="text-lg text-muted-foreground">{comp.config.subheading}</p>}
            {comp.config?.buttonText && (
              <button className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-md">{comp.config.buttonText}</button>
            )}
          </div>
        );
      case "banner":
        return (
          <div className="py-4 px-6 rounded-md" style={bgStyle}>
            <p className="font-medium">{comp.config?.text || "Banner"}</p>
          </div>
        );
      case "content":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            {comp.config?.heading && <h2 className="text-xl font-semibold mb-2">{comp.config.heading}</h2>}
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{comp.config?.body || ""}</div>
          </div>
        );
      case "cta":
        return (
          <div className="py-8 px-6 text-center rounded-md" style={bgStyle}>
            <h3 className="text-xl font-semibold mb-2">{comp.config?.heading || "Call to Action"}</h3>
            {comp.config?.description && <p className="text-muted-foreground mb-4">{comp.config.description}</p>}
            {comp.config?.buttonText && (
              <button className="px-6 py-2 bg-primary text-primary-foreground rounded-md">{comp.config.buttonText}</button>
            )}
          </div>
        );
      case "form":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            <h3 className="text-lg font-semibold mb-3">{comp.config?.heading || "Contact Form"}</h3>
            <p className="text-sm text-muted-foreground">{comp.config?.description || "Get in touch with us."}</p>
            <div className="mt-3 space-y-2 max-w-md">
              {(comp.config?.fields || []).map((f: any) => (
                <div key={f.id}>
                  <label className="text-xs font-medium">{f.label}</label>
                  <input className="w-full border rounded-md p-2 text-sm bg-background" placeholder={f.placeholder || f.label} readOnly />
                </div>
              ))}
            </div>
          </div>
        );
      case "grid":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            {comp.config?.heading && <h3 className="text-lg font-semibold mb-3">{comp.config.heading}</h3>}
            <div className={`grid gap-4 ${comp.config?.columns === 2 ? "grid-cols-2" : comp.config?.columns === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
              {(comp.config?.items || []).map((item: any) => (
                <div key={item.id} className="border rounded-md p-3">
                  <p className="font-medium text-sm">{item.title}</p>
                  {item.description && <p className="text-xs text-muted-foreground mt-1">{item.description}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      case "testimonial":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            {comp.config?.heading && <h3 className="text-lg font-semibold mb-3">{comp.config.heading}</h3>}
            <div className="space-y-4">
              {(comp.config?.testimonials || []).map((t: any) => (
                <div key={t.id} className="border rounded-md p-4">
                  <p className="text-sm italic mb-2">"{t.quote}"</p>
                  <p className="text-xs font-medium">{t.name}</p>
                  {t.title && <p className="text-xs text-muted-foreground">{t.title}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      case "feature-highlights":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            {comp.config?.heading && <h3 className="text-lg font-semibold mb-3">{comp.config.heading}</h3>}
            <div className="grid grid-cols-2 gap-4">
              {(comp.config?.features || []).map((f: any) => (
                <div key={f.id} className="p-3">
                  <p className="font-medium text-sm">{f.title}</p>
                  {f.description && <p className="text-xs text-muted-foreground mt-1">{f.description}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      case "gallery":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            {comp.config?.heading && <h3 className="text-lg font-semibold mb-3">{comp.config.heading}</h3>}
            <div className="grid grid-cols-3 gap-2">
              {(comp.config?.images || []).map((img: any) => (
                <div key={img.id} className="aspect-square bg-muted rounded-md overflow-hidden">
                  {img.url ? (
                    <img src={img.url} alt={img.alt || ""} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">No image</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      case "stats":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            {comp.config?.heading && <h3 className="text-lg font-semibold mb-3 text-center">{comp.config.heading}</h3>}
            <div className="grid grid-cols-3 gap-4 text-center">
              {(comp.config?.stats || []).map((s: any) => (
                <div key={s.id}>
                  <div className="text-2xl font-bold">{s.prefix}{s.value}{s.suffix}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case "faq":
        return (
          <div className="py-6 px-4" style={bgStyle}>
            <h3 className="text-lg font-semibold mb-3">{comp.config?.title || "FAQ"}</h3>
            {(comp.config?.items || []).map((item: any) => (
              <div key={item.id} className="border-b py-2">
                <p className="font-medium text-sm">{item.question}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.answer}</p>
              </div>
            ))}
          </div>
        );
      default:
        return (
          <div className="py-4 px-4 border rounded-md" style={bgStyle}>
            <p className="text-sm text-muted-foreground">{comp.label || comp.type}</p>
          </div>
        );
    }
  };

  const formatExpiry = () => {
    const d = new Date(expiresAt);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 bg-muted/80 backdrop-blur-sm border-b px-4 py-2">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {organization && <span className="text-sm font-medium">{organization.name}</span>}
            <Badge variant={page.isPublished ? "default" : "secondary"} className="text-[10px]">
              {page.isPublished ? "Published" : "Draft Preview"}
            </Badge>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Expires {formatExpiry()}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6" data-testid="text-preview-title">{page.pageTitle}</h1>
        {renderComponents()}
      </div>
    </div>
  );
}
