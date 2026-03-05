import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

interface DayData {
  date: Date;
  regular: number;
  overtime: number;
  total: number;
}

interface WeeklySummaryData {
  weekStart: Date;
  weekEnd: Date;
  days: DayData[];
}

export function TimeEntryWeeklySummary({
  weeklySummary,
  weekOffset,
  setWeekOffset,
}: {
  weeklySummary: WeeklySummaryData;
  weekOffset: number;
  setWeekOffset: (fn: (w: number) => number) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle>Weekly Summary</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset((w) => w - 1)}
              data-testid="button-prev-week"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium min-w-[180px] text-center" data-testid="text-week-range">
              {format(weeklySummary.weekStart, "MMM d")} - {format(weeklySummary.weekEnd, "MMM d, yyyy")}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWeekOffset((w) => w + 1)}
              data-testid="button-next-week"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            {weekOffset !== 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWeekOffset(() => 0)}
                data-testid="button-current-week"
              >
                Today
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                {weeklySummary.days.map((d) => (
                  <TableHead key={d.date.toISOString()} className="text-center min-w-[80px]">
                    <div>{format(d.date, "EEE")}</div>
                    <div className="text-xs text-muted-foreground">{format(d.date, "MMM d")}</div>
                  </TableHead>
                ))}
                <TableHead className="text-center font-bold">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Regular</TableCell>
                {weeklySummary.days.map((d) => (
                  <TableCell key={d.date.toISOString()} className="text-center font-mono">
                    {d.regular > 0 ? d.regular.toFixed(1) : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-center font-mono font-bold" data-testid="text-weekly-total-regular">
                  {weeklySummary.days.reduce((sum, d) => sum + d.regular, 0).toFixed(1)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Overtime</TableCell>
                {weeklySummary.days.map((d) => (
                  <TableCell key={d.date.toISOString()} className="text-center font-mono">
                    {d.overtime > 0 ? d.overtime.toFixed(1) : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-center font-mono font-bold" data-testid="text-weekly-total-overtime">
                  {weeklySummary.days.reduce((sum, d) => sum + d.overtime, 0).toFixed(1)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-bold">Total</TableCell>
                {weeklySummary.days.map((d) => (
                  <TableCell key={d.date.toISOString()} className="text-center font-mono font-bold">
                    {d.total > 0 ? d.total.toFixed(1) : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-center font-mono font-bold" data-testid="text-weekly-grand-total">
                  {weeklySummary.days.reduce((sum, d) => sum + d.total, 0).toFixed(1)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
