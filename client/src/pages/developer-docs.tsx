import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Search, BookOpen, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { Link } from "wouter";
import { useDebounce } from "@/hooks/use-debounce";

interface ModuleListItem {
  id: string;
  title: string;
}

interface ModuleDoc {
  module: string;
  content: string;
}

interface SearchResult {
  module: string;
  title: string;
  snippets: string[];
}

interface SearchResponse {
  results: SearchResult[];
}

const MODULE_DESCRIPTIONS: Record<string, string> = {
  auth: "JWT auth, MFA, SSO, passkeys, session management",
  onboarding: "AI-assisted wizard, org setup, trade library seeding",
  dashboard: "Widget grid, portfolio view, CFO analytics, KPI snapshots",
  estimating: "Bid lifecycle, estimates, vendor quotes, cost book, hit-rate analytics",
  takeoff: "Canvas takeoff, measurements, assemblies, AI auto-detect, calibration",
  projects: "Project CRUD, Gantt/CPM schedule, templates, health snapshots",
  "field-ops": "Daily reports, time clock, dispatch board, field productivity",
  financials: "SOV, AIA G702/G703, payroll, cost ledger, WIP, lien waivers",
  procurement: "POs, receipts, vendor invoices, 3-way match",
  "document-control": "RFIs, submittals, transmittals, drawing sets, contracts, closeout",
  "heavy-civil-dot": "DOT library, haul tickets, IDRs, SWPPP, DBE goals, surety bonds",
  crm: "Contacts, deals pipeline, calls, email threads, sequences, lead forms",
  equipment: "Fleet management, assignments, repairs, maintenance, rental catalog",
  inventory: "Locations, materials, stock levels, transactions, cycle counts",
  safety: "Incidents, OSHA tracking, safety training, toolbox talks, checklists",
  workforce: "Crews, skills, ATS hiring, performance reviews, leave management",
  messaging: "Conversations, messages, reactions, video calls, real-time delivery",
  notifications: "Email, web push, SMS, Slack/Teams, approval workflow notifications",
  portals: "Client portal, sub/vendor portal, portal chat, public booking/forms",
  "website-builder": "Org websites, pages, blog posts, social posts, deployments, SEO",
  integrations: "QuickBooks, Sage, Autodesk, Zapier, OAuth connections, API keys",
  "ai-orchestration": "Provider routing, prompt injection guard, AI estimator, governance",
  "platform-admin": "Org management, impersonation, feature flags, job queue, audit logs",
  "vendor-marketplace": "Bid network, marketplace, vendor scores, pricing catalog, Hustler",
};

