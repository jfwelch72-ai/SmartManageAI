import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, DollarSign, User, Calendar as CalendarIcon, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
  const [timePeriod, setTimePeriod] = useState("all");

  // Handle time period selection
  const handleTimePeriodChange = (period: string) => {
    setTimePeriod(period);
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Helper to format date as YYYY-MM-DD in local timezone
    const formatDate = (date: Date) => format(date, 'yyyy-MM-dd');
    
    switch (period) {
      case "today":
        setStartDate(formatDate(today));
        setEndDate(formatDate(today));
        break;
      case "yesterday":
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        setStartDate(formatDate(yesterday));
        setEndDate(formatDate(yesterday));
        break;
      case "this-week":
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
        setStartDate(formatDate(startOfWeek));
        setEndDate(formatDate(today));
        break;
      case "last-week":
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(today.getDate() - today.getDay() - 1); // Last Saturday
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekEnd.getDate() - 6); // Last Sunday
        setStartDate(formatDate(lastWeekStart));
        setEndDate(formatDate(lastWeekEnd));
        break;
      case "this-month":
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        setStartDate(formatDate(startOfMonth));
        setEndDate(formatDate(today));
        break;
      case "last-month":
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        setStartDate(formatDate(lastMonthStart));
        setEndDate(formatDate(lastMonthEnd));
        break;
      case "last-7-days":
        const sixDaysAgo = new Date(today);
        sixDaysAgo.setDate(today.getDate() - 6); // 6 days ago + today = 7 days total
        setStartDate(formatDate(sixDaysAgo));
        setEndDate(formatDate(today));
        break;
      case "last-30-days":
        const twentyNineDaysAgo = new Date(today);
        twentyNineDaysAgo.setDate(today.getDate() - 29); // 29 days ago + today = 30 days total
        setStartDate(formatDate(twentyNineDaysAgo));
        setEndDate(formatDate(today));
        break;
      case "all":
      default:
        setStartDate("");
        setEndDate("");
        break;
    }
  };

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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label htmlFor="filter-time-period">Time Period</Label>
              <Select value={timePeriod} onValueChange={handleTimePeriodChange}>
                <SelectTrigger id="filter-time-period" data-testid="select-filter-time-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="this-week">This Week</SelectItem>
                  <SelectItem value="last-week">Last Week</SelectItem>
                  <SelectItem value="last-7-days">Last 7 Days</SelectItem>
                  <SelectItem value="this-month">This Month</SelectItem>
                  <SelectItem value="last-month">Last Month</SelectItem>
                  <SelectItem value="last-30-days">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-start-date">Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                    data-testid="input-filter-start-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(parseISO(startDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={startDate ? parseISO(startDate) : undefined}
                    onSelect={(date) => {
                      setStartDate(date ? format(date, "yyyy-MM-dd") : "");
                      setTimePeriod("all");
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filter-end-date">End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                    data-testid="input-filter-end-date"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(parseISO(endDate), "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarPicker
                    mode="single"
                    selected={endDate ? parseISO(endDate) : undefined}
                    onSelect={(date) => {
                      setEndDate(date ? format(date, "yyyy-MM-dd") : "");
                      setTimePeriod("all");
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

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
