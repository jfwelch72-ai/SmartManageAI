/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Building2,
  Briefcase,
  Users,
  HardHat,
  FileText,
  Handshake,
  Truck,
  Wrench,
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  MessageSquare,
  Settings,
  PlusCircle,
  ArrowRight,
  Clock,
  Search as SearchIcon,
} from "lucide-react";
import {
  hasContractorAccess,
  hasManagementAccess,
  hasCrmAccess,
  canAccessBids,
  hasEquipmentAccess,
} from "@/lib/rbac";

export type SearchResultType =
  | "deal"
  | "organization"
  | "contact"
  | "project"
  | "bid"
  | "vendor"
  | "subcontractor";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string | null;
  url: string;
  icon?: string;
}

interface SearchResponse {
  results: SearchResult[];
}

const TYPE_LABEL: Record<SearchResultType, string> = {
  deal: "Deals",
  organization: "Clients & Organizations",
  contact: "Contacts",
  project: "Projects",
  bid: "Bids",
  vendor: "Vendors",
  subcontractor: "Subcontractors",
};

const TYPE_BADGE: Record<SearchResultType, string> = {
  deal: "Deal",
  organization: "Client",
  contact: "Contact",
  project: "Project",
  bid: "Bid",
  vendor: "Vendor",
  subcontractor: "Sub",
};

const TYPE_ORDER: SearchResultType[] = [
  "project",
  "bid",
  "deal",
  "organization",
  "contact",
  "vendor",
  "subcontractor",
];

function iconFor(type: SearchResultType) {
  switch (type) {
    case "project":
      return <Briefcase className="h-4 w-4" />;
    case "bid":
      return <FileText className="h-4 w-4" />;
    case "deal":
      return <Handshake className="h-4 w-4" />;
    case "organization":
      return <Building2 className="h-4 w-4" />;
    case "contact":
      return <Users className="h-4 w-4" />;
    case "vendor":
      return <Truck className="h-4 w-4" />;
    case "subcontractor":
      return <HardHat className="h-4 w-4" />;
  }
}

interface CatalogItem {
  id: string;
  label: string;
  url: string;
  icon: React.ReactNode;
  visible: (role: string | undefined) => boolean;
  keywords?: string;
}

const isSuper = (r: string | undefined) => r === "SUPER_ADMIN";
const allowAll = (check: (r?: string) => boolean) => (r: string | undefined) =>
  isSuper(r) || check(r);

const PAGES: CatalogItem[] = [
  { id: "dashboard", label: "Dashboard", url: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" />, visible: allowAll(hasContractorAccess), keywords: "home overview" },
  { id: "projects", label: "Projects", url: "/projects", icon: <Briefcase className="h-4 w-4" />, visible: allowAll(hasContractorAccess), keywords: "jobs work" },
  { id: "bids", label: "Bids", url: "/bids", icon: <FileText className="h-4 w-4" />, visible: allowAll(canAccessBids), keywords: "estimates proposals" },
  { id: "crm", label: "CRM", url: "/crm", icon: <Handshake className="h-4 w-4" />, visible: allowAll(hasCrmAccess), keywords: "deals pipeline contacts" },
  { id: "calendar", label: "Calendar", url: "/calendar", icon: <CalendarDays className="h-4 w-4" />, visible: allowAll(hasContractorAccess), keywords: "schedule events" },
  { id: "tasks", label: "Tasks", url: "/tasks", icon: <ClipboardList className="h-4 w-4" />, visible: allowAll(hasContractorAccess), keywords: "todo punchlist" },
  { id: "messages", label: "Messages", url: "/messages", icon: <MessageSquare className="h-4 w-4" />, visible: allowAll(hasContractorAccess), keywords: "chat inbox" },
  { id: "equipment", label: "Equipment", url: "/equipment", icon: <Wrench className="h-4 w-4" />, visible: allowAll(hasEquipmentAccess), keywords: "tools fleet" },
  { id: "settings", label: "Settings", url: "/settings", icon: <Settings className="h-4 w-4" />, visible: () => true, keywords: "profile preferences" },
];

const QUICK_ACTIONS: CatalogItem[] = [
  { id: "new-bid", label: "New Bid", url: "/bids/new", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(canAccessBids), keywords: "create add proposal estimate" },
  { id: "new-project", label: "New Project", url: "/projects?new=true", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasManagementAccess), keywords: "create add job" },
  { id: "new-deal", label: "New Deal", url: "/crm?tab=pipeline&new=true", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasCrmAccess), keywords: "create add opportunity pipeline" },
  { id: "new-contact", label: "New Contact", url: "/crm?tab=contacts&new=true", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasCrmAccess), keywords: "create add person" },
  { id: "new-organization", label: "New Organization", url: "/crm?tab=orgs&new=true", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasCrmAccess), keywords: "create add client company" },
  { id: "new-task", label: "Create Task", url: "/tasks?new=true", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasContractorAccess), keywords: "create add todo punchlist" },
  { id: "log-call", label: "Log Call", url: "/crm?tab=tasks", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasCrmAccess), keywords: "phone activity note" },
  { id: "go-projects", label: "Go to Projects", url: "/projects", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasManagementAccess), keywords: "open list jump" },
  { id: "go-tasks", label: "Go to Tasks", url: "/tasks", icon: <PlusCircle className="h-4 w-4" />, visible: allowAll(hasContractorAccess), keywords: "open list jump" },
];

