import { Link } from "wouter";
import { FlaskConical, ExternalLink } from "lucide-react";
import { PREVIEW_ROUTES } from "./preview-registry";

/**
 * Task #2289 — Dev-only index page that lists every component
 * preview/harness route registered in `preview-registry.ts`.
 *
 * Mounted at `/preview` (and `/dev`) behind `import.meta.env.DEV` in
 * `App.tsx`, so this surface never ships to production builds.
 */
export default function PreviewIndexPage() {
  const sorted = [...PREVIEW_ROUTES].sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  return (
    <div
      className="min-h-screen bg-background py-10 px-4"
      data-testid="page-preview-index"
    >
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h1
                className="text-2xl font-semibold text-foreground"
                data-testid="text-preview-index-title"
              >
                Component Previews
              </h1>
              <p className="text-sm text-muted-foreground">
                Dev-only storybook-style harnesses for components that are
                hard to reach in the running app. Add new entries to
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                  client/src/pages/dev/preview-registry.ts
                </code>
                .
              </p>
            </div>
          </div>
          <p
            className="text-xs text-muted-foreground"
            data-testid="text-preview-index-count"
          >
            {sorted.length} preview{sorted.length === 1 ? "" : "s"} registered
          </p>
        </header>

        <ul className="space-y-3">
          {sorted.map((entry) => (
            <li key={entry.path}>
              <Link
                href={entry.path}
                className="block rounded-lg border border-border bg-card p-4 transition hover:border-primary hover:bg-accent/40"
                data-testid={`link-preview-${entry.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2
                        className="text-base font-medium text-foreground"
                        data-testid={`text-preview-title-${entry.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`}
                      >
                        {entry.title}
                      </h2>
                      {entry.task ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
                          {entry.task}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {entry.description}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground/80">
                      {entry.path}
                    </p>
                  </div>
                  <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
