import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Search, Eye, MessageSquare, UserPlus, Users } from "lucide-react";

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  avatarUrl: string | null;
  tradeSpecialization: string | null;
  employmentType: string | null;
  createdAt: string;
  clockStatus: string | null;
  experienceLevel: string | null;
  currentProject: string | null;
}

const ROLE_OPTIONS = [
  { value: "ALL", label: "All Roles" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "SUPERINTENDENT", label: "Superintendent" },
  { value: "ESTIMATOR", label: "Estimator" },
  { value: "OFFICE_MANAGER", label: "Office Manager" },
  { value: "HOURLY_EMPLOYEE", label: "Hourly Employee" },
  { value: "MAINTENANCE_MANAGER", label: "Maintenance Manager" },
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "ALL", label: "All Types" },
  { value: "Direct Hire", label: "Direct Hire" },
  { value: "Subcontractor", label: "Subcontractor" },
  { value: "Temp/Day Hire", label: "Temp/Day Hire" },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  SUPERINTENDENT: "Superintendent",
  ESTIMATOR: "Estimator",
  OFFICE_MANAGER: "Office Manager",
  HOURLY_EMPLOYEE: "Hourly Employee",
  MAINTENANCE_MANAGER: "Maintenance Manager",
};

function getStatusColor(clockStatus: string | null): string {
  if (!clockStatus) return "bg-gray-400";
  switch (clockStatus) {
    case "ON_DUTY":
    case "PRESENT":
      return "bg-green-500";
    case "LATE":
    case "HALF_DAY":
    case "EXCUSED":
      return "bg-yellow-500";
    case "ABSENT":
      return "bg-red-500";
    case "INACTIVE":
    default:
      return "bg-gray-400";
  }
}

function getStatusLabel(clockStatus: string | null): string {
  if (!clockStatus) return "No Data";
  switch (clockStatus) {
    case "ON_DUTY":
      return "On Duty";
    case "PRESENT":
      return "Present";
    case "LATE":
      return "Late";
    case "HALF_DAY":
      return "Half Day";
    case "EXCUSED":
      return "Off Duty";
    case "ABSENT":
      return "Absent";
    case "INACTIVE":
      return "Inactive";
    default:
      return "No Data";
  }
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function WorkerCardSkeleton() {
  return (
    <Card className="rounded-md">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-3 w-3 rounded-full" />
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function ManageWorkersPage() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [tradeFilter, setTradeFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState("ALL");

  const queryParams = new URLSearchParams();
  if (tradeFilter) queryParams.set("trade", tradeFilter);
  if (roleFilter !== "ALL") queryParams.set("role", roleFilter);
  if (employmentTypeFilter !== "ALL") queryParams.set("employmentType", employmentTypeFilter);
  const queryString = queryParams.toString();

  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ["/api/auth/manage-workers", queryString ? `?${queryString}` : ""],
  });

  const filteredWorkers = searchTerm
    ? workers.filter((w) => {
        const fullName = `${w.firstName} ${w.lastName}`.toLowerCase();
        const term = searchTerm.toLowerCase();
        return fullName.includes(term) || w.email.toLowerCase().includes(term);
      })
    : workers;

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">
                Manage Workers
              </h1>
              <p className="text-muted-foreground" data-testid="text-worker-count">
                {isLoading ? "Loading..." : `${filteredWorkers.length} worker${filteredWorkers.length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              className="pl-9 w-[220px]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-workers"
            />
          </div>

          <Input
            placeholder="Filter by trade..."
            className="w-[180px]"
            value={tradeFilter}
            onChange={(e) => setTradeFilter(e.target.value)}
            data-testid="input-trade-filter"
          />

          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-role-filter">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} data-testid={`option-role-${opt.value.toLowerCase()}`}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={employmentTypeFilter} onValueChange={setEmploymentTypeFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-employment-type-filter">
              <SelectValue placeholder="Employment Type" />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} data-testid={`option-employment-${opt.value.toLowerCase().replace(/\//g, "-")}`}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="loading-skeleton">
            {Array.from({ length: 6 }).map((_, i) => (
              <WorkerCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredWorkers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">No workers found</h3>
            <p className="text-muted-foreground mt-1">
              Try adjusting your filters or search term.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {filteredWorkers.map((worker) => (
              <Card key={worker.id} className="rounded-md" data-testid={`card-worker-${worker.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-10 w-10" data-testid={`avatar-worker-${worker.id}`}>
                      <AvatarImage src={worker.avatarUrl || undefined} alt={`${worker.firstName} ${worker.lastName}`} />
                      <AvatarFallback>{getInitials(worker.firstName, worker.lastName)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold truncate" data-testid={`text-worker-name-${worker.id}`}>
                          {worker.firstName} {worker.lastName}
                        </span>
                        <div
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${getStatusColor(worker.clockStatus)}`}
                          title={getStatusLabel(worker.clockStatus)}
                          data-testid={`status-indicator-${worker.id}`}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground truncate" data-testid={`text-worker-role-${worker.id}`}>
                        {ROLE_LABELS[worker.role] || worker.role}
                        {worker.tradeSpecialization ? ` / ${worker.tradeSpecialization}` : ""}
                      </p>
                      <p className="text-sm text-muted-foreground truncate" data-testid={`text-worker-status-${worker.id}`}>
                        {getStatusLabel(worker.clockStatus)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {worker.experienceLevel && (
                      <Badge variant="secondary" data-testid={`badge-experience-${worker.id}`}>
                        {worker.experienceLevel}
                      </Badge>
                    )}
                    {worker.employmentType && (
                      <Badge variant="secondary" data-testid={`badge-employment-${worker.id}`}>
                        {worker.employmentType}
                      </Badge>
                    )}
                  </div>

                  {worker.currentProject && (
                    <p className="mt-2 text-sm text-muted-foreground" data-testid={`text-project-${worker.id}`}>
                      Project: {worker.currentProject}
                      {worker.createdAt && (
                        <span className="ml-1">
                          (since {new Date(worker.createdAt).toLocaleDateString()})
                        </span>
                      )}
                    </p>
                  )}

                  <div className="mt-4 flex items-center gap-2">
                    <Link href={`/manage-workers/${worker.id}`}>
                      <Button variant="outline" size="sm" data-testid={`button-view-${worker.id}`}>
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
                    </Link>
                    <Link href="/messages">
                      <Button variant="outline" size="sm" data-testid={`button-message-${worker.id}`}>
                        <MessageSquare className="w-4 h-4 mr-1" />
                        Message
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" data-testid={`button-assign-${worker.id}`}>
                      <UserPlus className="w-4 h-4 mr-1" />
                      Assign
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
