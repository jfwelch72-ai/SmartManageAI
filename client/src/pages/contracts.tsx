import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { format } from "date-fns";
import { FileText, Search, Filter, Eye, Plus, ArrowRight } from "lucide-react";

interface Contract {
  id: string;
  projectId: string;
  contractNumber: string;
  contractType: string;
  status: string;
  contractValue: string | null;
  scopeSummary: string | null;
  currentVersion: number;
  createdAt: string;
  effectiveDate: string | null;
  expirationDate: string | null;
}

interface Project {
  id: string;
  name: string;
  code: string;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  IN_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  REDLINED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  EXECUTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  AMENDED: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

const TYPE_LABELS: Record<string, string> = {
  PRIME: "Prime",
  SUBCONTRACT: "Sub",
  JV: "JV",
  T_AND_M: "T&M",
};

const formatCurrency = (val: string | null) => {
  if (!val) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(val));
};

export default function ContractsPage() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: allContracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const { data: projectsResponse } = useQuery<{ data: Project[] }>({
    queryKey: ["/api/projects"],
  });
  const allProjects = projectsResponse?.data ?? [];

  const projectMap = new Map(allProjects.map(p => [p.id, p]));

  const filtered = allContracts.filter(c => {
    if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
    if (typeFilter !== "ALL" && c.contractType !== typeFilter) return false;
    if (projectFilter !== "ALL" && c.projectId !== projectFilter) return false;
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (new Date(c.createdAt) < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(c.createdAt) > to) return false;
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const project = projectMap.get(c.projectId);
      return (
        c.contractNumber.toLowerCase().includes(term) ||
        (c.scopeSummary && c.scopeSummary.toLowerCase().includes(term)) ||
        (project && (project.name.toLowerCase().includes(term) || project.code.toLowerCase().includes(term)))
      );
    }
    return true;
  });

  const statusCounts = allContracts.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
              <FileText className="h-6 w-6" />
              Contracts
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage contracts across all projects
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {["DRAFT", "IN_REVIEW", "REDLINED", "PENDING_APPROVAL", "APPROVED", "EXECUTED", "AMENDED"].map(status => (
            <Card
              key={status}
              className={`cursor-pointer transition-all ${statusFilter === status ? "ring-2 ring-primary" : ""}`}
              onClick={() => setStatusFilter(statusFilter === status ? "ALL" : status)}
              data-testid={`card-status-${status}`}
            >
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold" data-testid={`text-count-${status}`}>{statusCounts[status] || 0}</p>
                <p className="text-xs text-muted-foreground">{status.replace(/_/g, " ")}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="Search contracts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-contracts"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48" data-testid="select-status-filter">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="IN_REVIEW">In Review</SelectItem>
              <SelectItem value="REDLINED">Redlined</SelectItem>
              <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="EXECUTED">Executed</SelectItem>
              <SelectItem value="AMENDED">Amended</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40" data-testid="select-type-filter">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              <SelectItem value="PRIME">Prime</SelectItem>
              <SelectItem value="SUBCONTRACT">Subcontract</SelectItem>
              <SelectItem value="JV">Joint Venture</SelectItem>
              <SelectItem value="T_AND_M">T&M</SelectItem>
            </SelectContent>
          </Select>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-48" data-testid="select-project-filter">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Projects</SelectItem>
              {allProjects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">From:</span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="input-date-from" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">To:</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="input-date-to" />
          </div>
          {(dateFrom || dateTo || projectFilter !== "ALL") && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setProjectFilter("ALL"); }} data-testid="button-clear-filters">
              Clear Filters
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading contracts...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-contracts">
                {allContracts.length === 0 ? "No contracts created yet." : "No contracts match your filters."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((contract) => {
              const project = projectMap.get(contract.projectId);
              return (
                <Card key={contract.id} data-testid={`card-contract-${contract.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="outline" className="font-mono">{contract.contractNumber}</Badge>
                          <Badge className={STATUS_COLORS[contract.status] || ""}>{contract.status.replace(/_/g, " ")}</Badge>
                          <Badge variant="outline">{TYPE_LABELS[contract.contractType] || contract.contractType}</Badge>
                        </div>
                        {project && (
                          <Link href={`/projects/${project.code}`} className="text-sm text-primary hover:underline" data-testid={`link-project-${contract.id}`}>
                            {project.code} — {project.name}
                          </Link>
                        )}
                        {contract.scopeSummary && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{contract.scopeSummary}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          v{contract.currentVersion} · Created {format(new Date(contract.createdAt), "MMM d, yyyy")}
                          {contract.effectiveDate && ` · Effective ${format(new Date(contract.effectiveDate), "MMM d, yyyy")}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold font-mono" data-testid={`text-value-${contract.id}`}>
                          {formatCurrency(contract.contractValue)}
                        </p>
                        {project && (
                          <Link href={`/projects/${project.code}`}>
                            <Button size="sm" variant="ghost" data-testid={`button-view-${contract.id}`}>
                              <Eye className="h-4 w-4 mr-1" /> View Project
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
