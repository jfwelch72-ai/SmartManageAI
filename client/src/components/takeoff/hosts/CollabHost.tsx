import { memo } from "react";
import { Lock, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCollabContext } from "./TakeoffWorkspaceContext";

/** Collaboration DOM widgets (presence avatars, "X is working here"
 *  pill, offline badge). Lives inside the sheet selector toolbar's
 *  flex layout via direct render — the orchestrator drops
 *  `<CollabHost />` where the inline blocks used to be, and
 *  `CollabContextSlice` provides every value through context.
 *
 *  Cursor rendering belongs on the Konva stage and stays in
 *  `CanvasHost`; only the DOM-side collaboration UI lives here. */
function CollabHostInner() {
  const ctx = useCollabContext();
  return (
    <>
      {ctx.collaborators.length > 0 && (
        <div className="flex items-center gap-1" data-testid="collaborators-indicator">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center -space-x-1.5">
                {ctx.collaborators.slice(0, 4).map((c) => (
                  <Tooltip key={c.userId}>
                    <TooltipTrigger asChild>
                      <div
                        className="w-7 h-7 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold text-white cursor-default"
                        style={{ backgroundColor: c.userColor }}
                        data-testid={`avatar-collaborator-${c.userId}`}
                      >
                        {c.userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{c.userName}</p>
                      {c.currentSheetId && (
                        <p className="text-xs text-muted-foreground">
                          Viewing: {ctx.sheetNameById(c.currentSheetId) || "Unknown sheet"}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                ))}
                {ctx.collaborators.length > 4 && (
                  <div className="w-7 h-7 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                    +{ctx.collaborators.length - 4}
                  </div>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {ctx.collaborators.length} collaborator
                {ctx.collaborators.length > 1 ? "s" : ""} online
              </p>
            </TooltipContent>
          </Tooltip>
          <Users className="w-4 h-4 text-muted-foreground ml-1" />
        </div>
      )}
      {ctx.currentSheetLock && (
        <div
          className="flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 rounded text-xs text-amber-700 dark:text-amber-300"
          data-testid="sheet-lock-warning"
        >
          <Lock className="w-3 h-3" />
          <span>{ctx.currentSheetLock.userName} is working here</span>
        </div>
      )}
      {!ctx.connected && ctx.hasRoom && (
        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300" data-testid="badge-offline">
          Offline
        </Badge>
      )}
      {ctx.sheetLockToggle.visible && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={ctx.sheetLockToggle.ownedByMe ? "secondary" : "ghost"}
              size="sm"
              className="gap-1 h-7 px-2"
              onClick={ctx.sheetLockToggle.onToggle}
              data-testid="button-sheet-lock-toggle"
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-xs">
                {ctx.sheetLockToggle.ownedByMe ? "Unlock" : "Lock"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {ctx.sheetLockToggle.ownedByMe
                ? "Release \"I'm working here\" lock"
                : "Set \"I'm working here\" soft lock"}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

export const CollabHost = memo(CollabHostInner);
CollabHost.displayName = "CollabHost";
