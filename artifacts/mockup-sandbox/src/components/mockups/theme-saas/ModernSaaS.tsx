import React from "react";
import {
  LayoutDashboard,
  Briefcase,
  Users,
  HardHat,
  Wallet,
  ShieldCheck,
  Search,
  Bell,
  MoreHorizontal,
  Plus,
  ArrowUpRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle
} from "lucide-react";

export function ModernSaaS() {
  return (
    <div
      className="flex h-[800px] w-[1280px] overflow-hidden font-sans"
      style={{ backgroundColor: "#FAFAFA", color: "#111827", fontFamily: "'Inter', sans-serif" }}
    >
      {/* Sidebar */}
      <div
        className="w-[220px] flex-shrink-0 flex flex-col border-r border-[#E5E7EB]"
        style={{ backgroundColor: "#FFFFFF" }}
      >
        <div className="h-14 flex items-center px-4 border-b border-[#E5E7EB]">
          <div className="w-8 h-8 rounded bg-[#6366F1] flex items-center justify-center mr-3">
            <HardHat className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-[#111827]">
            SmartManageAI
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {/* Main Nav */}
          <div>
            <div className="px-3 mb-2 text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase">
              Main
            </div>
            <div className="space-y-0.5">
              <button className="w-full flex items-center px-3 py-2 text-[13px] font-medium rounded-md bg-[#EEF2FF] text-[#6366F1]">
                <LayoutDashboard className="w-4 h-4 mr-3" />
                Home
              </button>
              <button className="w-full flex items-center px-3 py-2 text-[13px] font-medium rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors">
                <Wallet className="w-4 h-4 mr-3" />
                Sales
              </button>
              <button className="w-full flex items-center px-3 py-2 text-[13px] font-medium rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors">
                <Briefcase className="w-4 h-4 mr-3" />
                Projects
              </button>
            </div>
          </div>

          {/* Operations Nav */}
          <div>
            <div className="px-3 mb-2 text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase">
              Operations
            </div>
            <div className="space-y-0.5">
              <button className="w-full flex items-center px-3 py-2 text-[13px] font-medium rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors">
                <Users className="w-4 h-4 mr-3" />
                Workforce
              </button>
              <button className="w-full flex items-center px-3 py-2 text-[13px] font-medium rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors">
                <Wallet className="w-4 h-4 mr-3" />
                Finance
              </button>
              <button className="w-full flex items-center px-3 py-2 text-[13px] font-medium rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors">
                <HardHat className="w-4 h-4 mr-3" />
                Field Ops
              </button>
              <button className="w-full flex items-center px-3 py-2 text-[13px] font-medium rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827] transition-colors">
                <ShieldCheck className="w-4 h-4 mr-3" />
                Safety
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header
          className="h-14 flex items-center justify-between px-6 border-b border-[#E5E7EB] shrink-0"
          style={{ backgroundColor: "#FFFFFF" }}
        >
          <div className="flex items-center flex-1">
            <div className="relative w-96">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                placeholder="Search projects, bids, or members..."
                className="w-full h-9 pl-9 pr-4 rounded-md bg-[#FAFAFA] border-none text-[13px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#6366F1]"
              />
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button className="relative p-1 text-[#6B7280] hover:text-[#111827] transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#EF4444] border border-white"></span>
            </button>
            <div className="w-8 h-8 rounded-full bg-[#E5E7EB] overflow-hidden">
              <img
                src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
                alt="User avatar"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-auto p-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-[28px] font-bold text-[#111827] tracking-tight">Overview</h1>
            <button className="flex items-center px-4 py-2 bg-[#111827] text-white text-[13px] font-medium rounded-md hover:bg-[#374151] transition-colors">
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </button>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-4 gap-6 mb-8">
            {[
              {
                label: "Active Projects",
                value: "24",
                trend: "+3 this month",
                color: "#6366F1",
              },
              {
                label: "Open Bids",
                value: "$2.4M",
                trend: "+$400k this week",
                color: "#F59E0B",
              },
              {
                label: "Crew Members",
                value: "187",
                trend: "+12 this month",
                color: "#10B981",
              },
              {
                label: "Revenue YTD",
                value: "$8.1M",
                trend: "+14% vs last year",
                color: "#8B5CF6",
              },
            ].map((kpi, i) => (
              <div
                key={i}
                className="p-6 rounded-xl border border-[#E5E7EB] flex flex-col"
                style={{ backgroundColor: "#FFFFFF" }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: kpi.color }}
                    ></div>
                    <span className="text-[13px] font-medium text-[#6B7280]">
                      {kpi.label}
                    </span>
                  </div>
                  <MoreHorizontal className="w-4 h-4 text-[#9CA3AF]" />
                </div>
                <div className="text-[32px] font-bold text-[#111827] leading-none mb-2 tracking-tight">
                  {kpi.value}
                </div>
                <div className="flex items-center text-[12px] font-medium text-[#10B981]">
                  <TrendingUp className="w-3 h-3 mr-1" />
                  {kpi.trend}
                </div>
              </div>
            ))}
          </div>

          {/* Main Layout Grid */}
          <div className="grid grid-cols-3 gap-8">
            {/* Left Col - Table */}
            <div className="col-span-2 space-y-6">
              <div
                className="rounded-xl border border-[#E5E7EB] overflow-hidden"
                style={{ backgroundColor: "#FFFFFF" }}
              >
                <div className="px-6 py-5 border-b border-[#E5E7EB] flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold text-[#111827]">Recent Projects</h2>
                  <button className="text-[13px] font-medium text-[#6366F1] hover:text-[#4F46E5]">
                    View all
                  </button>
                </div>
                <div className="w-full">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="px-6 py-3 text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase border-b border-[#F3F4F6]">
                          Project Name
                        </th>
                        <th className="px-6 py-3 text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase border-b border-[#F3F4F6]">
                          Status
                        </th>
                        <th className="px-6 py-3 text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase border-b border-[#F3F4F6]">
                          Value
                        </th>
                        <th className="px-6 py-3 text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase border-b border-[#F3F4F6]">
                          Superintendent
                        </th>
                        <th className="px-6 py-3 text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase border-b border-[#F3F4F6]">
                          Progress
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[13px]">
                      {[
                        {
                          name: "Downtown Highrise",
                          status: "On Track",
                          statusColor: "#10B981",
                          value: "$4.2M",
                          super: "Sarah Jenkins",
                          progress: 68,
                        },
                        {
                          name: "Westside Retail Park",
                          status: "At Risk",
                          statusColor: "#F59E0B",
                          value: "$1.8M",
                          super: "Mike Thompson",
                          progress: 42,
                        },
                        {
                          name: "Riverfront Condos",
                          status: "On Track",
                          statusColor: "#10B981",
                          value: "$8.5M",
                          super: "David Chen",
                          progress: 89,
                        },
                        {
                          name: "City Hospital Expansion",
                          status: "Delayed",
                          statusColor: "#EF4444",
                          value: "$12.4M",
                          super: "Amanda Miller",
                          progress: 15,
                        },
                        {
                          name: "Highway 99 Overpass",
                          status: "On Track",
                          statusColor: "#10B981",
                          value: "$3.1M",
                          super: "Robert Davis",
                          progress: 55,
                        },
                      ].map((row, i) => (
                        <tr key={i} className="group">
                          <td className="px-6 py-4 border-b border-[#F3F4F6] font-medium text-[#111827]">
                            {row.name}
                          </td>
                          <td className="px-6 py-4 border-b border-[#F3F4F6]">
                            <div className="flex items-center">
                              <span
                                className="w-1.5 h-1.5 rounded-full mr-2"
                                style={{ backgroundColor: row.statusColor }}
                              ></span>
                              <span className="text-[#6B7280]">{row.status}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 border-b border-[#F3F4F6] text-[#6B7280]">
                            {row.value}
                          </td>
                          <td className="px-6 py-4 border-b border-[#F3F4F6] text-[#6B7280]">
                            {row.super}
                          </td>
                          <td className="px-6 py-4 border-b border-[#F3F4F6]">
                            <div className="flex items-center space-x-3">
                              <div className="flex-1 h-[3px] bg-[#F3F4F6] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#6366F1] rounded-full"
                                  style={{ width: `${row.progress}%` }}
                                ></div>
                              </div>
                              <span className="text-[#9CA3AF] text-[12px] w-8 text-right">
                                {row.progress}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Col */}
            <div className="space-y-6">
              {/* Upcoming Deadlines */}
              <div
                className="rounded-xl border border-[#E5E7EB] p-6"
                style={{ backgroundColor: "#FFFFFF" }}
              >
                <h3 className="text-[15px] font-semibold text-[#111827] mb-5">
                  Upcoming Deadlines
                </h3>
                <div className="space-y-5">
                  {[
                    {
                      title: "Pour foundation - Westside",
                      date: "Tomorrow, 8:00 AM",
                      icon: Clock,
                      color: "#F59E0B",
                    },
                    {
                      title: "Submit bid for City Hall",
                      date: "Oct 12, 5:00 PM",
                      icon: AlertCircle,
                      color: "#EF4444",
                    },
                    {
                      title: "Safety inspection - Highrise",
                      date: "Oct 14, 10:00 AM",
                      icon: CheckCircle2,
                      color: "#6B7280",
                    },
                    {
                      title: "Material delivery",
                      date: "Oct 15, 9:00 AM",
                      icon: Clock,
                      color: "#6B7280",
                    },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start">
                      <div className="mt-0.5 mr-3">
                        <item.icon
                          className="w-4 h-4"
                          style={{ color: item.color }}
                        />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-[#111827] mb-0.5">
                          {item.title}
                        </div>
                        <div className="text-[12px] text-[#6B7280]">{item.date}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div
                className="rounded-xl border border-[#E5E7EB] p-6"
                style={{ backgroundColor: "#FFFFFF" }}
              >
                <h3 className="text-[15px] font-semibold text-[#111827] mb-4">
                  Quick Actions
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <button className="flex flex-col items-center justify-center py-4 px-3 rounded-lg border border-[#E5E7EB] hover:border-[#6366F1] hover:bg-[#EEF2FF] transition-colors group">
                    <Plus className="w-5 h-5 text-[#9CA3AF] group-hover:text-[#6366F1] mb-2" />
                    <span className="text-[12px] font-medium text-[#6B7280] group-hover:text-[#6366F1]">
                      Create Bid
                    </span>
                  </button>
                  <button className="flex flex-col items-center justify-center py-4 px-3 rounded-lg border border-[#E5E7EB] hover:border-[#6366F1] hover:bg-[#EEF2FF] transition-colors group">
                    <Users className="w-5 h-5 text-[#9CA3AF] group-hover:text-[#6366F1] mb-2" />
                    <span className="text-[12px] font-medium text-[#6B7280] group-hover:text-[#6366F1]">
                      Assign Crew
                    </span>
                  </button>
                  <button className="flex flex-col items-center justify-center py-4 px-3 rounded-lg border border-[#E5E7EB] hover:border-[#6366F1] hover:bg-[#EEF2FF] transition-colors group">
                    <Wallet className="w-5 h-5 text-[#9CA3AF] group-hover:text-[#6366F1] mb-2" />
                    <span className="text-[12px] font-medium text-[#6B7280] group-hover:text-[#6366F1]">
                      New Invoice
                    </span>
                  </button>
                  <button className="flex flex-col items-center justify-center py-4 px-3 rounded-lg border border-[#E5E7EB] hover:border-[#6366F1] hover:bg-[#EEF2FF] transition-colors group">
                    <ShieldCheck className="w-5 h-5 text-[#9CA3AF] group-hover:text-[#6366F1] mb-2" />
                    <span className="text-[12px] font-medium text-[#6B7280] group-hover:text-[#6366F1]">
                      Log Safety
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
