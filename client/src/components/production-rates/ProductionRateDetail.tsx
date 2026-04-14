import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import type { ProductionRate, ProductionRateDetail as ProductionRateDetailType } from "./types";

interface ProductionRateDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRate: ProductionRate | null;
  detailData: ProductionRateDetailType | undefined;
  detailLoading: boolean;
}

export function ProductionRateDetailDialog({
  open,
  onOpenChange,
  selectedRate,
  detailData,
  detailLoading,
}: ProductionRateDetailProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selectedRate?.description}
            <Badge variant="secondary">{selectedRate?.unit}</Badge>
          </DialogTitle>
          <DialogDescription>
            Detailed breakdown by project and daily performance
          </DialogDescription>
        </DialogHeader>

        {detailLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading details...</div>
        ) : detailData ? (
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="projects">By Project</TabsTrigger>
              <TabsTrigger value="entries">All Entries</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="mt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Average/Day</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{selectedRate?.avgPerDay.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">{selectedRate?.unit}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Median/Day</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{selectedRate?.medianPerDay.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">{selectedRate?.unit}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Std Deviation</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{selectedRate?.stdDev.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">Variability measure</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Range</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {selectedRate?.minPerDay} - {selectedRate?.maxPerDay}
                    </div>
                    <p className="text-xs text-muted-foreground">Min - Max per day</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Recent Daily Totals</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[200px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Projects</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailData.dailyTotals.slice(0, 20).map((day) => (
                          <TableRow key={day.date}>
                            <TableCell>{format(new Date(day.date), "MMM d, yyyy")}</TableCell>
                            <TableCell className="text-right font-medium">
                              {day.total.toLocaleString()} {selectedRate?.unit}
                            </TableCell>
                            <TableCell className="text-right">{day.projectCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="projects" className="mt-4">
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Total Qty</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Avg/Day</TableHead>
                      <TableHead className="text-right">Entries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailData.projectStats.map((project) => (
                      <TableRow key={project.code}>
                        <TableCell>
                          <div className="font-medium">{project.code}</div>
                          <div className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {project.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {project.totalQuantity.toLocaleString()} {selectedRate?.unit}
                        </TableCell>
                        <TableCell className="text-right">{project.days}</TableCell>
                        <TableCell className="text-right font-medium">
                          {project.avgPerDay.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">{project.entries}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="entries" className="mt-4">
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailData.entries.slice(0, 100).map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{format(new Date(entry.workDate), "MMM d, yyyy")}</TableCell>
                        <TableCell>
                          <div className="font-medium">{entry.projectCode}</div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {entry.quantity.toLocaleString()} {selectedRate?.unit}
                        </TableCell>
                        <TableCell className="text-sm">{entry.createdBy}</TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                          {entry.notes || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
