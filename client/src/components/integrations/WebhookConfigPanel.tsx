import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Loader2, Plus, Trash2, Send, Globe, ToggleLeft, ToggleRight, Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Connection, ZapierWebhook } from "./types";

const EVENT_TYPE_LABELS: Record<string, string> = {
  "project.created": "Project Created",
  "project.updated": "Project Updated",
  "project.status_changed": "Project Status Changed",
  "bid.created": "Bid Created",
  "bid.status_changed": "Bid Status Changed",
  "change_order.created": "Change Order Created",
  "change_order.approved": "Change Order Approved",
  "change_order.rejected": "Change Order Rejected",
  "invoice.created": "Invoice Created",
  "invoice.paid": "Invoice Paid",
  "time_entry.submitted": "Time Entry Submitted",
  "time_entry.approved": "Time Entry Approved",
  "task.created": "Task Created",
  "task.completed": "Task Completed",
  "document.uploaded": "Document Uploaded",
  "safety_incident.reported": "Safety Incident Reported",
};

export function WebhookConfigPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const { data: webhooks, isLoading } = useQuery<ZapierWebhook[]>({
    queryKey: ["/api/integrations/zapier/webhooks"],
  });

  const { data: eventTypes } = useQuery<string[]>({
    queryKey: ["/api/integrations/zapier/event-types"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/zapier/webhooks", {
        connectionId: connection.id,
        name: newName,
        webhookUrl: newUrl,
        eventTypes: selectedEvents,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Webhook Created", description: "Zapier webhook configured successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/zapier/webhooks"] });
      setShowAddForm(false);
      setNewName("");
      setNewUrl("");
      setSelectedEvents([]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/integrations/zapier/webhooks/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/zapier/webhooks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/zapier/webhooks/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Webhook removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/zapier/webhooks"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/integrations/zapier/webhooks/${id}/test`);
      return res.json();
    },
    onSuccess: (data: { delivered: boolean; status: number }) => {
      toast({
        title: data.delivered ? "Test Successful" : "Test Failed",
        description: data.delivered
          ? `Webhook responded with status ${data.status}`
          : `Webhook returned status ${data.status}`,
        variant: data.delivered ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    },
  });

  const toggleEvent = (eventType: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2" data-testid="text-zapier-heading">
            <Zap className="h-5 w-5 text-orange-500" />
            Zapier Webhooks
          </h2>
          <p className="text-sm text-muted-foreground">
            Send events from SmartManageAI to Zapier to trigger automations
          </p>
        </div>
        <Button
          onClick={() => setShowAddForm(!showAddForm)}
          size="sm"
          data-testid="button-add-webhook"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Webhook
        </Button>
      </div>

      {showAddForm && (
        <Card data-testid="card-add-webhook-form">
          <CardContent className="pt-6 space-y-4">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <div>
                <Label htmlFor="webhook-name">Webhook Name</Label>
                <Input
                  id="webhook-name"
                  placeholder="e.g., New Project Notifications"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  data-testid="input-webhook-name"
                />
              </div>
              <div>
                <Label htmlFor="webhook-url">Zapier Webhook URL</Label>
                <Input
                  id="webhook-url"
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  data-testid="input-webhook-url"
                />
              </div>
            </div>
            <div>
              <Label>Events to Send</Label>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-2">
                {(eventTypes || Object.keys(EVENT_TYPE_LABELS)).map((evt) => (
                  <label
                    key={evt}
                    className="flex items-center gap-2 text-sm p-2 rounded border cursor-pointer hover:bg-muted/50"
                    data-testid={`checkbox-event-${evt}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(evt)}
                      onChange={() => toggleEvent(evt)}
                      className="rounded"
                    />
                    {EVENT_TYPE_LABELS[evt] || evt}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddForm(false)} data-testid="button-cancel-webhook">
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!newName || !newUrl || selectedEvents.length === 0 || createMutation.isPending}
                data-testid="button-save-webhook"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save Webhook
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (webhooks || []).length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Zap className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-zapier-webhooks">
              No webhooks configured yet. Click "Add Webhook" to connect SmartManageAI events to Zapier.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(webhooks || []).map((webhook) => (
            <Card key={webhook.id} data-testid={`card-webhook-${webhook.id}`}>
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30 mt-0.5">
                      <Zap className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium" data-testid={`text-webhook-name-${webhook.id}`}>{webhook.name}</p>
                        <Badge variant={webhook.isActive ? "default" : "secondary"} className="text-xs">
                          {webhook.isActive ? "Active" : "Paused"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-xs sm:max-w-md" title={webhook.webhookUrl}>
                        <Globe className="h-3 w-3 inline mr-1" />
                        {webhook.webhookUrl}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {webhook.eventTypes.slice(0, 3).map((evt) => (
                          <Badge key={evt} variant="outline" className="text-xs">
                            {EVENT_TYPE_LABELS[evt] || evt}
                          </Badge>
                        ))}
                        {webhook.eventTypes.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{webhook.eventTypes.length - 3} more
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Triggers: {webhook.triggerCount}</span>
                        {webhook.lastTriggeredAt && (
                          <span>Last: {new Date(webhook.lastTriggeredAt).toLocaleString()}</span>
                        )}
                        {webhook.lastStatus && (
                          <Badge variant={webhook.lastStatus === "success" ? "default" : "destructive"} className="text-xs h-4">
                            {webhook.lastStatus}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testMutation.mutate(webhook.id)}
                      disabled={testMutation.isPending}
                      title="Send test event"
                      data-testid={`button-test-webhook-${webhook.id}`}
                    >
                      {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: webhook.id, isActive: !webhook.isActive })}
                      title={webhook.isActive ? "Pause webhook" : "Activate webhook"}
                      data-testid={`button-toggle-webhook-${webhook.id}`}
                    >
                      {webhook.isActive ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(webhook.id)}
                      disabled={deleteMutation.isPending}
                      title="Delete webhook"
                      data-testid={`button-delete-webhook-${webhook.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
