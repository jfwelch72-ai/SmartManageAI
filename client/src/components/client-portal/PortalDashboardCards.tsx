import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Timer, CheckCircle2, DollarSign, TrendingUp } from "lucide-react";

interface PortalDashboardCardsProps {
  progress?: Array<{
    description: string;
    status: string;
    completionPercentage: number | null;
    updatedAt: string | null;
  }>;
  project: {
    endDate: string | null;
    startDate: string | null;
  };
  payments?: Array<{
    total: string;
    status: string;
  }>;
  showPayments: boolean;
  showProgress: boolean;
}

function AnimatedRadialGauge({ percentage }: { percentage: number }) {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedValue(percentage), 100);
    return () => clearTimeout(timer);
  }, [percentage]);

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (animatedValue / 100) * circumference;

  const getColor = (pct: number) => {
    if (pct >= 75) return "hsl(142, 71%, 45%)";
    if (pct >= 50) return "hsl(48, 96%, 53%)";
    if (pct >= 25) return "hsl(25, 95%, 53%)";
    return "hsl(0, 84%, 60%)";
  };

  return (
    <div className="relative w-24 h-24 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          className="text-muted/30"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke={getColor(animatedValue)}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold" data-testid="text-completion-percentage">
          {Math.round(animatedValue)}%
        </span>
      </div>
    </div>
  );
}

export function PortalDashboardCards({ progress, project, payments, showPayments, showProgress }: PortalDashboardCardsProps) {
  const totalItems = progress?.length || 0;
  const completedItems = progress?.filter((p) => p.status === "COMPLETED").length || 0;
  const overallCompletion = totalItems > 0
    ? Math.round(
        (progress?.reduce((sum, p) => sum + (p.completionPercentage || 0), 0) || 0) / totalItems
      )
    : 0;

  const daysRemaining = project.endDate
    ? Math.max(0, Math.ceil((new Date(project.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const outstandingBalance = payments
    ?.filter((p) => p.status === "SENT" || p.status === "OVERDUE")
    .reduce((sum, p) => sum + parseFloat(p.total || "0"), 0) ?? 0;

  const fmtCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

  const cards = [];

  if (showProgress) {
    cards.push(
      <Card key="completion" className="overflow-hidden">
        <CardContent className="pt-4 pb-4 text-center">
          <AnimatedRadialGauge percentage={overallCompletion} />
          <p className="text-sm font-medium mt-2">Overall Completion</p>
          <p className="text-xs text-muted-foreground">Project progress</p>
        </CardContent>
      </Card>
    );
  }

  cards.push(
    <Card key="days">
      <CardContent className="pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-500/10">
            <Timer className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p className="text-2xl font-bold" data-testid="text-days-remaining">
              {daysRemaining !== null ? daysRemaining : "—"}
            </p>
            <p className="text-sm text-muted-foreground">Days Remaining</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (showProgress) {
    cards.push(
      <Card key="scope">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-green-500/10">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-scope-completed">
                {completedItems}
                <span className="text-sm font-normal text-muted-foreground"> / {totalItems}</span>
              </p>
              <p className="text-sm text-muted-foreground">Scope Items Complete</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (showPayments) {
    cards.push(
      <Card key="balance">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-orange-500/10">
              <DollarSign className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="text-outstanding-balance">
                {fmtCurrency(outstandingBalance)}
              </p>
              <p className="text-sm text-muted-foreground">Outstanding Balance</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  } else if (showProgress) {
    cards.push(
      <Card key="in-progress">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-purple-500/10">
              <TrendingUp className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold" data-testid="text-in-progress-count">
                {progress?.filter((p) => p.status === "IN_PROGRESS").length || 0}
              </p>
              <p className="text-sm text-muted-foreground">In Progress</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (cards.length === 0) return null;

  const gridCols = cards.length <= 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4";

  return (
    <div className={`grid ${gridCols} gap-4`} data-testid="dashboard-summary-cards">
      {cards}
    </div>
  );
}
