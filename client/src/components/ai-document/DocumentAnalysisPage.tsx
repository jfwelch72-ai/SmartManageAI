import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ObjectUploader } from "@/components/ObjectUploader";
import { MAX_STORAGE_FILE_SIZE } from "@/lib/uploadLimits";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, Sparkles, Clock, CheckCircle2, AlertTriangle,
  FileText, Eye, Loader2, RefreshCw, Trash2, Archive, RotateCcw
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { LucideIcon } from "lucide-react";

export interface AnalysisItem {
  id: string;
  fileName: string;
  fileUrl: string;
  analysisStatus: string;
  analysisResult: any;
  createdAt: string;
  analyzedAt: string | null;
  isArchived?: boolean;
  archivedAt?: string | null;
  [key: string]: any;
}

export interface EntityItem {
  id: string;
  code: string;
  name: string;
  [key: string]: any;
}

export interface StatsCardConfig {
  label: string;
  icon: LucideIcon;
  getValue: (analyses: AnalysisItem[]) => number | string;
  subtitle?: string;
}

export interface TabConfig<T extends AnalysisItem> {
  value: string;
  label: string | ((analyses: T[]) => string);
  icon: LucideIcon;
  showCondition?: (analyses: T[]) => boolean;
  render: (args: {
    analyses: T[];
    loading: boolean;
    openResult: (a: T) => void;
    getStatusBadge: (s: string) => ReactNode;
    reanalyzeMutation: any;
    archiveMutation?: any;
  }) => ReactNode;
}

export interface DocumentAnalysisPageConfig<T extends AnalysisItem = AnalysisItem> {
  title: string;
  titleIcon: LucideIcon;
  description: string;
  allowedRoles: string[];
  accessDeniedLabel: string;

  analysesEndpoint: string;
  entitiesEndpoint: string;
  analyzeEndpoint: string;
  reanalyzeEndpointFn: (id: string) => string;

  entityLabel: string;
  entitySelectTestId: string;
  newButtonLabel: string;
  newButtonTestId: string;

  uploadTitle: string;
  uploadDescription: string;
  uploadHelpText: string;
  renderUploadExtras?: () => ReactNode;
  buildAnalyzePayload: (entityId: string, fileUrl: string, fileName: string, extras?: any) => any;

  statsCards: StatsCardConfig[];
  tabs: TabConfig<T>[];
  defaultTab: string;

  renderResultTitle: (analysis: T) => ReactNode;
  renderResultSubtitle: (analysis: T) => string;
  renderResultSections: (analysis: T) => ReactNode;
  renderResultFooterExtras?: (analysis: T) => ReactNode;

  archiveEndpointFn?: (id: string) => string;
  restoreEndpointFn?: (id: string) => string;
  deleteEndpointFn?: (id: string) => string;
  archivedEndpoint?: string;

  tabsTestId: string;
}

export function getStatusBadge(status: string) {
  switch (status) {
    case "COMPLETED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
    case "PROCESSING":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Processing</Badge>;
    case "FAILED":
      return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Failed</Badge>;
    default:
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
  }
}

