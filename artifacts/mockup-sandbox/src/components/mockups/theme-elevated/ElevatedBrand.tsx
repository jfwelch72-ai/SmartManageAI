import React, { useState } from "react";
import {
  Search,
  Bell,
  Home,
  Briefcase,
  FolderKanban,
  Users,
  DollarSign,
  HardHat,
  ShieldAlert,
  Plus,
  ChevronDown,
  MoreVertical,
  Calendar,
  FileText,
  Clock,
  ArrowRight,
  TrendingUp,
  Building,
  CheckCircle2,
  FileBarChart
} from "lucide-react";

export function ElevatedBrand() {
  return (
    <div
      className="flex h-[800px] w-[1280px] overflow-hidden font-sans text-[#1A1A1A]"
      style={{
        backgroundColor: "#F9F8F7",
        fontFamily: "'Inter', 'DM Sans', sans-serif",
      }}
    >
      {/* Sidebar */}
      <aside
        className="w-[220px] flex-shrink-0 flex flex-col border-r border-[#E4E0DB]"
        style={{ backgroundColor: "#FDFCFB" }}
      >
        <div className="h-16 flex items-center px-6 border-b border-[#E4E0DB]/50">
          <div className="flex items-center gap-2 text-lg font-bold">
            <div className="w-7 h-7 rounded bg-[#E8611A] flex items-center justify-center text-white">
              <Building size={16} strokeWidth={2.5} />
            </div>
            <span>SmartManageAI</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-4 flex flex-col gap-6">
          {/* Section: Overview */}
          <div className="flex flex-col gap-1">
            <div className="px-2 text-[11px] font-bold tracking-widest text-[#8A8580] mb-2">
              OVERVIEW
            </div>
            <NavItem icon={<Home size={16} />} label="Home" active />
            <NavItem icon={<Briefcase size={16} />} label="Sales" />
          </div>

          {/* Section: Operations */}
          <div className="flex flex-col gap-1">
            <div className="px-2 text-[11px] font-bold tracking-widest text-[#8A8580] mb-2">
              OPERATIONS
            </div>
            <NavItem icon={<FolderKanban size={16} />} label="Projects" />
            <NavItem icon={<Users size={16} />} label="Workforce" />
            <NavItem icon={<HardHat size={16} />} label="Field Ops" />
          </div>

          {/* Section: Financial */}
          <div className="flex flex-col gap-1">
            <div className="px-2 text-[11px] font-bold tracking-widest text-[#8A8580] mb-2">
              FINANCIAL & SAFETY
            </div>
            <NavItem icon={<DollarSign size={16} />} label="Finance" />
            <NavItem icon={<ShieldAlert size={16} />} label="Safety" />
          </div>
        </div>

        <div className="p-4 border-t border-[#E4E0DB]/50">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#F3F1EC] cursor-pointer transition-colors">
            <div className="w-8 h-8 rounded-full bg-[#E4E0DB] overflow-hidden">
              <img
                src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
                alt="User"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-[#1A1A1A] truncate">
                Michael Chen
              </div>
              <div className="text-[11px] text-[#8A8580] truncate">
                Regional Director
              </div>
            </div>
            <MoreVertical size={14} className="text-[#8A8580]" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-[#E4E0DB] flex items-center justify-between px-8 flex-shrink-0">
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8A8580]"
              />
              <input
                type="text"
                placeholder="Search projects, documents, or people..."
                className="w-full h-9 pl-9 pr-4 rounded-md bg-[#F9F8F7] border border-transparent focus:border-[#E8611A]/30 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E8611A]/10 text-[13px] transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-5">
            <button className="relative text-[#6B6661] hover:text-[#1A1A1A] transition-colors">
              <Bell size={18} />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#E8611A] rounded-full border border-white"></span>
            </button>
            <button className="h-9 px-4 bg-[#E8611A] hover:bg-[#D97706] text-white text-[13px] font-medium rounded-md shadow-sm transition-colors flex items-center gap-2">
              <Plus size={16} />
              <span>New Project</span>
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#1A1A1A]">
                Overview
              </h1>
              <p className="text-[13px] text-[#6B6661] mt-1">
                Here's what's happening across your projects today.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="h-8 px-3 bg-white border border-[#E4E0DB] rounded-md text-[13px] font-medium text-[#1A1A1A] flex items-center gap-2 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <Calendar size={14} className="text-[#8A8580]" />
                <span>Last 30 Days</span>
                <ChevronDown size={14} className="text-[#8A8580]" />
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-5">
            <KpiCard
              title="Active Projects"
              value="24"
              icon={<FolderKanban size={18} className="text-[#E8611A]" />}
              trend="+2 this month"
              trendPositive={true}
            />
            <KpiCard
              title="Open Bids"
              value="$2.4M"
              icon={<FileText size={18} className="text-[#E8611A]" />}
              trend="-5% vs last month"
              trendPositive={false}
            />
            <KpiCard
              title="Crew Members"
              value="187"
              icon={<Users size={18} className="text-[#E8611A]" />}
              trend="94% utilization"
              trendPositive={true}
            />
            <KpiCard
              title="Revenue YTD"
              value="$8.1M"
              icon={<DollarSign size={18} className="text-[#E8611A]" />}
              trend="+12% vs last year"
              trendPositive={true}
            />
          </div>

          <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
            {/* Table Area */}
            <div className="col-span-2 flex flex-col bg-white border border-[#E4E0DB] rounded-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#E4E0DB] flex justify-between items-center bg-white">
                <h2 className="text-[15px] font-semibold text-[#1A1A1A]">
                  Recent Projects
                </h2>
                <button className="text-[13px] font-medium text-[#E8611A] hover:text-[#D97706]">
                  View All
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="bg-[#FDFCFB] border-b border-[#E4E0DB]">
                      <th className="font-medium text-[#6B6661] py-3 px-5">Project Name</th>
                      <th className="font-medium text-[#6B6661] py-3 px-5">Status</th>
                      <th className="font-medium text-[#6B6661] py-3 px-5">Value</th>
                      <th className="font-medium text-[#6B6661] py-3 px-5">Superintendent</th>
                      <th className="font-medium text-[#6B6661] py-3 px-5">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    <TableRow
                      name="Mercer Island High School"
                      status="In Progress"
                      value="$14.2M"
                      super="Sarah Jenkins"
                      progress={68}
                    />
                    <TableRow
                      name="Downtown Transit Hub"
                      status="Active"
                      value="$8.5M"
                      super="Marcus Webb"
                      progress={42}
                    />
                    <TableRow
                      name="Bellevue Medical Center"
                      status="In Progress"
                      value="$22.1M"
                      super="David Torres"
                      progress={85}
                    />
                    <TableRow
                      name="Riverfront Development"
                      status="Pending"
                      value="$5.3M"
                      super="Elena Rojas"
                      progress={5}
                    />
                    <TableRow
                      name="Westside Logistics Park"
                      status="Active"
                      value="$11.8M"
                      super="James McCarthy"
                      progress={24}
                    />
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Panel */}
            <div className="col-span-1 flex flex-col gap-6">
              {/* Upcoming Deadlines */}
              <div className="bg-white border border-[#E4E0DB] rounded-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col">
                <div className="px-5 py-4 border-b border-[#E4E0DB]">
                  <h2 className="text-[15px] font-semibold text-[#1A1A1A]">
                    Upcoming Deadlines
                  </h2>
                </div>
                <div className="p-2">
                  <DeadlineItem
                    title="Submittal Review: Steel Framing"
                    project="Mercer Island High School"
                    date="Today"
                    urgent
                  />
                  <DeadlineItem
                    title="RFI #142 Response Due"
                    project="Downtown Transit Hub"
                    date="Tomorrow"
                  />
                  <DeadlineItem
                    title="Monthly Safety Audit"
                    project="Bellevue Medical Center"
                    date="Oct 24"
                  />
                  <DeadlineItem
                    title="Bid Submission: Phase 2"
                    project="Riverfront Development"
                    date="Oct 26"
                  />
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-white border border-[#E4E0DB] rounded-[10px] shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col">
                <div className="px-5 py-4 border-b border-[#E4E0DB]">
                  <h2 className="text-[15px] font-semibold text-[#1A1A1A]">
                    Quick Actions
                  </h2>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3">
                  <QuickAction icon={<FileText size={18} />} label="Create RFI" />
                  <QuickAction icon={<CheckCircle2 size={18} />} label="Log Daily" />
                  <QuickAction icon={<FileBarChart size={18} />} label="New Estimate" />
                  <QuickAction icon={<Users size={18} />} label="Assign Crew" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// Subcomponents

function NavItem({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
        active
          ? "bg-[#FFF8F5] text-[#E8611A] font-medium"
          : "text-[#6B6661] hover:bg-[#F3F1EC] hover:text-[#1A1A1A]"
      }`}
      style={{
        borderLeft: active ? "3px solid #E8611A" : "3px solid transparent",
        marginLeft: active ? "-2px" : "0",
        paddingLeft: active ? "10px" : "12px",
      }}
    >
      <div className={active ? "text-[#E8611A]" : "text-[#8A8580]"}>{icon}</div>
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon,
  trend,
  trendPositive,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend: string;
  trendPositive: boolean;
}) {
  return (
    <div className="bg-white p-5 rounded-[10px] border border-[#E4E0DB] shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <div className="w-10 h-10 rounded-lg bg-[#FFF8F5] flex items-center justify-center">
          {icon}
        </div>
        <button className="text-[#8A8580] hover:text-[#1A1A1A]">
          <MoreVertical size={16} />
        </button>
      </div>
      <div>
        <div className="text-[26px] font-semibold text-[#1A1A1A] leading-none mb-1">
          {value}
        </div>
        <div className="text-[13px] font-medium text-[#6B6661]">{title}</div>
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <TrendingUp
          size={14}
          className={trendPositive ? "text-green-600" : "text-red-500 rotate-180"}
        />
        <span className="text-[12px] text-[#8A8580]">{trend}</span>
      </div>
    </div>
  );
}

function TableRow({
  name,
  status,
  value,
  super: superintendent,
  progress,
}: {
  name: string;
  status: string;
  value: string;
  super: string;
  progress: number;
}) {
  return (
    <tr className="border-b border-[#E4E0DB] hover:bg-[#FFF8F5] transition-colors group">
      <td className="py-3 px-5">
        <div className="font-medium text-[#1A1A1A]">{name}</div>
        <div className="text-[12px] text-[#8A8580] mt-0.5">ID: PRJ-{Math.floor(Math.random() * 9000) + 1000}</div>
      </td>
      <td className="py-3 px-5">
        <StatusBadge status={status} />
      </td>
      <td className="py-3 px-5 text-[#1A1A1A] font-medium">{value}</td>
      <td className="py-3 px-5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[#F3F1EC] flex items-center justify-center text-[10px] font-medium text-[#6B6661]">
            {superintendent.split(' ').map(n => n[0]).join('')}
          </div>
          <span className="text-[#6B6661]">{superintendent}</span>
        </div>
      </td>
      <td className="py-3 px-5">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-[5px] bg-[#E4E0DB] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#E8611A] rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[12px] font-medium text-[#6B6661] w-8">
            {progress}%
          </span>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  let bg = "bg-gray-100";
  let text = "text-gray-600";

  if (status === "In Progress") {
    bg = "bg-[#FFF8F5]";
    text = "text-[#E8611A]";
  } else if (status === "Active") {
    bg = "bg-emerald-50";
    text = "text-emerald-600";
  } else if (status === "Pending") {
    bg = "bg-[#F3F1EC]";
    text = "text-[#6B6661]";
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium ${bg} ${text}`}>
      {status}
    </span>
  );
}

function DeadlineItem({
  title,
  project,
  date,
  urgent,
}: {
  title: string;
  project: string;
  date: string;
  urgent?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-md hover:bg-[#F9F8F7] transition-colors cursor-pointer">
      <div className={`mt-0.5 w-2 h-2 rounded-full ${urgent ? "bg-[#E8611A]" : "bg-[#D1CDC7]"}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-[#1A1A1A] truncate">
          {title}
        </div>
        <div className="text-[12px] text-[#8A8580] truncate mt-0.5">
          {project}
        </div>
      </div>
      <div className={`text-[12px] font-medium whitespace-nowrap ${urgent ? "text-[#E8611A]" : "text-[#6B6661]"}`}>
        {date}
      </div>
    </div>
  );
}

function QuickAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border border-[#E4E0DB] hover:border-[#E8611A]/30 hover:bg-[#FFF8F5] transition-all group">
      <div className="text-[#8A8580] group-hover:text-[#E8611A] transition-colors">
        {icon}
      </div>
      <span className="text-[12px] font-medium text-[#1A1A1A]">{label}</span>
    </button>
  );
}
