import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Search, Plus, Hash, Building2, FolderOpen, HardHat, MessageSquare, Loader2, FileQuestion, ArrowRightLeft, CheckSquare, Video, FileText } from "lucide-react";
import { SidebarSection } from "./SidebarSection";
import { getInitials, type User, type Channel, type Conversation, type ChannelRow } from "./types";
import { cn } from "@/lib/utils";

function EntityBadge({ conversation }: { conversation: Conversation }) {
  const [, setLocation] = useLocation();

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversation.taskId) {
      setLocation(`/tasks?taskId=${conversation.taskId}`);
    } else if (conversation.rfiId || conversation.changeOrderId) {
      try {
        const entityType = conversation.rfiId ? "RFI" : "CHANGE_ORDER";
        const entityId = conversation.rfiId || conversation.changeOrderId;
        const res = await fetch(`/api/entity-project/${entityType}/${entityId}`, { credentials: "include" });
        if (res.ok) {
          const { projectCode } = await res.json();
          if (projectCode) {
            const tab = conversation.rfiId ? "rfis" : "change-orders";
            const param = conversation.rfiId ? `rfiId=${entityId}` : `coId=${entityId}`;
            setLocation(`/projects/${projectCode}?tab=${tab}&${param}`);
            return;
          }
        }
      } catch (err) {
        console.error("Entity project lookup failed:", err);
      }
    }
  };

  if (conversation.rfiId) {
    return (
      <button onClick={handleClick} title="View RFI" data-testid={`sidebar-entity-badge-rfi-${conversation.rfiId}`}>
        <FileQuestion className="w-3 h-3 text-blue-500 shrink-0 hover:opacity-70 transition-opacity" />
      </button>
    );
  }
  if (conversation.changeOrderId) {
    return (
      <button onClick={handleClick} title="View Change Order" data-testid={`sidebar-entity-badge-co-${conversation.changeOrderId}`}>
        <ArrowRightLeft className="w-3 h-3 text-amber-500 shrink-0 hover:opacity-70 transition-opacity" />
      </button>
    );
  }
  if (conversation.taskId) {
    return (
      <button onClick={handleClick} title="View Task" data-testid={`sidebar-entity-badge-task-${conversation.taskId}`}>
        <CheckSquare className="w-3 h-3 text-green-500 shrink-0 hover:opacity-70 transition-opacity" />
      </button>
    );
  }
  return null;
}

interface SidebarProps {
  currentUserId?: string;
  conversations: Conversation[];
  allChannels: Channel[];
  companyConversation?: Conversation;
  selectedConversationId: string | null;
  onSelectConversation: (id: string) => void;
  availableUsers: User[];
  activeCallConversationIds?: Set<string>;
  onJoinCall?: (conversationId: string) => void;
  compact?: boolean;
  showCallNotes?: boolean;
  onToggleCallNotes?: () => void;
}