export function AnalysisResultDialog<T extends AnalysisItem>({
  analysis,
  open,
  onOpenChange,
  config,
  reanalyzeMutation,
}: {
  analysis: T | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: Pick<DocumentAnalysisPageConfig<T>, 'renderResultTitle' | 'renderResultSubtitle' | 'renderResultSections' | 'renderResultFooterExtras'>;
  reanalyzeMutation: any;
}) {
  if (!analysis) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{config.renderResultTitle(analysis)}</DialogTitle>
          <DialogDescription>{config.renderResultSubtitle(analysis)}</DialogDescription>
        </DialogHeader>

        {analysis.analysisStatus === "COMPLETED" && analysis.analysisResult ? (
          <div className="space-y-6 py-4">
            {config.renderResultSections(analysis)}
          </div>
        ) : analysis.analysisStatus === "PROCESSING" ? (
          <div className="py-8 text-center">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Analysis in progress...</p>
          </div>
        ) : analysis.analysisStatus === "FAILED" ? (
          <div className="py-8 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <p className="text-muted-foreground">Analysis failed. Please try again.</p>
            <Button
              className="mt-4"
              onClick={() => {
                reanalyzeMutation.mutate(analysis.id);
                onOpenChange(false);
              }}
              data-testid="button-retry-dialog"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Analysis
            </Button>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            No analysis results available
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-result-dialog">
            Close
          </Button>
          {config.renderResultFooterExtras?.(analysis)}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RecentAnalysisList<T extends AnalysisItem>({
  analyses,
  loading,
  onUpload,
  openResult,
  archiveMutation,
  emptyIcon: EmptyIcon,
  emptyLabel,
  firstButtonTestId,
}: {
  analyses: T[];
  loading: boolean;
  onUpload: () => void;
  openResult: (a: T) => void;
  archiveMutation?: any;
  emptyIcon: LucideIcon;
  emptyLabel: string;
  firstButtonTestId: string;
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <EmptyIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No analyses yet</h3>
          <p className="text-muted-foreground mt-1 mb-4">{emptyLabel}</p>
          <Button onClick={onUpload} data-testid={firstButtonTestId}>
            <Upload className="h-4 w-4 mr-2" />
            Analyze Your First Document
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {analyses.slice(0, 10).map(analysis => (
        <Card key={analysis.id} className="hover-elevate">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0 cursor-pointer" onClick={() => openResult(analysis)}>
                <div className="p-2 bg-primary/10 rounded-lg">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium truncate">{analysis.fileName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {analysis.code || analysis.bidCode || analysis.projectCode} - {analysis.name || analysis.bidName || analysis.projectName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                {getStatusBadge(analysis.analysisStatus)}
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(analysis.createdAt), { addSuffix: true })}
                </span>
                <Button size="sm" variant="outline" onClick={() => openResult(analysis)} data-testid={`button-view-${analysis.id}`}>
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>
                {archiveMutation && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="text-destructive" data-testid={`button-delete-${analysis.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Archive this analysis?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will move the analysis to the Archived tab. You can restore it later or permanently delete it from there.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => archiveMutation.mutate(analysis.id)}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Archive
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ArchivedAnalysisList<T extends AnalysisItem>({
  analyses,
  loading,
  restoreMutation,
  deleteMutation,
}: {
  analyses: T[];
  loading: boolean;
  restoreMutation: any;
  deleteMutation: any;
}) {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
      </div>
    );
  }

  if (analyses.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Archive className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No archived analyses</h3>
          <p className="text-sm">Deleted analyses will appear here</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {analyses.map(analysis => (
        <Card key={analysis.id} className="opacity-75">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0">
                <div className="p-2 bg-muted rounded-lg">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium truncate">{analysis.fileName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {analysis.code || analysis.bidCode || analysis.projectCode} - {analysis.name || analysis.bidName || analysis.projectName}
                  </p>
                  {analysis.archivedAt && (
                    <p className="text-xs text-muted-foreground">
                      Archived {formatDistanceToNow(new Date(analysis.archivedAt), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => restoreMutation.mutate(analysis.id)}
                  disabled={restoreMutation.isPending}
                  data-testid={`button-restore-${analysis.id}`}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Restore
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      data-testid={`button-permanent-delete-${analysis.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete Forever
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Permanently delete this analysis?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. The analysis and all associated data will be permanently removed from the database.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate(analysis.id)}
                        className="bg-destructive text-destructive-foreground"
                      >
                        Delete Permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function CompletedAnalysisTable<T extends AnalysisItem>({
  analyses,
  openResult,
  getCode,
  getName,
}: {
  analyses: T[];
  openResult: (a: T) => void;
  getCode: (a: T) => string;
  getName: (a: T) => string;
}) {
  if (analyses.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No completed analyses yet
        </CardContent>
      </Card>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Document</TableHead>
          <TableHead>Associated</TableHead>
          <TableHead>Analyzed</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {analyses.map(analysis => (
          <TableRow key={analysis.id}>
            <TableCell className="font-medium">{analysis.fileName}</TableCell>
            <TableCell>{getCode(analysis)} - {getName(analysis)}</TableCell>
            <TableCell>
              {analysis.analyzedAt
                ? format(new Date(analysis.analyzedAt), "MMM d, yyyy h:mm a")
                : "\u2014"
              }
            </TableCell>
            <TableCell className="text-right">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openResult(analysis)}
                data-testid={`button-view-result-${analysis.id}`}
              >
                <Eye className="h-4 w-4 mr-1" />
                View Results
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FailedAnalysisList<T extends AnalysisItem>({
  analyses,
  reanalyzeMutation,
}: {
  analyses: T[];
  reanalyzeMutation: any;
}) {
  return (
    <>
      {analyses.map(analysis => (
        <Card key={analysis.id} className="border-destructive/50">
          <CardContent className="py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <div>
                  <h3 className="font-medium">{analysis.fileName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {analysis.code || analysis.bidCode || analysis.projectCode} - {analysis.name || analysis.bidName || analysis.projectName}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => reanalyzeMutation.mutate(analysis.id)}
                disabled={reanalyzeMutation.isPending}
                data-testid={`button-retry-${analysis.id}`}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Retry Analysis
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

export function ResultSectionCard({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ResultListSection({
  icon,
  title,
  items,
  className,
}: {
  icon: LucideIcon;
  title: string;
  items: string[];
  className?: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <ResultSectionCard icon={icon} title={title} className={className}>
      <ul className="list-disc list-inside space-y-1 text-sm">
        {items.map((item: string, i: number) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </ResultSectionCard>
  );
}

export function ResultDateListSection({
  icon,
  title,
  items,
}: {
  icon: LucideIcon;
  title: string;
  items: Array<{ description: string; date: string }>;
}) {
  if (!items || items.length === 0) return null;
  return (
    <ResultSectionCard icon={icon} title={title}>
      <ul className="space-y-2 text-sm">
        {items.map((item, i: number) => (
          <li key={i} className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{item.description}:</span>
            <span>{item.date}</span>
          </li>
        ))}
      </ul>
    </ResultSectionCard>
  );
}

export function ResultTextSection({
  icon,
  title,
  text,
  className,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  className?: string;
}) {
  if (!text) return null;
  return (
    <ResultSectionCard icon={icon} title={title} className={className}>
      <p className="text-sm">{text}</p>
    </ResultSectionCard>
  );
}

export function useDocumentAnalysisMutations(config: {
  analysesEndpoint: string;
  analyzeEndpoint: string;
  reanalyzeEndpointFn: (id: string) => string;
  archiveEndpointFn?: (id: string) => string;
  restoreEndpointFn?: (id: string) => string;
  deleteEndpointFn?: (id: string) => string;
  archivedEndpoint?: string;
  onAnalyzeSuccess?: () => void;
}) {
  const { toast } = useToast();

  const analyzeMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", config.analyzeEndpoint, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.analysesEndpoint] });
      toast({ title: "Analysis started", description: "AI is reviewing your document. This may take a moment." });
      config.onAnalyzeSuccess?.();
    },
    onError: (error: any) => {
      toast({ title: "Analysis failed", description: error.message || "Failed to analyze document", variant: "destructive" });
    }
  });

  const reanalyzeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("POST", config.reanalyzeEndpointFn(id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.analysesEndpoint] });
      toast({ title: "Re-analysis started", description: "AI is reviewing the document again." });
    },
    onError: (error: any) => {
      toast({ title: "Re-analysis failed", description: error.message || "Failed to re-analyze document", variant: "destructive" });
    }
  });

  const archiveMutation = config.archiveEndpointFn ? useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PATCH", config.archiveEndpointFn!(id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.analysesEndpoint] });
      if (config.archivedEndpoint) queryClient.invalidateQueries({ queryKey: [config.archivedEndpoint] });
      toast({ title: "Analysis archived" });
    },
    onError: (error: any) => {
      toast({ title: "Archive failed", description: error.message || "Failed to archive analysis", variant: "destructive" });
    }
  }) : undefined;

  const restoreMutation = config.restoreEndpointFn ? useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PATCH", config.restoreEndpointFn!(id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.analysesEndpoint] });
      if (config.archivedEndpoint) queryClient.invalidateQueries({ queryKey: [config.archivedEndpoint] });
      toast({ title: "Analysis restored" });
    },
    onError: (error: any) => {
      toast({ title: "Restore failed", description: error.message || "Failed to restore analysis", variant: "destructive" });
    }
  }) : undefined;

  const deleteMutation = config.deleteEndpointFn ? useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", config.deleteEndpointFn!(id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.analysesEndpoint] });
      if (config.archivedEndpoint) queryClient.invalidateQueries({ queryKey: [config.archivedEndpoint] });
      toast({ title: "Analysis deleted", description: "The analysis has been permanently deleted." });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message || "Failed to delete analysis", variant: "destructive" });
    }
  }) : undefined;

  return { analyzeMutation, reanalyzeMutation, archiveMutation, restoreMutation, deleteMutation };
}

export function UploadDialog({
  open,
  onOpenChange,
  title,
  description,
  entityLabel,
  entities,
  selectedEntityId,
  onEntityChange,
  entitySelectTestId,
  helpText,
  analyzePending,
  onUploadComplete,
  renderExtras,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  entityLabel: string;
  entities: EntityItem[];
  selectedEntityId: string;
  onEntityChange: (id: string) => void;
  entitySelectTestId: string;
  helpText: string;
  analyzePending: boolean;
  onUploadComplete: (result: any) => void;
  renderExtras?: () => ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select {entityLabel}</label>
            <Select value={selectedEntityId} onValueChange={onEntityChange}>
              <SelectTrigger data-testid={entitySelectTestId}>
                <SelectValue placeholder={`Select a ${entityLabel.toLowerCase()}...`} />
              </SelectTrigger>
              <SelectContent>
                {entities.map(entity => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.code} - {entity.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {renderExtras?.()}

          {selectedEntityId && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Upload Document</label>
              <ObjectUploader
                fileType="DOCUMENT"
                onComplete={onUploadComplete}
                allowedFileTypes={["application/pdf", "image/*"]}
                maxFileSize={MAX_STORAGE_FILE_SIZE}
              >
                {helpText}
              </ObjectUploader>
            </div>
          )}

          {analyzePending && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Uploading and analyzing document... This may take a moment.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
