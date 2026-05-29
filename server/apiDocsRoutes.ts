import type { Express, Request, Response } from "express";

// prompt-injection-guard: this file contains no LLM calls

interface RouteEntry {
  method: string;
  path: string;
  group: string;
}

function extractRoutes(app: Express): RouteEntry[] {
  const routes: RouteEntry[] = [];

  function walk(stack: any[], prefix: string) {
    for (const layer of stack) {
      if (!layer) continue;

      if (layer.route) {
        const routePath: string = prefix + (layer.route.path || "");
        const methods: string[] = Object.keys(layer.route.methods || {}).filter(
          (m) => m !== "_all" && layer.route.methods[m]
        );
        for (const method of methods) {
          routes.push({
            method: method.toUpperCase(),
            path: routePath,
            group: deriveGroup(routePath),
          });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        const mountPath: string =
          layer.regexp?.source
            ?.replace(/\\\//g, "/")
            ?.replace(/\^/g, "")
            ?.replace(/\?\(\?=\/\|\$\)/g, "")
            ?.replace(/\/\?\(\?=\/\|\$\)/g, "")
            ?.replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, ":param")
            ?.replace(/\?\?/g, "")
            ?.replace(/\/$/g, "") || "";

        const cleanMount =
          mountPath.startsWith("/") ? mountPath : prefix;

        walk(layer.handle.stack, cleanMount === prefix ? prefix : cleanMount);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  }

  const routerStack = (app as any)._router?.stack || [];
  walk(routerStack, "");

  return routes
    .filter((r) => r.path)
    .sort((a, b) => a.group.localeCompare(b.group) || a.path.localeCompare(b.path));
}

function deriveGroup(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "api" && segments[1]) {
    const tag = segments[1];
    if (tag === "v1" && segments[2]) return segments[2];
    return tag;
  }
  if (segments[0]) return segments[0];
  return "misc";
}

function groupRoutes(routes: RouteEntry[]): Record<string, RouteEntry[]> {
  const groups: Record<string, RouteEntry[]> = {};
  for (const r of routes) {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push(r);
  }
  return groups;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "#61affe",
  POST: "#49cc90",
  PUT: "#fca130",
  PATCH: "#50e3c2",
  DELETE: "#f93e3e",
  OPTIONS: "#0d5aa7",
  HEAD: "#9012fe",
};

function buildHtml(routes: RouteEntry[]): string {
  const groups = groupRoutes(routes);
  const total = routes.length;
  const groupCount = Object.keys(groups).length;

  const groupsHtml = Object.entries(groups)
    .map(([group, entries]) => {
      const rowsHtml = entries
        .map((e) => {
          const color = METHOD_COLORS[e.method] || "#888";
          return `
            <div class="route-row">
              <span class="badge" style="background:${color}">${e.method}</span>
              <span class="path">${escapeHtml(e.path)}</span>
            </div>`;
        })
        .join("");

      return `
        <details class="group" open>
          <summary class="group-title">
            <span class="group-name">${escapeHtml(group)}</span>
            <span class="group-count">${entries.length}</span>
          </summary>
          <div class="routes">${rowsHtml}</div>
        </details>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>API Reference — SmartManageAI</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    header { background: #1e293b; border-bottom: 1px solid #334155; padding: 20px 32px; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 1.25rem; font-weight: 700; color: #f1f5f9; }
    header .subtitle { font-size: 0.8rem; color: #94a3b8; margin-top: 2px; }
    .stats { margin-left: auto; display: flex; gap: 24px; }
    .stat { text-align: right; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: #60a5fa; }
    .stat-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .toolbar { padding: 16px 32px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; gap: 12px; align-items: center; }
    .toolbar input { flex: 1; max-width: 400px; background: #0f172a; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 6px; font-size: 0.875rem; outline: none; }
    .toolbar input:focus { border-color: #3b82f6; }
    .toolbar a { font-size: 0.8rem; color: #60a5fa; text-decoration: none; padding: 8px 12px; border: 1px solid #334155; border-radius: 6px; }
    .toolbar a:hover { background: #1e293b; }
    main { max-width: 1100px; margin: 0 auto; padding: 32px; }
    .group { margin-bottom: 16px; border: 1px solid #1e293b; border-radius: 8px; overflow: hidden; background: #1e293b; }
    .group-title { list-style: none; padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 10px; user-select: none; }
    .group-title::-webkit-details-marker { display: none; }
    .group-title::before { content: "▶"; font-size: 0.65rem; color: #64748b; transition: transform 0.15s; display: inline-block; }
    details[open] .group-title::before { transform: rotate(90deg); }
    .group-name { font-weight: 600; font-size: 0.95rem; text-transform: capitalize; color: #f1f5f9; }
    .group-count { margin-left: auto; background: #0f172a; color: #94a3b8; font-size: 0.7rem; padding: 2px 8px; border-radius: 999px; border: 1px solid #334155; }
    .routes { border-top: 1px solid #334155; }
    .route-row { display: flex; align-items: center; gap: 14px; padding: 9px 16px; border-bottom: 1px solid #0f172a; transition: background 0.1s; }
    .route-row:last-child { border-bottom: none; }
    .route-row:hover { background: #0f172a; }
    .badge { font-size: 0.65rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; color: #fff; min-width: 58px; text-align: center; letter-spacing: 0.04em; flex-shrink: 0; }
    .path { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.83rem; color: #cbd5e1; word-break: break-all; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>SmartManageAI — API Reference</h1>
      <div class="subtitle">Live route registry · ${new Date().toUTCString()}</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">Endpoints</div></div>
      <div class="stat"><div class="stat-value">${groupCount}</div><div class="stat-label">Groups</div></div>
    </div>
  </header>
  <div class="toolbar">
    <input id="search" type="text" placeholder="Filter routes…" autocomplete="off" />
    <a href="/api/docs" target="_blank">JSON</a>
    <a href="/api-docs" target="_blank">Swagger UI</a>
  </div>
  <main id="main">${groupsHtml}</main>
  <script>
    const input = document.getElementById('search');
    input.addEventListener('input', () => {
      const q = input.value.toLowerCase().trim();
      document.querySelectorAll('.group').forEach(group => {
        let anyVisible = false;
        group.querySelectorAll('.route-row').forEach(row => {
          const text = row.textContent.toLowerCase();
          const match = !q || text.includes(q);
          row.classList.toggle('hidden', !match);
          if (match) anyVisible = true;
        });
        group.classList.toggle('hidden', !anyVisible);
      });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function registerApiDocsRoutes(app: Express): void {
  app.get("/api/docs", (_req: Request, res: Response) => {
    const routes = extractRoutes(app);
    res.json({
      title: "SmartManageAI API",
      generatedAt: new Date().toISOString(),
      totalEndpoints: routes.length,
      groups: groupRoutes(routes),
    });
  });

  app.get("/api/docs/ui", (_req: Request, res: Response) => {
    const routes = extractRoutes(app);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(buildHtml(routes));
  });
}
