import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, DollarSign, User, Calendar, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";

interface ProjectLaborHoursProps {
  projectId: string;
  projectCode: string;
}

interface LaborShift {
  id: string;
  userId: string;
  projectId: string;
  clockIn: string;
  clockOut: string | null;
  totalHours: string | null;
  approvalStatus: string;
  userName: string;
  userEmail: string;
  userRole: string;
  hourlyRate: number;
  laborCost: number;
  notes: string | null;
  autoClockOut: boolean;
}

interface LaborSummary {
  totalShifts: number;
  totalHours: number;
  totalLaborCost: number;
  averageHourlyRate: number;
}

interface LaborHoursResponse {
  shifts: LaborShift[];
  summary: LaborSummary;
}

export default function ProjectLaborHours({ projectId, projectCode }: ProjectLaborHoursProps) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("date-desc");

  // Build query params
  const queryParams = new URLSearchParams();
  if (startDate) queryParams.append("startDate", startDate);
  if (endDate) queryParams.append("endDate", endDate);
  if (approvalStatus && approvalStatus !== "ALL") queryParams.append("approvalStatus", approvalStatus);
  if (sortBy) queryParams.append("sortBy", sortBy);

  const queryString = queryParams.toString();
  const url = `/api/projects/${projectId}/labor-hours${queryString ? `?${queryString}` : ""}`;

  const { data, isLoading } = useQuery<LaborHoursResponse>({
    queryKey: ["/api/projects", projectId, "labor-hours", { startDate, endDate, approvalStatus, sortBy }],
    queryFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch labor hours");
      }
      return response.json();
    },
    enabled: !!projectId,
  });

  // Filter shifts by employee name (client-side)
  // Note: Sorting is handled server-side via the sortBy query parameter
  const filteredShifts = useMemo(() => {
    if (!data?.shifts) return [];
    
    return data.shifts.filter((shift) => {
      if (searchTerm && !shift.userName.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [data?.shifts, searchTerm]);

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case "APPROVED":
        return <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" data-testid="badge-approved"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case "REJECTED":
        return <Badge variant="destructive" data-testid="badge-rejected"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="secondary" data-testid="badge-pending"><AlertCircle className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-total-shifts">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Shifts</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-shifts">{data?.summary?.totalShifts ?? 0}</div>
            <p className="text-xs text-muted-foreground">Logged time entries</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-hours">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hours</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-hours">
              {data?.summary?.totalHours?.toFixed(2) ?? "0.00"}
            </div>
            <p className="text-xs text-muted-foreground">Hours worked</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-labor-cost">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Labor Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-labor-cost">
              ${data?.summary?.totalLaborCost?.toFixed(2) ?? "0.00"}
            </div>
            <p className="text-xs text-muted-foreground">Direct labor expenses</p>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-hourly-rate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Hourly Rate</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-avg-hourly-rate">
              ${data?.summary?.averageHourlyRate?.toFixed(2) ?? "0.00"}
            </div>
            <p className="text-xs text-muted-foreground">Per hour</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card data-testid="card-filters">
        <CardHeader>
          <CardTitle>Filters & Sorting</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="filter-search">Employee Name</Label>
              <Input
                id="filter-search"
                data-testid="input-filter-search"
                placeholder="Search employee..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-start-date">Start Date</Label>
              <Input
                id="filter-start-date"
                data-testid="input-filter-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-end-date">End Date</Label>
              <Input
                id="filter-end-date"
                data-testid="input-filter-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-approval-status">Approval Status</Label>
              <Select value={approvalStatus} onValueChange={setApprovalStatus}>
                <SelectTrigger id="filter-approval-status" data-testid="select-filter-approval-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-sort-by">Sort By</Label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger id="filter-sort-by" data-testid="select-filter-sort-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date-desc">Date (Newest First)</SelectItem>
                  <SelectItem value="date-asc">Date (Oldest First)</SelectItem>
                  <SelectItem value="hours-desc">Hours (High to Low)</SelectItem>
                  <SelectItem value="hours-asc">Hours (Low to High)</SelectItem>
                  <SelectItem value="cost-desc">Cost (High to Low)</SelectItem>
                  <SelectItem value="cost-asc">Cost (Low to High)</SelectItem>
                  <SelectItem value="employee-asc">Employee (A-Z)</SelectItem>
                  <SelectItem value="employee-desc">Employee (Z-A)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shifts Table */}
      <Card data-testid="card-shifts-table">
        <CardHeader>
          <CardTitle>Labor Hours</CardTitle>
          <CardDescription>
            Detailed breakdown of all time entries for {projectCode}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground" data-testid="text-loading">
              Loading labor hours...
            </div>
          ) : filteredShifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-muted-foreground" data-testid="text-no-shifts">
              <Clock className="w-12 h-12 mb-2 opacity-50" />
              <p>No labor hours recorded yet</p>
              <p className="text-sm">Time entries will appear here once employees clock in/out for this project</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredShifts.map((shift) => (
                    <TableRow key={shift.id} data-testid={`row-shift-${shift.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium" data-testid={`text-employee-name-${shift.id}`}>{shift.userName}</div>
                            <div className="text-xs text-muted-foreground">{shift.userRole}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-clock-in-${shift.id}`}>
                        {format(new Date(shift.clockIn), "MM/dd/yy h:mm a")}
                      </TableCell>
                      <TableCell data-testid={`text-clock-out-${shift.id}`}>
                        {shift.clockOut ? (
                          <span>
                            {format(new Date(shift.clockOut), "MM/dd/yy h:mm a")}
                            {shift.autoClockOut && (
                              <Badge variant="secondary" className="ml-2 text-xs">Auto</Badge>
                            )}
                          </span>
                        ) : (
                          <Badge variant="secondary">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-hours-${shift.id}`}>
                        {shift.totalHours ? parseFloat(shift.totalHours).toFixed(2) : "0.00"}
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-rate-${shift.id}`}>
                        ${shift.hourlyRate.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium" data-testid={`text-cost-${shift.id}`}>
                        ${shift.laborCost.toFixed(2)}
                      </TableCell>
                      <TableCell>{getApprovalBadge(shift.approvalStatus)}</TableCell>
                      <TableCell>
                        <div className="max-w-xs truncate text-xs text-muted-foreground" data-testid={`text-notes-${shift.id}`}>
                          {shift.notes || "-"}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
