import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Download, File, FileImage, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";

interface DocumentItem {
  id: string;
  title: string;
  fileName: string;
  fileUrl: string;
  type: string;
  mimeType: string | null;
  fileSize: number | null;
  uploadedAt: string;
}

interface PortalDocumentsTabProps {
  documents: DocumentItem[] | undefined;
}

function getFileIcon(mimeType: string | null, type: string) {
  if (!mimeType) return File;
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) return FileSpreadsheet;
  return FileText;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_LABELS: Record<string, string> = {
  PLANS: "Plans",
  SPECIFICATIONS: "Specifications",
  PERMITS: "Permits",
  CONTRACTS: "Contracts",
  SUBMITTALS: "Submittals",
  RFI: "RFI",
  CHANGE_ORDER: "Change Order",
  REPORT: "Report",
  PHOTO: "Photo",
  OTHER: "Other",
};

export function PortalDocumentsTab({ documents }: PortalDocumentsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Documents</CardTitle>
        <CardDescription>Plans, specifications, and other project documents</CardDescription>
      </CardHeader>
      <CardContent>
        {documents && documents.length > 0 ? (
          <ScrollArea className="max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => {
                  const Icon = getFileIcon(doc.mimeType, doc.type);
                  return (
                    <TableRow key={doc.id} data-testid={`row-document-${doc.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{doc.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{doc.fileName}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {TYPE_LABELS[doc.type] || doc.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatFileSize(doc.fileSize)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {doc.uploadedAt ? format(new Date(doc.uploadedAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                          data-testid={`button-download-${doc.id}`}
                        >
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" download>
                            <Download className="w-4 h-4" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        ) : (
          <div className="text-center py-8">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No documents available yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
