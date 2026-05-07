import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, RotateCw } from "lucide-react";

interface QueueDepth {
  name: string;
  size: number;
}

interface DeadLetterItem {
  id: string;
  name: string;
  data: unknown;
  output: unknown;
  retryCount: number;
  createdOn: string | null;
  completedOn: string | null;
}

export default function JobQueueAdminPage() {
  const { toast } = useToast();

  const depthsQuery = useQuery<{ depths: QueueDepth[] }>({
    queryKey: ["/api/admin/job-queue/depths"],
    refetchInterval: 5000,
  });

  const dlqQuery = useQuery<{ items: DeadLetterItem[] }>({
    queryKey: ["/api/admin/job-queue/dead-letter"],
    refetchInterval: 10000,
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/admin/job-queue/dead-letter/${id}/retry`);
    },
    onSuccess: () => {
      toast({ title: "Job re-enqueued" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/job-queue/dead-letter"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/job-queue/depths"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Background Job Queue
          </h1>
          <p className="text-muted-foreground">
            pg-boss queue depth, dead-letter inspection, and retry.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/job-queue/depths"] });
            queryClient.invalidateQueries({ queryKey: ["/api/admin/job-queue/dead-letter"] });
          }}
          data-testid="button-refresh"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue depth</CardTitle>
        </CardHeader>
        <CardContent>
          {depthsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job name</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(depthsQuery.data?.depths ?? []).map((d) => (
                  <TableRow key={d.name} data-testid={`row-depth-${d.name}`}>
                    <TableCell className="font-mono">{d.name}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={d.size > 0 ? "default" : "secondary"} data-testid={`badge-size-${d.name}`}>
                        {d.size}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dead-letter queue</CardTitle>
        </CardHeader>
        <CardContent>
          {dlqQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (dlqQuery.data?.items ?? []).length === 0 ? (
            <p className="text-muted-foreground" data-testid="text-dlq-empty">
              No failed jobs.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Failed at</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dlqQuery.data?.items ?? []).map((item) => {
                  const out = (item.output ?? {}) as { message?: string };
                  const msg = out?.message || JSON.stringify(item.output ?? {}).slice(0, 120);
                  return (
                    <TableRow key={item.id} data-testid={`row-dlq-${item.id}`}>
                      <TableCell className="font-mono text-xs">{item.id.slice(0, 8)}…</TableCell>
                      <TableCell className="font-mono">{item.name}</TableCell>
                      <TableCell>{item.retryCount}</TableCell>
                      <TableCell className="text-xs">
                        {item.completedOn ? new Date(item.completedOn).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-xs truncate" title={msg}>
                        {msg}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retryMutation.isPending}
                          onClick={() => retryMutation.mutate(item.id)}
                          data-testid={`button-retry-${item.id}`}
                        >
                          <RotateCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
