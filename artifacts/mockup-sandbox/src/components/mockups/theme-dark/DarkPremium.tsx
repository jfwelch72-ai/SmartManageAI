import React, { useState } from "react";
import { 
  LayoutDashboard, 
  Briefcase, 
  Users, 
  DollarSign, 
  HardHat, 
  ShieldAlert, 
  Search, 
  Bell, 
  Menu,
  MoreVertical,
  ChevronDown,
  Building2,
  TrendingUp,
  TrendingDown,
  Clock,
  Plus,
  FileText,
  AlertCircle
} from "lucide-react";

export function DarkPremium() {
  const [activeTab, setActiveTab] = useState("Home");

  const navItems = [
    { name: "Home", icon: LayoutDashboard },
    { name: "Sales", icon: DollarSign },
    { name: "Projects", icon: Briefcase },
    { name: "Workforce", icon: Users },
    { name: "Finance", icon: TrendingUp },
    { name: "Field Ops", icon: HardHat },
    { name: "Safety", icon: ShieldAlert },
  ];

  const kpis = [
    { title: "Active Projects", value: "24", change: "+12%", isPositive: true, icon: Briefcase },
    { title: "Open Bids", value: "$2.4M", change: "+5%", isPositive: true, icon: FileText },
    { title: "Crew Members", value: "187", change: "-2%", isPositive: false, icon: Users },
    { title: "Revenue YTD", value: "$8.1M", change: "+18%", isPositive: true, icon: DollarSign },
  ];

  const projects = [
    { name: "Skyline Tower Core", status: "Active", value: "$4.2M", supt: "Sarah Jenkins", progress: 68 },
    { name: "Metro Station Phase 2", status: "In Progress", value: "$1.8M", supt: "Mike Chen", progress: 42 },
    { name: "Riverside Bridge Repair", status: "Active", value: "$3.5M", supt: "Dave Roberts", progress: 85 },
    { name: "General Hospital Annex", status: "Delayed", value: "$6.1M", supt: "Lisa Patel", progress: 30 },
    { name: "Downtown Plaza Retail", status: "In Progress", value: "$950K", supt: "Tom Wilson", progress: 15 },
  ];

  const deadlines = [
    { task: "Permit Renewal: Metro Station", date: "Tomorrow, 5:00 PM" },
    { task: "Safety Inspection: Skyline", date: "Oct 24, 8:00 AM" },
    { task: "Concrete Pour: Riverside", date: "Oct 25, 6:00 AM" },
    { task: "Client Review: Hospital Annex", date: "Oct 26, 2:00 PM" }
  ];

  return (
    <div 
      className="w-full h-full flex overflow-hidden font-sans text-[#FFFFFF]" 
      style={{ backgroundColor: "#0F0F11", width: "1280px", height: "800px" }}
    >
      {/* Sidebar */}
      <aside 
        className="w-[220px] flex-shrink-0 flex flex-col border-r border-[#2A2A2E] z-10 relative"
        style={{ 
          background: "linear-gradient(180deg, #1F1F23 0%, #18181B 15%, #18181B 100%)"
        }}
      >
        <div className="h-16 flex items-center px-6 border-b border-[#2A2A2E]">
          <div className="flex items-center gap-2 text-[#F59E0B] font-bold text-lg tracking-tight">
            <Building2 size={24} />
            <span className="text-white">SmartManage<span className="text-[#F59E0B]">AI</span></span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-1">
          <div className="px-3 mb-2 text-xs font-semibold text-[#A1A1AA] uppercase tracking-wider">
            Menu
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.name;
            return (
              <button
                key={item.name}
                onClick={() => setActiveTab(item.name)}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-200 relative ${
                  isActive 
                    ? "text-[#F59E0B] bg-[#F59E0B]/10 font-medium" 
                    : "text-[#A1A1AA] hover:text-white hover:bg-[#2A2A2E]/50"
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#F59E0B] rounded-r-full" />
                )}
                <Icon size={18} className={isActive ? "text-[#F59E0B]" : "text-[#A1A1AA]"} />
                {item.name}
              </button>
            );
          })}
        </div>
        
        <div className="p-4 border-t border-[#2A2A2E]">
          <div className="flex items-center gap-3 bg-[#1C1C1F] p-2 rounded-lg border border-[#2A2A2E]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F59E0B] to-[#D97706] flex items-center justify-center text-sm font-bold text-white shadow-inner">
              JD
            </div>
            <div className="flex flex-col text-left flex-1 overflow-hidden">
              <span className="text-sm font-medium truncate">John Doe</span>
              <span className="text-xs text-[#A1A1AA] truncate">Project Manager</span>
            </div>
            <ChevronDown size={14} className="text-[#A1A1AA]" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Header */}
        <header className="h-16 flex-shrink-0 border-b border-[#2A2A2E] bg-[#0F0F11]/80 backdrop-blur-md flex items-center justify-between px-8 z-10 sticky top-0">
          <div className="flex items-center">
            <h1 className="text-xl font-semibold tracking-tight">Dashboard Overview</h1>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#A1A1AA] group-focus-within:text-[#F59E0B] transition-colors" size={16} />
              <input 
                type="text" 
                placeholder="Search projects, bids..." 
                className="bg-[#1C1C1F] border border-[#2A2A2E] text-sm text-white placeholder-[#A1A1AA] rounded-full py-1.5 pl-9 pr-4 w-64 focus:outline-none focus:border-[#F59E0B]/50 focus:ring-1 focus:ring-[#F59E0B]/20 transition-all"
              />
            </div>
            
            <button className="relative text-[#A1A1AA] hover:text-white transition-colors">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#F59E0B] rounded-full border border-[#0F0F11]"></span>
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* KPIs */}
          <div className="grid grid-cols-4 gap-6 mb-8">
            {kpis.map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <div 
                  key={i} 
                  className="bg-[#1C1C1F] border border-[#2A2A2E] rounded-[10px] p-5 relative overflow-hidden group hover:border-[#3A3A3E] transition-colors"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <span className="text-[#A1A1AA] text-sm font-medium">{kpi.title}</span>
                    <div className="w-8 h-8 rounded-md bg-[#F59E0B]/10 flex items-center justify-center border border-[#F59E0B]/20">
                      <Icon size={16} className="text-[#F59E0B]" />
                    </div>
                  </div>
                  
                  <div className="flex items-baseline gap-3 relative z-10">
                    <span className="text-3xl font-bold tracking-tight">{kpi.value}</span>
                    <div className={`flex items-center text-xs font-medium ${kpi.isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                      {kpi.isPositive ? <TrendingUp size={12} className="mr-1" /> : <TrendingDown size={12} className="mr-1" />}
                      {kpi.change}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Main Table Area */}
            <div className="col-span-2 flex flex-col gap-6">
              <div className="bg-[#1C1C1F] border border-[#2A2A2E] rounded-[10px] overflow-hidden flex flex-col">
                <div className="p-5 border-b border-[#2A2A2E] flex justify-between items-center">
                  <h2 className="text-base font-semibold">Recent Projects</h2>
                  <button className="text-xs text-[#F59E0B] font-medium hover:text-[#D97706] transition-colors">
                    View All
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-[#A1A1AA] uppercase bg-[#18181B] border-b border-[#2A2A2E]">
                      <tr>
                        <th className="px-5 py-3 font-medium">Project Name</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 font-medium">Value</th>
                        <th className="px-5 py-3 font-medium">Superintendent</th>
                        <th className="px-5 py-3 font-medium">Progress</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2A2A2E]">
                      {projects.map((project, i) => (
                        <tr key={i} className="hover:bg-[#222225] transition-colors group">
                          <td className="px-5 py-4 font-medium text-white">{project.name}</td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border
                              ${project.status === 'Active' ? 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10' : 
                                project.status === 'In Progress' ? 'text-[#F59E0B] border-[#F59E0B]/20 bg-[#F59E0B]/10' : 
                                'text-red-400 border-red-400/20 bg-red-400/10'}`}
                            >
                              {project.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-[#A1A1AA] font-mono text-xs">{project.value}</td>
                          <td className="px-5 py-4 text-[#A1A1AA]">{project.supt}</td>
                          <td className="px-5 py-4 w-32">
                            <div className="flex items-center gap-3">
                              <div className="w-full h-1.5 bg-[#2A2A2E] rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-[#F59E0B] rounded-full relative" 
                                  style={{ width: `${project.progress}%` }}
                                >
                                  <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_2s_infinite]" />
                                </div>
                              </div>
                              <span className="text-xs text-[#A1A1AA] w-6">{project.progress}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Right Sidebar Area */}
            <div className="col-span-1 flex flex-col gap-6">
              {/* Quick Actions */}
              <div className="bg-[#1C1C1F] border border-[#2A2A2E] rounded-[10px] p-5">
                <h2 className="text-base font-semibold mb-4">Quick Actions</h2>
                <div className="grid grid-cols-2 gap-3">
                  <button className="flex flex-col items-center justify-center p-3 rounded-lg border border-[#2A2A2E] bg-[#18181B] hover:border-[#F59E0B]/50 hover:bg-[#F59E0B]/5 transition-all group">
                    <div className="w-8 h-8 rounded-full bg-[#2A2A2E] flex items-center justify-center mb-2 group-hover:bg-[#F59E0B] group-hover:text-white transition-colors text-[#A1A1AA]">
                      <Plus size={16} />
                    </div>
                    <span className="text-xs font-medium text-[#A1A1AA] group-hover:text-white">New Project</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-3 rounded-lg border border-[#2A2A2E] bg-[#18181B] hover:border-[#F59E0B]/50 hover:bg-[#F59E0B]/5 transition-all group">
                    <div className="w-8 h-8 rounded-full bg-[#2A2A2E] flex items-center justify-center mb-2 group-hover:bg-[#F59E0B] group-hover:text-white transition-colors text-[#A1A1AA]">
                      <FileText size={16} />
                    </div>
                    <span className="text-xs font-medium text-[#A1A1AA] group-hover:text-white">Create Bid</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-3 rounded-lg border border-[#2A2A2E] bg-[#18181B] hover:border-[#F59E0B]/50 hover:bg-[#F59E0B]/5 transition-all group">
                    <div className="w-8 h-8 rounded-full bg-[#2A2A2E] flex items-center justify-center mb-2 group-hover:bg-[#F59E0B] group-hover:text-white transition-colors text-[#A1A1AA]">
                      <Users size={16} />
                    </div>
                    <span className="text-xs font-medium text-[#A1A1AA] group-hover:text-white">Add Crew</span>
                  </button>
                  <button className="flex flex-col items-center justify-center p-3 rounded-lg border border-[#2A2A2E] bg-[#18181B] hover:border-[#F59E0B]/50 hover:bg-[#F59E0B]/5 transition-all group">
                    <div className="w-8 h-8 rounded-full bg-[#2A2A2E] flex items-center justify-center mb-2 group-hover:bg-[#F59E0B] group-hover:text-white transition-colors text-[#A1A1AA]">
                      <AlertCircle size={16} />
                    </div>
                    <span className="text-xs font-medium text-[#A1A1AA] group-hover:text-white">Report Issue</span>
                  </button>
                </div>
              </div>

              {/* Deadlines */}
              <div className="bg-[#1C1C1F] border border-[#2A2A2E] rounded-[10px] p-5 flex-1">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-base font-semibold">Upcoming Deadlines</h2>
                  <button className="p-1 text-[#A1A1AA] hover:text-white transition-colors">
                    <MoreVertical size={16} />
                  </button>
                </div>
                
                <div className="flex flex-col gap-4">
                  {deadlines.map((item, i) => (
                    <div key={i} className="flex gap-3 items-start group">
                      <div className="mt-0.5">
                        <div className="w-2 h-2 rounded-full bg-[#F59E0B] ring-4 ring-[#F59E0B]/10"></div>
                      </div>
                      <div className="flex-1 border-b border-[#2A2A2E] pb-4 group-last:border-0 group-last:pb-0">
                        <p className="text-sm font-medium text-white mb-1 group-hover:text-[#F59E0B] transition-colors">{item.task}</p>
                        <div className="flex items-center text-xs text-[#A1A1AA] gap-1.5">
                          <Clock size={12} />
                          {item.date}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <button className="w-full mt-6 py-2 rounded-md border border-[#2A2A2E] text-sm font-medium text-[#A1A1AA] hover:text-white hover:bg-[#2A2A2E]/50 transition-colors">
                  View Schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
