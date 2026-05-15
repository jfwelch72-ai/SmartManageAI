import React from "react";
import { 
  Bell, 
  Search, 
  Home, 
  DollarSign, 
  Briefcase, 
  Users, 
  PieChart, 
  Truck, 
  ShieldAlert,
  ChevronDown,
  MoreHorizontal,
  Calendar,
  Plus,
  FileText,
  MessageSquare
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export function FluentClean() {
  return (
    <div className="flex h-[800px] w-[1280px] bg-[#FFFFFF] font-sans text-[#242424] overflow-hidden border border-[#E5E7EB] mx-auto shadow-sm">
      {/* Sidebar */}
      <aside className="w-[220px] bg-[#F5F7FA] border-r border-[#E5E7EB] flex flex-col h-full shrink-0">
        <div className="h-14 flex items-center px-4 shrink-0 border-b border-transparent">
          <div className="flex items-center gap-2 text-[#0078D4] font-semibold text-lg tracking-tight">
            <div className="w-6 h-6 bg-[#0078D4] rounded-md flex items-center justify-center text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            SmartManageAI
          </div>
        </div>

        <div className="flex-1 py-4 overflow-y-auto">
          <nav className="space-y-0.5 px-2">
            {[
              { icon: Home, label: "Home", active: true },
              { icon: DollarSign, label: "Sales" },
              { icon: Briefcase, label: "Projects" },
              { icon: Users, label: "Workforce" },
              { icon: PieChart, label: "Finance" },
              { icon: Truck, label: "Field Ops" },
              { icon: ShieldAlert, label: "Safety" },
            ].map((item, idx) => (
              <a 
                key={idx} 
                href="#" 
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors relative ${
                  item.active 
                    ? "bg-[#E6F2FA] text-[#0078D4]" 
                    : "text-[#616161] hover:bg-[#EBEBEB] hover:text-[#242424]"
                }`}
              >
                {item.active && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-[#0078D4] rounded-r-full" />
                )}
                <item.icon className="w-[18px] h-[18px]" strokeWidth={2} />
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-[#E5E7EB]">
          <div className="flex items-center gap-3 px-2">
            <Avatar className="w-8 h-8 rounded-full">
              <AvatarImage src="https://i.pravatar.cc/150?u=a042581f4e29026704d" />
              <AvatarFallback className="bg-[#0078D4] text-white text-xs">MK</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-[#242424] truncate">Michael King</p>
              <p className="text-[11px] text-[#616161] truncate">Project Director</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#F5F7FA]">
        {/* Header */}
        <header className="h-14 bg-[#FFFFFF] border-b border-[#E5E7EB] flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center text-[15px] font-medium text-[#242424]">
            Dashboard Overview
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="w-4 h-4 text-[#616161] absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search projects, bids, or people..." 
                className="h-8 w-[280px] bg-[#F5F7FA] border border-[#E5E7EB] rounded-full pl-9 pr-4 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#0078D4] focus:border-[#0078D4] transition-shadow placeholder:text-[#8D8D8D]"
              />
            </div>
            <button className="relative p-1.5 text-[#616161] hover:bg-[#F5F7FA] rounded-full transition-colors">
              <Bell className="w-5 h-5" strokeWidth={1.5} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#D13438] rounded-full border border-white"></span>
            </button>
          </div>
        </header>

        {/* Dashboard Body */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          
          {/* KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Active Projects", value: "24", icon: Briefcase, color: "text-[#0078D4]", bg: "bg-[#E6F2FA]" },
              { label: "Open Bids", value: "$2.4M", icon: FileText, color: "text-[#0078D4]", bg: "bg-[#E6F2FA]" },
              { label: "Crew Members", value: "187", icon: Users, color: "text-[#0078D4]", bg: "bg-[#E6F2FA]" },
              { label: "Revenue YTD", value: "$8.1M", icon: DollarSign, color: "text-[#0078D4]", bg: "bg-[#E6F2FA]" }
            ].map((stat, i) => (
              <div key={i} className="bg-[#FFFFFF] border border-[#E5E7EB] rounded-[8px] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col transition-shadow hover:shadow-[0_2px_5px_rgba(0,0,0,0.05)]">
                <div className="flex justify-between items-start mb-2">
                  <div className={`w-8 h-8 rounded-full ${stat.bg} flex items-center justify-center`}>
                    <stat.icon className={`w-4 h-4 ${stat.color}`} strokeWidth={2} />
                  </div>
                </div>
                <div>
                  <h3 className="text-[24px] font-semibold text-[#242424] leading-tight mb-0.5">{stat.value}</h3>
                  <p className="text-[13px] text-[#616161]">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-3 gap-6 h-[460px]">
            
            {/* Table Area (Spans 2 cols) */}
            <div className="col-span-2 bg-[#FFFFFF] border border-[#E5E7EB] rounded-[8px] shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col">
              <div className="px-5 py-4 border-b border-[#E5E7EB] flex justify-between items-center shrink-0">
                <h2 className="text-[15px] font-semibold text-[#242424]">Recent Projects</h2>
                <button className="text-[13px] font-medium text-[#0078D4] hover:underline">View All</button>
              </div>
              <div className="overflow-auto flex-1 p-0">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E5E7EB]">
                      <th className="px-5 py-3 text-[12px] font-medium text-[#616161] bg-[#FAFAFA]">Project Name</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#616161] bg-[#FAFAFA]">Status</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#616161] bg-[#FAFAFA]">Value</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#616161] bg-[#FAFAFA]">Superintendent</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-[#616161] bg-[#FAFAFA]">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: "Downtown Office Plaza", status: "Active", val: "$4.2M", supt: "Sarah Jenkins", prog: 68, state: "active" },
                      { name: "Westside High School", status: "In Progress", val: "$12.8M", supt: "Marcus Row", prog: 34, state: "progress" },
                      { name: "Riverfront Condos", status: "Active", val: "$8.5M", supt: "David Chen", prog: 82, state: "active" },
                      { name: "Oak Street Logistics", status: "Pending", val: "$2.1M", supt: "Unassigned", prog: 0, state: "pending" },
                      { name: "City Hospital Annex", status: "In Progress", val: "$15.4M", supt: "Elena Rodriguez", prog: 45, state: "progress" },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-[#E5E7EB] hover:bg-[#F9FAFB] transition-colors group">
                        <td className="px-5 py-3.5">
                          <p className="text-[14px] font-medium text-[#242424] group-hover:text-[#0078D4] transition-colors cursor-pointer">{row.name}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                            row.state === 'active' ? 'bg-[#DFF6DD] text-[#107C10] border-[#C1EFC1]' : 
                            row.state === 'progress' ? 'bg-[#E6F2FA] text-[#0078D4] border-[#CCE4F5]' : 
                            'bg-[#FFF4CE] text-[#797775] border-[#FDE79C]'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-[13px] text-[#242424]">{row.val}</td>
                        <td className="px-5 py-3.5 text-[13px] text-[#616161]">{row.supt}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-full h-[4px] bg-[#EBEBEB] rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-[#0078D4] rounded-full" 
                                style={{ width: `${row.prog}%` }}
                              />
                            </div>
                            <span className="text-[12px] text-[#616161] w-8">{row.prog}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Panel (1 col) */}
            <div className="col-span-1 space-y-6 flex flex-col">
              
              {/* Upcoming Deadlines */}
              <div className="bg-[#FFFFFF] border border-[#E5E7EB] rounded-[8px] shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex-1 flex flex-col">
                <div className="px-5 py-4 border-b border-[#E5E7EB] shrink-0">
                  <h2 className="text-[15px] font-semibold text-[#242424]">Upcoming Deadlines</h2>
                </div>
                <div className="p-2 flex-1 overflow-auto">
                  {[
                    { title: "Concrete Pour - Sector A", project: "Downtown Office Plaza", date: "Today", overdue: false },
                    { title: "City Inspections", project: "Riverfront Condos", date: "Tomorrow", overdue: false },
                    { title: "HVAC Rough-in Complete", project: "Westside High School", date: "Oct 12", overdue: false },
                    { title: "RFI #42 Response Due", project: "City Hospital Annex", date: "Oct 14", overdue: false },
                    { title: "Permit Renewal", project: "Oak Street Logistics", date: "Oct 18", overdue: false },
                  ].map((item, i) => (
                    <div key={i} className="px-3 py-3 hover:bg-[#F9FAFB] rounded-md transition-colors border-b border-transparent hover:border-[#E5E7EB] last:border-0 group cursor-pointer flex gap-3">
                      <div className="mt-0.5 shrink-0 text-[#0078D4]">
                        <Calendar className="w-4 h-4" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[#242424] truncate group-hover:text-[#0078D4] transition-colors">{item.title}</p>
                        <p className="text-[12px] text-[#616161] truncate mt-0.5">{item.project}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`text-[12px] ${item.date === 'Today' ? 'text-[#D13438] font-medium' : 'text-[#616161]'}`}>
                          {item.date}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-[#FFFFFF] border border-[#E5E7EB] rounded-[8px] shadow-[0_1px_3px_rgba(0,0,0,0.02)] shrink-0">
                <div className="px-5 py-4 border-b border-[#E5E7EB]">
                  <h2 className="text-[15px] font-semibold text-[#242424]">Quick Actions</h2>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3">
                  <button className="flex flex-col items-center justify-center p-3 border border-[#E5E7EB] rounded-[6px] hover:border-[#0078D4] hover:bg-[#F5F9FD] transition-colors group">
                    <Plus className="w-5 h-5 text-[#0078D4] mb-2" />
                    <span className="text-[12px] font-medium text-[#242424] group-hover:text-[#0078D4]">New Project</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-3 border border-[#E5E7EB] rounded-[6px] hover:border-[#0078D4] hover:bg-[#F5F9FD] transition-colors group">
                    <FileText className="w-5 h-5 text-[#0078D4] mb-2" />
                    <span className="text-[12px] font-medium text-[#242424] group-hover:text-[#0078D4]">Create Bid</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}

export default FluentClean;