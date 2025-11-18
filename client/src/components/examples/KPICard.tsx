import KPICard from '../KPICard';
import { Briefcase, Clock, DollarSign, Users } from 'lucide-react';

export default function KPICardExample() {
  return (
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
  );
}
