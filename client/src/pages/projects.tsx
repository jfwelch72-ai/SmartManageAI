import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import ProjectsTable from "@/components/ProjectsTable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus } from "lucide-react";
import { useLocation } from "wouter";

//todo: remove mock functionality
const mockProjects = [
  {
    id: '1',
    code: 'TFR-240639',
    name: 'OSU Outpatient East – Parking Lot',
    clientName: 'Ohio State University',
    status: 'ACTIVE' as const,
    superintendent: 'Mike Johnson',
    estimator: 'Sarah Williams',
  },
  {
    id: '2',
    code: 'TFR-240512',
    name: 'Downtown Office Tower Foundation',
    clientName: 'Cityscape Developers',
    status: 'PLANNING' as const,
    superintendent: 'Tom Anderson',
    estimator: 'Sarah Williams',
  },
  {
    id: '3',
    code: 'TFR-240420',
    name: 'Riverside Apartment Complex',
    clientName: 'Riverside Properties LLC',
    status: 'BID' as const,
    estimator: 'David Chen',
  },
  {
    id: '4',
    code: 'TFR-240301',
    name: 'Hilltop Shopping Center Expansion',
    clientName: 'Retail Ventures Inc',
    status: 'ACTIVE' as const,
    superintendent: 'Tom Anderson',
    estimator: 'David Chen',
  },
  {
    id: '5',
    code: 'TFR-240205',
    name: 'Central High School Renovation',
    clientName: 'Columbus City Schools',
    status: 'COMPLETE' as const,
    superintendent: 'Mike Johnson',
    estimator: 'Sarah Williams',
  },
];

export default function ProjectsPage() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filteredProjects = mockProjects.filter(project => {
    const matchesSearch = 
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.clientName.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "ALL" || project.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName="Sarah Williams"
        userRole="Project Manager"
        onLogout={() => setLocation('/login')}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1">Projects</h1>
            <p className="text-sm text-muted-foreground">
              Manage all construction projects
            </p>
          </div>
          <Button data-testid="button-new-project">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search projects by name, code, or client..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-48" data-testid="select-status-filter">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="BID">Bid</SelectItem>
              <SelectItem value="PLANNING">Planning</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="COMPLETE">Complete</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <ProjectsTable
          projects={filteredProjects}
          onRowClick={(project) => setLocation(`/projects/${project.code}`)}
        />
      </main>
    </div>
  );
}