function escapeCode(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const HL_KEYWORDS = [
  "const", "let", "var", "function", "class", "import", "export", "from",
  "return", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "new", "typeof", "instanceof", "void", "null", "undefined",
  "true", "false", "async", "await", "try", "catch", "finally", "throw",
  "interface", "type", "extends", "implements", "enum", "readonly", "public",
  "private", "protected", "static", "abstract", "default", "of", "in",
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "TABLE",
  "INDEX", "JOIN", "AND", "OR", "NOT", "AS", "def", "pass", "import",
];

const KW_RE = new RegExp(`\\b(${HL_KEYWORDS.join("|")})\\b`, "g");

function highlightLine(raw: string): string {
  const placeholders: string[] = [];

  let s = raw.replace(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|`[^`]*`/g, (m) => {
    placeholders.push(`<span class="text-amber-500 dark:text-amber-400">${escapeCode(m)}</span>`);
    return `\x00${placeholders.length - 1}\x00`;
  });

  s = escapeCode(s);
  s = s.replace(KW_RE, '<span class="text-blue-500 dark:text-blue-400">$1</span>');
  s = s.replace(/\b(\d+\.?\d*)\b/g, '<span class="text-purple-500 dark:text-purple-400">$1</span>');
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => placeholders[parseInt(i, 10)]);
  return s;
}

function highlightCode(code: string, lang: string): string {
  const supported = [
    "js", "javascript", "ts", "typescript", "tsx", "jsx", "bash", "sh",
    "json", "sql", "python", "py",
  ];
  const l = lang.toLowerCase();
  if (!supported.includes(l)) return escapeCode(code);

  return code
    .split("\n")
    .map((line) => {
      const commentIdx = line.search(/\/\/|#(?!\w)/);
      if (commentIdx >= 0 && l !== "json") {
        const before = line.slice(0, commentIdx);
        const comment = escapeCode(line.slice(commentIdx));
        return (
          highlightLine(before) +
          `<span class="text-emerald-600 dark:text-emerald-400">${comment}</span>`
        );
      }
      return highlightLine(line);
    })
    .join("\n");
}

function renderMarkdown(md: string): string {
  const codeBlocks: string[] = [];

  let processed = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const language = lang || "text";
    const highlighted = highlightCode(code.replace(/\n$/, ""), language);
    const label = language !== "text" ? language : "";
    const block = `<div class="my-4 rounded-lg overflow-hidden border border-border/60">
      ${label ? `<div class="flex items-center justify-between px-3 py-1 bg-muted/70 border-b border-border/40"><span class="text-xs font-mono text-muted-foreground">${escapeCode(label)}</span></div>` : ""}
      <pre class="p-4 bg-zinc-950 dark:bg-zinc-900 overflow-x-auto text-xs leading-relaxed"><code class="font-mono text-zinc-100">${highlighted}</code></pre>
    </div>`;
    codeBlocks.push(block);
    return `\x01CODE${codeBlocks.length - 1}\x01`;
  });

  processed = processed
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-5 mb-2 text-foreground">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-7 mb-3 text-foreground border-b pb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mb-4 text-foreground">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>'
    )
    .replace(/^\| (.+) \|$/gm, (row) => {
      const cells = row.split("|").slice(1, -1);
      const isDivider = cells.every((c) => /^[\s\-:]+$/.test(c.trim()));
      if (isDivider) return "";
      return `<tr class="border-b border-border/50">${cells
        .map(
          (c) =>
            `<td class="px-3 py-1.5 text-sm align-top">${c.trim()}</td>`
        )
        .join("")}</tr>`;
    })
    .replace(/((?:<tr[^>]*>.*?<\/tr>\n?)+)/gs, (match) => {
      const rows = match.trim().split("\n");
      if (!rows.length) return match;
      const [head, ...rest] = rows;
      const headerRow = head.replace(/<td/g, "<th").replace(/<\/td>/g, "</th>");
      return `<div class="overflow-x-auto my-4"><table class="w-full border-collapse text-sm"><thead class="bg-muted/60 font-medium">${headerRow}</thead><tbody>${rest.join("")}</tbody></table></div>`;
    })
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-sm mb-0.5 list-disc list-inside">$1</li>')
    .replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/gs, (match) => `<ul class="my-2">${match}</ul>`)
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-primary underline underline-offset-2 text-sm">$1</a>'
    )
    .replace(/\n{2,}/g, '</p><p class="mb-2 text-sm text-foreground/80">')
    .replace(/^([^<\n].+)$/gm, (line) => {
      if (line.startsWith("<") || line.trim() === "" || line.includes("\x01")) return line;
      return `<span class="text-sm text-foreground/80">${line}</span>`;
    });

  processed = processed.replace(
    /\x01CODE(\d+)\x01/g,
    (_, i) => codeBlocks[parseInt(i, 10)]
  );

  return processed;
}

function highlightSnippet(text: string, query: string): string {
  if (!query) return escapeCode(text);
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escapeCode(text).replace(
    re,
    (m) => `<mark class="bg-yellow-200 dark:bg-yellow-700 rounded">${m}</mark>`
  );
}

export default function DeveloperDocsPage() {
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 350);

  const { data: moduleList, isLoading: listLoading } = useQuery<{
    modules: ModuleListItem[];
  }>({ queryKey: ["/api/dev-docs"] });

  const { data: docData, isLoading: docLoading } = useQuery<ModuleDoc>({
    queryKey: ["/api/dev-docs", selectedModule],
    enabled: !!selectedModule,
  });

  const isSearching = debouncedSearch.length >= 2;

  const { data: searchData, isLoading: searchLoading } = useQuery<SearchResponse>({
    queryKey: ["/api/dev-docs/search", { q: debouncedSearch }],
    enabled: isSearching,
  });

  const filteredModules = useMemo(() => {
    if (!moduleList?.modules) return [];
    if (isSearching) return [];
    if (!searchQuery.trim()) return moduleList.modules;
    const q = searchQuery.toLowerCase();
    return moduleList.modules.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (MODULE_DESCRIPTIONS[m.id] || "").toLowerCase().includes(q)
    );
  }, [moduleList, searchQuery, isSearching]);

  const currentModule = moduleList?.modules.find((m) => m.id === selectedModule);

  const renderedContent = useMemo(() => {
    if (!docData?.content) return "";
    return renderMarkdown(docData.content);
  }, [docData?.content]);

  const handleSelectModule = (id: string) => {
    setSelectedModule(id);
    setSearchQuery("");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-72 border-r flex flex-col flex-shrink-0">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="h-5 w-5 text-primary" />
            <h1 className="font-semibold text-sm">Developer Docs</h1>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              data-testid="input-docs-search"
              placeholder="Search all docs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {isSearching && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {searchLoading ? "Searching…" : `${searchData?.results.length ?? 0} modules matched`}
            </p>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {isSearching ? (
              searchLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 mb-1 rounded-md" />
                ))
              ) : !searchData?.results.length ? (
                <p className="text-xs text-muted-foreground px-2 py-3">
                  No matches found across all docs.
                </p>
              ) : (
                searchData.results.map((r) => (
                  <button
                    key={r.module}
                    data-testid={`button-search-result-${r.module}`}
                    onClick={() => handleSelectModule(r.module)}
                    className={`w-full text-left px-3 py-2 rounded-md mb-0.5 transition-colors ${
                      selectedModule === r.module
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <div className="text-sm font-medium leading-tight">{r.title}</div>
                    {r.snippets.slice(0, 1).map((snip, si) => (
                      <p
                        key={si}
                        className="text-xs text-muted-foreground mt-0.5 line-clamp-2"
                        dangerouslySetInnerHTML={{
                          __html: highlightSnippet(snip, debouncedSearch),
                        }}
                      />
                    ))}
                  </button>
                ))
              )
            ) : listLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 mb-1 rounded-md" />
              ))
            ) : filteredModules.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-3">
                No modules match your search.
              </p>
            ) : (
              filteredModules.map((m) => (
                <button
                  key={m.id}
                  data-testid={`button-module-${m.id}`}
                  onClick={() => handleSelectModule(m.id)}
                  className={`w-full text-left px-3 py-2 rounded-md mb-0.5 transition-colors ${
                    selectedModule === m.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <div className="text-sm font-medium leading-tight">{m.title}</div>
                  {MODULE_DESCRIPTIONS[m.id] && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {MODULE_DESCRIPTIONS[m.id]}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="p-3 border-t">
          <Link href="/developer-portal" data-testid="link-developer-portal">
            <a className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink className="h-3 w-3" />
              Developer Portal (API Keys)
            </a>
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col">
        {!selectedModule ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-semibold mb-2">Select a Module</h2>
            <p className="text-sm text-muted-foreground max-w-sm">
              Choose a feature module from the left panel to view its technical documentation
              — data models, API routes, frontend pages, roles, and integration points.
            </p>
            <p className="text-xs text-muted-foreground mt-2 max-w-sm">
              Use the search bar to find content <em>across all 24 module docs</em> at once.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-lg">
              {(moduleList?.modules || []).slice(0, 8).map((m) => (
                <button
                  key={m.id}
                  data-testid={`badge-module-${m.id}`}
                  onClick={() => handleSelectModule(m.id)}
                  className="text-xs"
                >
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                    {m.title}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="px-6 py-3 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">docs/features/</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span
                  className="text-sm font-medium"
                  data-testid="text-module-title"
                >
                  {currentModule?.title}
                </span>
              </div>
              <Badge
                variant="secondary"
                className="font-mono text-xs"
                data-testid="badge-module-id"
              >
                {selectedModule}.md
              </Badge>
            </div>

            <ScrollArea className="flex-1">
              <div className="px-8 py-6 max-w-4xl">
                {docLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-7 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-5 w-1/3 mt-6" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-32 w-full mt-2" />
                  </div>
                ) : docData?.content ? (
                  <article
                    data-testid="article-module-content"
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: renderedContent }}
                  />
                ) : (
                  <Alert>
                    <AlertDescription>
                      Documentation for this module could not be loaded.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </main>
    </div>
  );
}