export function Sidebar({
  currentUserId,
  conversations,
  allChannels,
  companyConversation,
  selectedConversationId,
  onSelectConversation,
  availableUsers,
  activeCallConversationIds = new Set(),
  onJoinCall,
  compact = false,
  showCallNotes = false,
  onToggleCallNotes,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDescription, setNewChannelDescription] = useState("");
  const [newChannelTopic, setNewChannelTopic] = useState("");
  const [newChannelSlug, setNewChannelSlug] = useState("");
  const [newDmOpen, setNewDmOpen] = useState(false);

  const createChannelMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; topic?: string; slug?: string }) => {
      const response = await apiRequest("POST", "/api/channels", data);
      return response.json();
    },
    onSuccess: (channel) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      onSelectConversation(channel.id);
      setNewChannelOpen(false);
      setNewChannelName("");
      setNewChannelDescription("");
      setNewChannelTopic("");
      setNewChannelSlug("");
    },
  });

  const createConversationMutation = useMutation({
    mutationFn: async ({ type, participantIds }: { type: string; participantIds: string[] }) => {
      const response = await apiRequest("POST", "/api/conversations", { type, participantIds });
      return response.json();
    },
    onSuccess: (newConversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      onSelectConversation(newConversation.id);
      setNewDmOpen(false);
    },
  });

  const joinChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const response = await apiRequest("POST", `/api/channels/${channelId}/join`);
      return response.json();
    },
    onSuccess: (_data, channelId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      onSelectConversation(channelId);
    },
  });

  const filterName = (name: string) => name.toLowerCase().includes(searchQuery.toLowerCase());

  const getConversationName = (c: Conversation): string => {
    if (c.isCompanyChannel) return "Company Chat";
    if (c.name) return c.name;
    if (c.type === "DIRECT") {
      const other = c.participants.find(p => p.userId !== currentUserId);
      if (other) return `${other.user.firstName} ${other.user.lastName}`;
    }
    return "Conversation";
  };

  const namedChannels = conversations
    .filter(c => c.channelSlug && !c.projectId && !c.crewId && !c.isCompanyChannel)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const joinedProjectIds = new Set(conversations.filter(c => !!c.projectId).map(c => c.id));
  const joinedCrewIds = new Set(conversations.filter(c => !!c.crewId).map(c => c.id));

  const projectChannels: ChannelRow[] = [
    ...conversations.filter(c => !!c.projectId),
    ...allChannels.filter(ch => !!ch.projectId && !joinedProjectIds.has(ch.id)).map(ch => ({ ...ch, _unjoined: true as const })),
  ].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const crewChannels: ChannelRow[] = [
    ...conversations.filter(c => !!c.crewId),
    ...allChannels.filter(ch => !!ch.crewId && !joinedCrewIds.has(ch.id)).map(ch => ({ ...ch, _unjoined: true as const })),
  ].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  const directMessages = conversations.filter(c => c.type === "DIRECT");
  const joinableChannels = allChannels.filter(ch => !ch.projectId && !ch.crewId && !conversations.find(c => c.id === ch.id));

  return (
    <div className={cn("border-r flex flex-col bg-muted/20", compact ? "w-56" : "w-72")}>
      <div className="p-2 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="pl-8 h-8 text-sm"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            data-testid="input-search-conversations"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* Company channel */}
          {companyConversation && (
            <button
              onClick={() => onSelectConversation(companyConversation.id)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                selectedConversationId === companyConversation.id && "bg-accent font-medium"
              )}
              data-testid="button-company-channel"
            >
              <Building2 className="w-4 h-4 text-primary shrink-0" />
              <span className="flex-1 truncate">Company Chat</span>
              {activeCallConversationIds.has(companyConversation.id) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onJoinCall ? onJoinCall(companyConversation.id) : onSelectConversation(companyConversation.id); }}
                      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 hover:bg-green-500/20 transition-colors"
                      data-testid={`call-indicator-${companyConversation.id}`}
                    >
                      <Video className="w-3.5 h-3.5 text-green-500 animate-pulse" />
                      <span className="text-[10px] font-medium text-green-500">Join</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Ongoing call — click to join</TooltipContent>
                </Tooltip>
              )}
              {companyConversation.unreadCount > 0 && (
                <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{companyConversation.unreadCount}</Badge>
              )}
            </button>
          )}

          <Separator className="my-1" />

          {/* Named Channels */}
          <SidebarSection
            label="Channels"
            action={
              <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
                <DialogTrigger asChild>
                  <button className="p-0.5 rounded hover:bg-accent" data-testid="button-new-channel">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </DialogTrigger>
                <DialogContent className="z-[10000]" overlayClassName="z-[10000]">
                  <DialogHeader>
                    <DialogTitle>Create a Channel</DialogTitle>
                    <DialogDescription>Channels are where your team communicates around topics.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 mt-2">
                    <div>
                      <Label>Channel name</Label>
                      <div className="flex items-center mt-1">
                        <span className="text-muted-foreground px-2 border rounded-l-md h-9 flex items-center bg-muted text-sm">#</span>
                        <Input
                          placeholder="e.g. general, design, ops"
                          value={newChannelName}
                          onChange={e => setNewChannelName(e.target.value)}
                          className="rounded-l-none"
                          data-testid="input-channel-name"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Slug <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <div className="flex items-center mt-1">
                        <span className="text-muted-foreground px-2 border rounded-l-md h-9 flex items-center bg-muted text-sm">#</span>
                        <Input
                          placeholder={newChannelName ? newChannelName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : "channel-slug"}
                          value={newChannelSlug}
                          onChange={e => setNewChannelSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                          className="rounded-l-none"
                          data-testid="input-channel-slug"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input
                        placeholder="What's this channel about?"
                        value={newChannelDescription}
                        onChange={e => setNewChannelDescription(e.target.value)}
                        className="mt-1"
                        data-testid="input-channel-description"
                      />
                    </div>
                    <div>
                      <Label>Topic <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input
                        placeholder="Channel topic or purpose"
                        value={newChannelTopic}
                        onChange={e => setNewChannelTopic(e.target.value)}
                        className="mt-1"
                        data-testid="input-channel-topic"
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => createChannelMutation.mutate({
                        name: newChannelName,
                        description: newChannelDescription || undefined,
                        topic: newChannelTopic || undefined,
                        slug: newChannelSlug || undefined,
                      })}
                      disabled={!newChannelName.trim() || createChannelMutation.isPending}
                      data-testid="button-create-channel"
                    >
                      {createChannelMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Create Channel
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            }
          >
            {namedChannels.filter(c => filterName(getConversationName(c))).map(c => (
              <button
                key={c.id}
                onClick={() => onSelectConversation(c.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                  selectedConversationId === c.id && "bg-accent font-medium"
                )}
                data-testid={`button-channel-${c.id}`}
              >
                <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{c.name}</span>
                <EntityBadge conversation={c} />
                {activeCallConversationIds.has(c.id) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onJoinCall ? onJoinCall(c.id) : onSelectConversation(c.id); }}
                        className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 hover:bg-green-500/20 transition-colors"
                        data-testid={`call-indicator-${c.id}`}
                      >
                        <Video className="w-3.5 h-3.5 text-green-500 animate-pulse" />
                        <span className="text-[10px] font-medium text-green-500">Join</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Ongoing call — click to join</TooltipContent>
                  </Tooltip>
                )}
                {c.unreadCount > 0 && (
                  <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{c.unreadCount}</Badge>
                )}
              </button>
            ))}
            {joinableChannels.filter(ch => !ch.projectId && !ch.crewId).map(ch => (
              <button
                key={ch.id}
                onClick={() => joinChannelMutation.mutate(ch.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left text-muted-foreground hover:bg-accent transition-colors"
                data-testid={`button-join-channel-${ch.id}`}
              >
                <Hash className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{ch.name}</span>
                <span className="text-xs opacity-60">Join</span>
              </button>
            ))}
          </SidebarSection>

          {/* Project Channels */}
          {projectChannels.length > 0 && (
            <SidebarSection label="Project Channels">
              {projectChannels.filter(c => filterName(c.channelSlug ?? c.name ?? "")).map(c => {
                const unjoined = c._unjoined === true;
                return (
                  <button
                    key={c.id}
                    onClick={() => unjoined ? joinChannelMutation.mutate(c.id) : onSelectConversation(c.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                      !unjoined && selectedConversationId === c.id && "bg-accent font-medium",
                      unjoined && "opacity-60"
                    )}
                    data-testid={`button-project-channel-${c.id}`}
                  >
                    <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{c.channelSlug ?? c.name}</span>
                    {!unjoined && <EntityBadge conversation={c as Conversation} />}
                    {unjoined && <span className="text-[10px] text-muted-foreground">Join</span>}
                    {!unjoined && activeCallConversationIds.has(c.id) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onJoinCall ? onJoinCall(c.id) : onSelectConversation(c.id); }}
                            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 hover:bg-green-500/20 transition-colors"
                            data-testid={`call-indicator-${c.id}`}
                          >
                            <Video className="w-3.5 h-3.5 text-green-500 animate-pulse" />
                            <span className="text-[10px] font-medium text-green-500">Join</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Ongoing call — click to join</TooltipContent>
                      </Tooltip>
                    )}
                    {!unjoined && (c as Conversation).unreadCount > 0 && (
                      <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{(c as Conversation).unreadCount}</Badge>
                    )}
                  </button>
                );
              })}
            </SidebarSection>
          )}

          {/* Crew Channels */}
          {crewChannels.length > 0 && (
            <SidebarSection label="Crew Channels">
              {crewChannels.filter(c => filterName(c.channelSlug ?? c.name ?? "")).map(c => {
                const unjoined = c._unjoined === true;
                return (
                  <button
                    key={c.id}
                    onClick={() => unjoined ? joinChannelMutation.mutate(c.id) : onSelectConversation(c.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                      !unjoined && selectedConversationId === c.id && "bg-accent font-medium",
                      unjoined && "opacity-60"
                    )}
                    data-testid={`button-crew-channel-${c.id}`}
                  >
                    <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{c.channelSlug ?? c.name}</span>
                    {!unjoined && <EntityBadge conversation={c as Conversation} />}
                    {unjoined && <span className="text-[10px] text-muted-foreground">Join</span>}
                    {!unjoined && activeCallConversationIds.has(c.id) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onJoinCall ? onJoinCall(c.id) : onSelectConversation(c.id); }}
                            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 hover:bg-green-500/20 transition-colors"
                            data-testid={`call-indicator-${c.id}`}
                          >
                            <Video className="w-3.5 h-3.5 text-green-500 animate-pulse" />
                            <span className="text-[10px] font-medium text-green-500">Join</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Ongoing call — click to join</TooltipContent>
                      </Tooltip>
                    )}
                    {!unjoined && (c as Conversation).unreadCount > 0 && (
                      <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{(c as Conversation).unreadCount}</Badge>
                    )}
                  </button>
                );
              })}
            </SidebarSection>
          )}

          {onToggleCallNotes && (
            <>
              <Separator className="my-1" />
              <button
                onClick={onToggleCallNotes}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                  showCallNotes && "bg-accent font-medium"
                )}
                data-testid="button-call-notes-view"
              >
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1 truncate">Call Notes</span>
              </button>
            </>
          )}

          <Separator className="my-1" />

          {/* Direct Messages */}
          <SidebarSection
            label="Direct Messages"
            action={
              <Dialog open={newDmOpen} onOpenChange={setNewDmOpen}>
                <DialogTrigger asChild>
                  <button className="p-0.5 rounded hover:bg-accent" data-testid="button-new-dm">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </DialogTrigger>
                <DialogContent className="z-[10000]" overlayClassName="z-[10000]">
                  <DialogHeader>
                    <DialogTitle>Start a Direct Message</DialogTitle>
                    <DialogDescription>Select a team member to start a private conversation</DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="h-[300px] mt-4">
                    {availableUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No team members available</p>
                    ) : (
                      <div className="space-y-1">
                        {availableUsers.map(u => (
                          <button
                            key={u.id}
                            onClick={() => createConversationMutation.mutate({ type: "DIRECT", participantIds: [u.id] })}
                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors text-left"
                            data-testid={`button-dm-user-${u.id}`}
                          >
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs">{getInitials(u.firstName, u.lastName)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-sm font-medium">{u.firstName} {u.lastName}</p>
                              <p className="text-xs text-muted-foreground">{u.role}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            }
          >
            {directMessages.filter(c => {
              const other = c.participants.find(p => p.userId !== currentUserId);
              const name = other ? `${other.user.firstName} ${other.user.lastName}` : "Unknown";
              return name.toLowerCase().includes(searchQuery.toLowerCase());
            }).map(c => {
              const other = c.participants.find(p => p.userId !== currentUserId);
              return (
                <button
                  key={c.id}
                  onClick={() => onSelectConversation(c.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent transition-colors",
                    selectedConversationId === c.id && "bg-accent font-medium"
                  )}
                  data-testid={`button-dm-${c.id}`}
                >
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarFallback className="text-[9px]">
                      {other ? getInitials(other.user.firstName, other.user.lastName) : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate">
                    {other ? `${other.user.firstName} ${other.user.lastName}` : "Unknown"}
                  </span>
                  {activeCallConversationIds.has(c.id) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onJoinCall ? onJoinCall(c.id) : onSelectConversation(c.id); }}
                          className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 hover:bg-green-500/20 transition-colors"
                          data-testid={`call-indicator-${c.id}`}
                        >
                          <Video className="w-3.5 h-3.5 text-green-500 animate-pulse" />
                          <span className="text-[10px] font-medium text-green-500">Join</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Ongoing call — click to join</TooltipContent>
                    </Tooltip>
                  )}
                  {c.unreadCount > 0 && (
                    <Badge className="h-4 min-w-[16px] px-1 text-[10px]">{c.unreadCount}</Badge>
                  )}
                </button>
              );
            })}
          </SidebarSection>
        </div>
      </ScrollArea>
    </div>
  );
}
