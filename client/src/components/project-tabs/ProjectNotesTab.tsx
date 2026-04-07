import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  FileText,
  Trash2,
  MoreVertical,
  Pencil,
  Check,
  X,
  Heading1,
  Heading2,
  Heading3,
  Type,
  List,
  ListOrdered,
  CheckSquare,
  Minus,
  Loader2,
  StickyNote,
  ChevronUp,
  ChevronDown,
  Filter,
  Bold,
  Italic,
  Underline,
  Strikethrough,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type BlockType = "HEADING1" | "HEADING2" | "HEADING3" | "PARAGRAPH" | "BULLETED_LIST" | "NUMBERED_LIST" | "TODO" | "DIVIDER";

interface NotePage {
  id: string;
  projectId: string;
  title: string;
  authorId: string;
  authorFirstName: string | null;
  authorLastName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NoteBlock {
  id: string;
  pageId: string;
  type: BlockType;
  content: { text?: string };
  sortOrder: number;
  checked: boolean | null;
  createdAt: string;
  updatedAt: string;
}

type TodoFilter = "all" | "open" | "completed";

const BLOCK_TYPE_CONFIG: Record<BlockType, { label: string; icon: typeof Type; shortcut: string }> = {
  HEADING1: { label: "Heading 1", icon: Heading1, shortcut: "h1" },
  HEADING2: { label: "Heading 2", icon: Heading2, shortcut: "h2" },
  HEADING3: { label: "Heading 3", icon: Heading3, shortcut: "h3" },
  PARAGRAPH: { label: "Text", icon: Type, shortcut: "text" },
  BULLETED_LIST: { label: "Bullet List", icon: List, shortcut: "bullet" },
  NUMBERED_LIST: { label: "Numbered List", icon: ListOrdered, shortcut: "number" },
  TODO: { label: "To-do", icon: CheckSquare, shortcut: "todo" },
  DIVIDER: { label: "Divider", icon: Minus, shortcut: "divider" },
};

interface ProjectNotesTabProps {
  projectId: string;
}

export default function ProjectNotesTab({ projectId }: ProjectNotesTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [todoFilter, setTodoFilter] = useState<TodoFilter>("all");

  const { data: pages = [], isLoading: pagesLoading } = useQuery<NotePage[]>({
    queryKey: ["/api/projects", projectId, "note-pages"],
    enabled: !!projectId,
  });

  useEffect(() => {
    if (pages.length > 0 && !selectedPageId) {
      setSelectedPageId(pages[0].id);
    }
    if (selectedPageId && pages.length > 0 && !pages.find(p => p.id === selectedPageId)) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  const createPageMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/projects/${projectId}/note-pages`, { title: "Untitled" });
    },
    onSuccess: async (response) => {
      const newPage = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "note-pages"] });
      setSelectedPageId(newPage.id);
      setEditingTitle(newPage.id);
      setTitleInput("Untitled");
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to create page" });
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: async ({ pageId, title }: { pageId: string; title: string }) => {
      return apiRequest("PATCH", `/api/projects/${projectId}/note-pages/${pageId}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "note-pages"] });
      setEditingTitle(null);
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to rename page" });
    },
  });

  const deletePageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      return apiRequest("DELETE", `/api/projects/${projectId}/note-pages/${pageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "note-pages"] });
      if (selectedPageId === deletePageId) {
        setSelectedPageId(null);
      }
      setDeletePageId(null);
      toast({ title: "Page deleted" });
    },
  });

  const handleSaveTitle = (pageId: string) => {
    if (titleInput.trim()) {
      updateTitleMutation.mutate({ pageId, title: titleInput.trim() });
    } else {
      setEditingTitle(null);
    }
  };

  const selectedPage = pages.find(p => p.id === selectedPageId);

  if (pagesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-280px)] min-h-[500px] border rounded-lg overflow-hidden bg-background" data-testid="project-notes-tab">
      <div className="w-72 border-r flex flex-col bg-muted/30">
        <div className="p-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold">Pages</h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => createPageMutation.mutate()}
            disabled={createPageMutation.isPending}
            data-testid="button-create-note-page"
          >
            {createPageMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {pages.map((page) => (
              <div
                key={page.id}
                className={cn(
                  "group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors",
                  selectedPageId === page.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted"
                )}
                onClick={() => setSelectedPageId(page.id)}
                data-testid={`note-page-item-${page.id}`}
              >
                <FileText className="h-4 w-4 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {editingTitle === page.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Input
                        value={titleInput}
                        onChange={(e) => setTitleInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTitle(page.id);
                          if (e.key === "Escape") setEditingTitle(null);
                        }}
                        className="h-6 text-sm px-1"
                        autoFocus
                        data-testid="input-page-title"
                      />
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => handleSaveTitle(page.id)}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setEditingTitle(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="truncate">{page.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {page.authorFirstName} {page.authorLastName} · {format(new Date(page.updatedAt), "MMM d")}
                      </div>
                    </>
                  )}
                </div>
                {editingTitle !== page.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        data-testid={`button-page-menu-${page.id}`}
                      >
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTitle(page.id);
                          setTitleInput(page.title);
                        }}
                        data-testid="button-rename-page"
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletePageId(page.id);
                        }}
                        data-testid="button-delete-page"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedPage ? (
          <BlockEditor
            projectId={projectId}
            pageId={selectedPage.id}
            pageTitle={selectedPage.title}
            todoFilter={todoFilter}
            onTodoFilterChange={setTodoFilter}
          />
        ) : (
          <EmptyState onCreatePage={() => createPageMutation.mutate()} isCreating={createPageMutation.isPending} />
        )}
      </div>

      <AlertDialog open={!!deletePageId} onOpenChange={(open) => !open && setDeletePageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this page and all its content. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletePageId && deletePageMutation.mutate(deletePageId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onCreatePage, isCreating }: { onCreatePage: () => void; isCreating: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center" data-testid="empty-state-notes">
      <div className="text-center space-y-4">
        <StickyNote className="h-16 w-16 mx-auto text-muted-foreground/50" />
        <div>
          <h3 className="text-lg font-semibold">No project notes yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Create your first page to start documenting</p>
        </div>
        <Button onClick={onCreatePage} disabled={isCreating} data-testid="button-create-first-page">
          {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          Create First Page
        </Button>
      </div>
    </div>
  );
}

function FormatToolbar({ onFormat }: { onFormat: (tag: string) => void }) {
  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-muted/20" data-testid="format-toolbar">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
            onMouseDown={(e) => { e.preventDefault(); onFormat("b"); }}
            data-testid="button-format-bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Bold (Ctrl+B)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
            onMouseDown={(e) => { e.preventDefault(); onFormat("i"); }}
            data-testid="button-format-italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Italic (Ctrl+I)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
            onMouseDown={(e) => { e.preventDefault(); onFormat("u"); }}
            data-testid="button-format-underline"
          >
            <Underline className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Underline (Ctrl+U)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
            onMouseDown={(e) => { e.preventDefault(); onFormat("s"); }}
            data-testid="button-format-strikethrough"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Strikethrough</TooltipContent>
      </Tooltip>
    </div>
  );
}

interface BlockEditorProps {
  projectId: string;
  pageId: string;
  pageTitle: string;
  todoFilter: TodoFilter;
  onTodoFilterChange: (f: TodoFilter) => void;
}

function BlockEditor({ projectId, pageId, pageTitle, todoFilter, onTodoFilterChange }: BlockEditorProps) {
  const { toast } = useToast();
  const [slashMenuBlockId, setSlashMenuBlockId] = useState<string | null>(null);
  const [slashMenuPosition, setSlashMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [slashFilter, setSlashFilter] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Map<string, HTMLElement>>(new Map());
  const saveTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const focusBlockId = useRef<string | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const editorEl = editorRef.current;
        if (editorEl && editorEl.contains(range.commonAncestorContainer)) {
          savedSelectionRef.current = range.cloneRange();
        }
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  const blocksQueryKey = ["/api/projects", projectId, "note-pages", pageId, "blocks"];
  const pagesQueryKey = ["/api/projects", projectId, "note-pages"];

  const { data: blocks = [], isLoading } = useQuery<NoteBlock[]>({
    queryKey: blocksQueryKey,
    enabled: !!pageId,
  });

  const hasTodos = blocks.some(b => b.type === "TODO");

  const filteredBlocks = useMemo(() => {
    if (todoFilter === "all" || !hasTodos) return blocks;
    return blocks.filter(b => {
      if (b.type !== "TODO") return true;
      if (todoFilter === "open") return !b.checked;
      if (todoFilter === "completed") return !!b.checked;
      return true;
    });
  }, [blocks, todoFilter, hasTodos]);

  const createBlockMutation = useMutation({
    mutationFn: async (data: { type: BlockType; sortOrder: number; content?: { text?: string } }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/note-pages/${pageId}/blocks`, {
        type: data.type,
        sortOrder: data.sortOrder,
        content: data.content || { text: "" },
        checked: data.type === "TODO" ? false : undefined,
      });
      return res.json();
    },
    onSuccess: (newBlock: NoteBlock) => {
      queryClient.invalidateQueries({ queryKey: blocksQueryKey });
      queryClient.invalidateQueries({ queryKey: pagesQueryKey });
      focusBlockId.current = newBlock.id;
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to create block" });
    },
  });

  const updateBlockMutation = useMutation({
    mutationFn: async ({ blockId, ...data }: { blockId: string; type?: BlockType; content?: { text?: string }; checked?: boolean; sortOrder?: number }) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/note-pages/${pageId}/blocks/${blockId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: blocksQueryKey });
      queryClient.invalidateQueries({ queryKey: pagesQueryKey });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to update block" });
    },
  });

  const deleteBlockMutation = useMutation({
    mutationFn: async (blockId: string) => {
      return apiRequest("DELETE", `/api/projects/${projectId}/note-pages/${pageId}/blocks/${blockId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: blocksQueryKey });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete block" });
    },
  });

  const reorderBlocksMutation = useMutation({
    mutationFn: async (blockOrders: { id: string; sortOrder: number }[]) => {
      return apiRequest("PUT", `/api/projects/${projectId}/note-pages/${pageId}/blocks/reorder`, { blocks: blockOrders });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: blocksQueryKey });
      queryClient.invalidateQueries({ queryKey: pagesQueryKey });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Error", description: "Failed to reorder blocks" });
    },
  });

  useEffect(() => {
    if (focusBlockId.current) {
      const el = blockRefs.current.get(focusBlockId.current);
      if (el) {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      focusBlockId.current = null;
    }
  }, [blocks]);

  const debouncedSave = useCallback((blockId: string, content: { text?: string }) => {
    const existing = saveTimers.current.get(blockId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      updateBlockMutation.mutate({ blockId, content });
      saveTimers.current.delete(blockId);
    }, 600);
    saveTimers.current.set(blockId, timer);
  }, [updateBlockMutation]);

  const flushPendingSaves = useCallback(() => {
    saveTimers.current.forEach((timer, blockId) => {
      clearTimeout(timer);
      const el = blockRefs.current.get(blockId);
      if (el) {
        updateBlockMutation.mutate({ blockId, content: { text: el.innerHTML } });
      }
    });
    saveTimers.current.clear();
  }, [updateBlockMutation]);

  useEffect(() => {
    return () => {
      saveTimers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    return () => {
      flushPendingSaves();
    };
  }, [pageId]);

  const handleBlockInput = useCallback((blockId: string, html: string) => {
    debouncedSave(blockId, { text: html });
  }, [debouncedSave]);

  const handleFormat = useCallback((tag: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      if (savedSelectionRef.current) {
        sel?.removeAllRanges();
        sel?.addRange(savedSelectionRef.current);
      } else {
        return;
      }
    }
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const editorEl = editorRef.current;
    if (!editorEl || !editorEl.contains(range.commonAncestorContainer)) return;

    const parentBlock = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as HTMLElement).closest("[contenteditable]")
      : (range.commonAncestorContainer.parentElement)?.closest("[contenteditable]");

    if (!parentBlock) return;

    const existingTag = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as HTMLElement
      : range.commonAncestorContainer.parentElement);
    const alreadyWrapped = existingTag?.closest(tag);
    
    if (alreadyWrapped && alreadyWrapped !== parentBlock) {
      const textNode = document.createTextNode(alreadyWrapped.textContent || "");
      alreadyWrapped.parentNode?.replaceChild(textNode, alreadyWrapped);
    } else {
      const wrapper = document.createElement(tag);
      const contents = range.extractContents();
      wrapper.appendChild(contents);
      range.insertNode(wrapper);
    }

    sel.removeAllRanges();

    const blockId = parentBlock.getAttribute("data-testid")?.replace("block-content-", "");
    if (blockId) {
      handleBlockInput(blockId, parentBlock.innerHTML);
    }
  }, [handleBlockInput]);

  const handleBlockKeyDown = useCallback((e: React.KeyboardEvent, block: NoteBlock, index: number) => {
    const target = e.target as HTMLElement;
    const text = target.textContent || "";

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const newSortOrder = block.sortOrder + 1;
      const blocksToShift = blocks.filter(b => b.sortOrder >= newSortOrder);
      if (blocksToShift.length > 0) {
        reorderBlocksMutation.mutate(
          blocksToShift.map(b => ({ id: b.id, sortOrder: b.sortOrder + 1 }))
        );
      }
      createBlockMutation.mutate({
        type: block.type === "TODO" ? "TODO" : block.type === "BULLETED_LIST" ? "BULLETED_LIST" : block.type === "NUMBERED_LIST" ? "NUMBERED_LIST" : "PARAGRAPH",
        sortOrder: newSortOrder,
      });
    }

    if (e.key === "Backspace" && text === "" && blocks.length > 1) {
      e.preventDefault();
      deleteBlockMutation.mutate(block.id);
      const prevBlock = filteredBlocks[index - 1];
      if (prevBlock) {
        focusBlockId.current = prevBlock.id;
      }
    }

    if (e.key === "/" && text === "") {
      const rect = target.getBoundingClientRect();
      const editorRect = editorRef.current?.getBoundingClientRect();
      if (editorRect) {
        setSlashMenuBlockId(block.id);
        setSlashMenuPosition({
          top: rect.bottom - editorRect.top + 4,
          left: rect.left - editorRect.left,
        });
        setSlashFilter("");
      }
    }

    if (e.key === "ArrowUp" && index > 0) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.startOffset === 0 && range.collapsed) {
          e.preventDefault();
          const prevBlock = filteredBlocks[index - 1];
          if (prevBlock) focusBlockId.current = prevBlock.id;
          queryClient.invalidateQueries({ queryKey: blocksQueryKey });
        }
      }
    }

    if (e.key === "ArrowDown" && index < filteredBlocks.length - 1) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const len = target.textContent?.length || 0;
        if (range.startOffset === len && range.collapsed) {
          e.preventDefault();
          const nextBlock = filteredBlocks[index + 1];
          if (nextBlock) focusBlockId.current = nextBlock.id;
          queryClient.invalidateQueries({ queryKey: blocksQueryKey });
        }
      }
    }
  }, [blocks, filteredBlocks, createBlockMutation, deleteBlockMutation, reorderBlocksMutation, blocksQueryKey]);

  const handleSlashCommand = useCallback((blockId: string, type: BlockType) => {
    const target = blockRefs.current.get(blockId);
    if (target) {
      target.innerHTML = "";
    }
    updateBlockMutation.mutate({ blockId, type, content: { text: "" } });
    setSlashMenuBlockId(null);
    setSlashMenuPosition(null);
    focusBlockId.current = blockId;
  }, [updateBlockMutation]);

  const handleAddBlock = useCallback(() => {
    const maxSort = blocks.length > 0 ? Math.max(...blocks.map(b => b.sortOrder)) : -1;
    createBlockMutation.mutate({ type: "PARAGRAPH", sortOrder: maxSort + 1 });
  }, [blocks, createBlockMutation]);

  const handleToggleCheck = useCallback((block: NoteBlock) => {
    updateBlockMutation.mutate({ blockId: block.id, checked: !block.checked });
  }, [updateBlockMutation]);

  const handleMoveBlock = useCallback((block: NoteBlock, direction: "up" | "down") => {
    const idx = blocks.findIndex(b => b.id === block.id);
    if (direction === "up" && idx > 0) {
      const other = blocks[idx - 1];
      reorderBlocksMutation.mutate([
        { id: block.id, sortOrder: other.sortOrder },
        { id: other.id, sortOrder: block.sortOrder },
      ]);
    }
    if (direction === "down" && idx < blocks.length - 1) {
      const other = blocks[idx + 1];
      reorderBlocksMutation.mutate([
        { id: block.id, sortOrder: other.sortOrder },
        { id: other.id, sortOrder: block.sortOrder },
      ]);
    }
  }, [blocks, reorderBlocksMutation]);

  useEffect(() => {
    const handleClickOutside = () => {
      if (slashMenuBlockId) {
        setSlashMenuBlockId(null);
        setSlashMenuPosition(null);
      }
    };
    if (slashMenuBlockId) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [slashMenuBlockId]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const slashOptions = Object.entries(BLOCK_TYPE_CONFIG).filter(([_, cfg]) =>
    !slashFilter || cfg.label.toLowerCase().includes(slashFilter.toLowerCase()) || cfg.shortcut.includes(slashFilter.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b flex items-center justify-between">
        <h2 className="text-xl font-semibold" data-testid="text-page-title">{pageTitle}</h2>
        <div className="flex items-center gap-2">
          {hasTodos && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-todo-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  {todoFilter === "all" ? "All items" : todoFilter === "open" ? "Open" : "Completed"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onTodoFilterChange("all")} data-testid="filter-all">All items</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTodoFilterChange("open")} data-testid="filter-open">Open only</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTodoFilterChange("completed")} data-testid="filter-completed">Completed only</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" variant="ghost" onClick={handleAddBlock} data-testid="button-add-block">
            <Plus className="h-4 w-4 mr-1" /> Add Block
          </Button>
        </div>
      </div>

      <FormatToolbar onFormat={handleFormat} />

      <ScrollArea className="flex-1">
        <div ref={editorRef} className="relative max-w-3xl mx-auto px-6 py-6 space-y-1">
          {filteredBlocks.map((block, index) => (
            <BlockRow
              key={block.id}
              block={block}
              index={index}
              totalBlocks={filteredBlocks.length}
              blockRefs={blockRefs}
              onInput={handleBlockInput}
              onKeyDown={handleBlockKeyDown}
              onToggleCheck={handleToggleCheck}
              onDelete={(id) => deleteBlockMutation.mutate(id)}
              onChangeType={(id, type) => updateBlockMutation.mutate({ blockId: id, type })}
              onMove={handleMoveBlock}
            />
          ))}

          {slashMenuBlockId && slashMenuPosition && (
            <div
              className="absolute z-50 bg-popover border rounded-lg shadow-lg p-1 min-w-[200px]"
              style={{ top: slashMenuPosition.top, left: slashMenuPosition.left }}
              onClick={(e) => e.stopPropagation()}
              data-testid="slash-command-menu"
            >
              <div className="px-2 py-1.5">
                <Input
                  placeholder="Filter..."
                  value={slashFilter}
                  onChange={(e) => setSlashFilter(e.target.value)}
                  className="h-7 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSlashMenuBlockId(null);
                      setSlashMenuPosition(null);
                    }
                    if (e.key === "Enter" && slashOptions.length > 0) {
                      handleSlashCommand(slashMenuBlockId, slashOptions[0][0] as BlockType);
                    }
                  }}
                  data-testid="input-slash-filter"
                />
              </div>
              {slashOptions.map(([type, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={type}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent cursor-pointer text-left"
                    onClick={() => handleSlashCommand(slashMenuBlockId, type as BlockType)}
                    data-testid={`slash-option-${type}`}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          )}

          {filteredBlocks.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {todoFilter !== "all"
                ? "No matching to-do items"
                : "Start typing or press + to add a block"}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface BlockRowProps {
  block: NoteBlock;
  index: number;
  totalBlocks: number;
  blockRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  onInput: (blockId: string, html: string) => void;
  onKeyDown: (e: React.KeyboardEvent, block: NoteBlock, index: number) => void;
  onToggleCheck: (block: NoteBlock) => void;
  onDelete: (blockId: string) => void;
  onChangeType: (blockId: string, type: BlockType) => void;
  onMove: (block: NoteBlock, direction: "up" | "down") => void;
}

function BlockRow({ block, index, totalBlocks, blockRefs, onInput, onKeyDown, onToggleCheck, onDelete, onChangeType, onMove }: BlockRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      blockRefs.current.set(block.id, contentRef.current);
    }
    return () => {
      blockRefs.current.delete(block.id);
    };
  }, [block.id, blockRefs]);

  useEffect(() => {
    if (contentRef.current && block.type !== "DIVIDER") {
      const blockHtml = block.content?.text || "";
      if (document.activeElement !== contentRef.current) {
        contentRef.current.innerHTML = blockHtml;
      }
    }
  }, [block.content?.text, block.type]);

  if (block.type === "DIVIDER") {
    return (
      <div className="group flex items-center gap-2 py-2" data-testid={`block-${block.id}`}>
        <div className="w-6 flex-shrink-0" />
        <Separator className="flex-1" />
        <BlockActions block={block} index={index} totalBlocks={totalBlocks} onDelete={onDelete} onChangeType={onChangeType} onMove={onMove} />
      </div>
    );
  }

  const blockClassName = cn(
    "outline-none w-full min-h-[1.5em] break-words",
    block.type === "HEADING1" && "text-2xl font-bold",
    block.type === "HEADING2" && "text-xl font-semibold",
    block.type === "HEADING3" && "text-lg font-medium",
    block.type === "PARAGRAPH" && "text-sm",
    block.type === "BULLETED_LIST" && "text-sm",
    block.type === "NUMBERED_LIST" && "text-sm",
    block.type === "TODO" && cn("text-sm", block.checked && "line-through text-muted-foreground"),
  );

  return (
    <div className="group flex items-start gap-2 py-0.5 hover:bg-muted/30 rounded px-1 -mx-1" data-testid={`block-${block.id}`}>
      <div className="w-6 flex-shrink-0 pt-0.5 flex items-center justify-center">
        {block.type === "TODO" && (
          <button
            onClick={() => onToggleCheck(block)}
            className={cn(
              "h-4 w-4 rounded border flex items-center justify-center transition-colors",
              block.checked
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground/40 hover:border-primary"
            )}
            data-testid={`checkbox-${block.id}`}
          >
            {block.checked && <Check className="h-3 w-3" />}
          </button>
        )}
        {block.type === "BULLETED_LIST" && (
          <span className="text-muted-foreground text-lg leading-none">•</span>
        )}
        {block.type === "NUMBERED_LIST" && (
          <span className="text-muted-foreground text-xs font-medium">{index + 1}.</span>
        )}
      </div>
      <div
        ref={contentRef}
        contentEditable
        suppressContentEditableWarning
        className={blockClassName}
        onInput={(e) => onInput(block.id, (e.target as HTMLElement).innerHTML)}
        onKeyDown={(e) => onKeyDown(e, block, index)}
        data-placeholder={
          block.type === "HEADING1" ? "Heading 1" :
          block.type === "HEADING2" ? "Heading 2" :
          block.type === "HEADING3" ? "Heading 3" :
          block.type === "TODO" ? "To-do" :
          block.type === "BULLETED_LIST" ? "List item" :
          block.type === "NUMBERED_LIST" ? "List item" :
          "Type '/' for commands..."
        }
        data-testid={`block-content-${block.id}`}
      />
      <BlockActions block={block} index={index} totalBlocks={totalBlocks} onDelete={onDelete} onChangeType={onChangeType} onMove={onMove} />
    </div>
  );
}

function BlockActions({ block, index, totalBlocks, onDelete, onChangeType, onMove }: {
  block: NoteBlock;
  index: number;
  totalBlocks: number;
  onDelete: (id: string) => void;
  onChangeType: (id: string, type: BlockType) => void;
  onMove: (block: NoteBlock, direction: "up" | "down") => void;
}) {
  return (
    <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="h-6 w-6" data-testid={`block-menu-${block.id}`}>
            <MoreVertical className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {Object.entries(BLOCK_TYPE_CONFIG).map(([type, cfg]) => {
            const Icon = cfg.icon;
            return (
              <DropdownMenuItem
                key={type}
                onClick={() => onChangeType(block.id, type as BlockType)}
                className={cn(block.type === type && "bg-accent")}
              >
                <Icon className="h-4 w-4 mr-2" />
                {cfg.label}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          {index > 0 && (
            <DropdownMenuItem onClick={() => onMove(block, "up")}>
              <ChevronUp className="h-4 w-4 mr-2" />
              Move Up
            </DropdownMenuItem>
          )}
          {index < totalBlocks - 1 && (
            <DropdownMenuItem onClick={() => onMove(block, "down")}>
              <ChevronDown className="h-4 w-4 mr-2" />
              Move Down
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(block.id)} data-testid={`block-delete-${block.id}`}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