const RECENTS_KEY_PREFIX = "smartmanage-cmdk-recents:";
const RECENTS_LIMIT = 5;

function loadRecents(userId: string | undefined): SearchResult[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY_PREFIX + userId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENTS_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecents(userId: string | undefined, items: SearchResult[]) {
  if (!userId) return;
  try {
    localStorage.setItem(RECENTS_KEY_PREFIX + userId, JSON.stringify(items.slice(0, RECENTS_LIMIT)));
  } catch {
    // ignore quota errors
  }
}

function matchesQuery(text: string, q: string): boolean {
  return text.toLowerCase().includes(q.toLowerCase());
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const [rawQuery, setRawQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recents, setRecents] = useState<SearchResult[]>(() => loadRecents(user?.id));

  useEffect(() => {
    setRecents(loadRecents(user?.id));
  }, [user?.id, open]);

  useEffect(() => {
    if (!open) {
      setRawQuery("");
      setDebounced("");
    }
  }, [open]);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(rawQuery.trim()), 180);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  const enabled = open && debounced.length > 0;
  const { data, isLoading } = useQuery<SearchResponse>({
    queryKey: ["/api/search", debounced],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(debounced)}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const map = new Map<SearchResultType, SearchResult[]>();
    for (const r of data?.results ?? []) {
      const arr = map.get(r.type) ?? [];
      arr.push(r);
      map.set(r.type, arr);
    }
    return TYPE_ORDER
      .map((t) => ({ type: t, items: map.get(t) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [data]);

  const role = user?.role;
  const visiblePages = useMemo(() => PAGES.filter((p) => p.visible(role)), [role]);
  const visibleActions = useMemo(() => QUICK_ACTIONS.filter((a) => a.visible(role)), [role]);

  // While typing, also include matching Pages and Quick Actions
  const matchingPages = useMemo(() => {
    if (!debounced) return [];
    return visiblePages.filter((p) =>
      matchesQuery(p.label, debounced) || (p.keywords && matchesQuery(p.keywords, debounced)),
    );
  }, [debounced, visiblePages]);

  const matchingActions = useMemo(() => {
    if (!debounced) return [];
    return visibleActions.filter((a) =>
      matchesQuery(a.label, debounced) || (a.keywords && matchesQuery(a.keywords, debounced)),
    );
  }, [debounced, visibleActions]);

  const navigateTo = useCallback(
    (url: string, recentItem?: SearchResult) => {
      onOpenChange(false);
      if (recentItem) {
        const next = [recentItem, ...recents.filter((r) => !(r.id === recentItem.id && r.type === recentItem.type))].slice(0, RECENTS_LIMIT);
        setRecents(next);
        saveRecents(user?.id, next);
      }
      setLocation(url);
    },
    [onOpenChange, recents, setLocation, user?.id],
  );

  const showResults = debounced.length > 0;
  const hasAnyTypedResults =
    grouped.length > 0 || matchingPages.length > 0 || matchingActions.length > 0;

  const body = (
    <Command
      shouldFilter={false}
      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 h-full"
    >
      <div data-testid="dialog-command-palette" className="flex flex-col h-full">
        <CommandInput
          placeholder="Search projects, bids, deals, contacts, vendors…"
          value={rawQuery}
          onValueChange={setRawQuery}
          data-testid="input-command-palette"
        />
        <CommandList data-testid="list-command-palette" className={isMobile ? "max-h-none flex-1" : undefined}>
          {showResults ? (
            <>
              {isLoading && (
                <div
                  className="py-6 text-center text-sm text-muted-foreground"
                  data-testid="status-command-palette-loading"
                >
                  Searching…
                </div>
              )}
              {!isLoading && !hasAnyTypedResults && (
                <CommandEmpty data-testid="empty-command-palette">
                  <div className="space-y-1">
                    <div className="font-medium">No matches for "{debounced}"</div>
                    <div className="text-xs text-muted-foreground">Try a different term, like a project code or contact name.</div>
                  </div>
                </CommandEmpty>
              )}
              {grouped.map((group) => (
                <CommandGroup
                  key={group.type}
                  heading={`${TYPE_LABEL[group.type]} (${group.items.length})`}
                >
                  {group.items.map((item) => (
                    <CommandItem
                      key={`${item.type}-${item.id}`}
                      value={`${item.type}-${item.id}-${item.title}`}
                      onSelect={() => navigateTo(item.url, item)}
                      data-testid={`result-${item.type}-${item.id}`}
                    >
                      {iconFor(item.type)}
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate">{item.title}</span>
                        {item.subtitle && (
                          <span className="text-xs text-muted-foreground truncate">{item.subtitle}</span>
                        )}
                      </div>
                      <Badge variant="secondary" className="ml-2 text-[10px] uppercase tracking-wide" data-testid={`badge-${item.type}-${item.id}`}>
                        {TYPE_BADGE[item.type]}
                      </Badge>
                      <ArrowRight className="h-3 w-3 opacity-40" />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {matchingPages.length > 0 && (
                <CommandGroup heading={`Pages (${matchingPages.length})`}>
                  {matchingPages.map((page) => (
                    <CommandItem
                      key={`typed-page-${page.id}`}
                      value={`typed-page-${page.id}-${page.label}`}
                      onSelect={() => navigateTo(page.url)}
                      data-testid={`result-page-${page.id}`}
                    >
                      {page.icon}
                      <span className="flex-1">{page.label}</span>
                      <Badge variant="outline" className="ml-2 text-[10px] uppercase tracking-wide">
                        Page
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {matchingActions.length > 0 && (
                <CommandGroup heading={`Quick Actions (${matchingActions.length})`}>
                  {matchingActions.map((action) => (
                    <CommandItem
                      key={`typed-action-${action.id}`}
                      value={`typed-action-${action.id}-${action.label}`}
                      onSelect={() => navigateTo(action.url)}
                      data-testid={`result-action-${action.id}`}
                    >
                      {action.icon}
                      <span className="flex-1">{action.label}</span>
                      <Badge variant="outline" className="ml-2 text-[10px] uppercase tracking-wide">
                        Action
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </>
          ) : (
            <div data-testid="idle-command-palette">
              {recents.length > 0 && (
                <CommandGroup heading="Recents" data-testid="group-recents">
                  {recents.map((item) => (
                    <CommandItem
                      key={`recent-${item.type}-${item.id}`}
                      value={`recent-${item.type}-${item.id}-${item.title}`}
                      onSelect={() => navigateTo(item.url, item)}
                      data-testid={`recent-${item.type}-${item.id}`}
                    >
                      <Clock className="h-4 w-4" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="truncate">{item.title}</span>
                        {item.subtitle && (
                          <span className="text-xs text-muted-foreground truncate">{item.subtitle}</span>
                        )}
                      </div>
                      <Badge variant="secondary" className="ml-2 text-[10px] uppercase tracking-wide">
                        {TYPE_BADGE[item.type]}
                      </Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {visiblePages.length > 0 && (
                <CommandGroup heading="Pages">
                  {visiblePages.map((page) => (
                    <CommandItem
                      key={page.id}
                      value={`page-${page.id}-${page.label}`}
                      onSelect={() => navigateTo(page.url)}
                      data-testid={`page-${page.id}`}
                    >
                      {page.icon}
                      <span>{page.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {visibleActions.length > 0 && (
                <CommandGroup heading="Quick Actions">
                  {visibleActions.map((action) => (
                    <CommandItem
                      key={action.id}
                      value={`action-${action.id}-${action.label}`}
                      onSelect={() => navigateTo(action.url)}
                      data-testid={`action-${action.id}`}
                    >
                      {action.icon}
                      <span>{action.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <div className="px-3 py-2 text-xs text-muted-foreground border-t flex items-center gap-2">
                <SearchIcon className="h-3 w-3" />
                Type to search across your organization
              </div>
            </div>
          )}
        </CommandList>
      </div>
    </Command>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[100dvh] w-screen max-w-none p-0 sm:max-w-none rounded-none border-0"
          data-testid="sheet-command-palette"
        >
          <VisuallyHidden>
            <DialogTitle>Command Palette</DialogTitle>
            <DialogDescription>Search projects, bids, deals, contacts, vendors, and navigate the app.</DialogDescription>
          </VisuallyHidden>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <VisuallyHidden>
          <DialogTitle>Command Palette</DialogTitle>
          <DialogDescription>Search projects, bids, deals, contacts, vendors, and navigate the app.</DialogDescription>
        </VisuallyHidden>
        {body}
      </DialogContent>
    </Dialog>
  );
}

interface CommandPaletteProviderProps {
  children?: React.ReactNode;
}

const COMMAND_PALETTE_EVENT = "open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
}

export function CommandPaletteProvider({ children }: CommandPaletteProviderProps) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const { user } = useAuth();

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        const target = e.target as HTMLElement | null;
        if (target?.isContentEditable) return;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
          if (!openRef.current) return;
        }
        // If another modal/dialog (not ours) is open, don't hijack the shortcut
        if (!openRef.current) {
          const openDialogs = document.querySelectorAll<HTMLElement>(
            '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          );
          for (const d of Array.from(openDialogs)) {
            if (!d.querySelector('[data-testid="dialog-command-palette"]')) {
              return;
            }
          }
        }
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }
    };
    const onEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_PALETTE_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_PALETTE_EVENT, onEvent);
    };
  }, []);

  if (!user) return <>{children}</>;

  return (
    <>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
