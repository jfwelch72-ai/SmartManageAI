import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import KPICard from "@/components/KPICard";
import ProjectCard from "@/components/ProjectCard";
import { Briefcase, Clock, DollarSign, Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

//todo: remove mock functionality
const mockProjects = [
  {
    code: "TFR-240639",
    name: "OSU Outpatient East – Parking Lot",
    clientName: "Ohio State University",
    status: "ACTIVE" as const,
    location: "Columbus, OH",
    superintendent: "Mike Johnson",
  },
  {
    code: "TFR-240512",
    name: "Downtown Office Tower Foundation",
    clientName: "Cityscape Developers",
    status: "PLANNING" as const,
    location: "Columbus, OH",
    superintendent: "Sarah Williams",
  },
  {
    code: "TFR-240420",
    name: "Riverside Apartment Complex",
    clientName: "Riverside Properties LLC",
    status: "BID" as const,
    location: "Dublin, OH",
  },
  {
    code: "TFR-240301",
    name: "Hilltop Shopping Center Expansion",
    clientName: "Retail Ventures Inc",
    status: "ACTIVE" as const,
    location: "Columbus, OH",
    superintendent: "Tom Anderson",
  },
];

export default function DashboardPage() {
  const [, setLocation] = useLocation();

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
            <h1 className="text-2xl font-bold text-foreground mb-1">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Overview of all active projects and key metrics
            </p>
          </div>
          <Button data-testid="button-new-project">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>

        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <KPICard
              title="Active Projects"
              value={12}
              icon={Briefcase}
              trend={{ value: "2 from last month", isPositive: true }}
            />
            <KPICard
              title="Open Bids"
              value={5}
              icon={DollarSign}
            />
            <KPICard
              title="Hours This Week"
              value="1,247"
              icon={Clock}
              trend={{ value: "5% from last week", isPositive: true }}
            />
            <KPICard
              title="Active Employees"
              value={48}
              icon={Users}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Active Projects</h2>
              <Button variant="outline" onClick={() => setLocation('/projects')} data-testid="button-view-all">
                View All
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {mockProjects.slice(0, 3).map((project) => (
                <ProjectCard
                  key={project.code}
                  {...project}
                  onClick={() => setLocation(`/projects/${project.code}`)}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
