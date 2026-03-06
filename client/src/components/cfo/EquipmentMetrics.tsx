import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck, Clock, Package, AlertCircle, Wrench, DollarSign, TrendingUp } from "lucide-react";
import type { EquipmentMetricsData } from "./types";

interface EquipmentMetricsProps {
  equipmentMetrics: EquipmentMetricsData | undefined;
  isLoading: boolean;
  formatCurrency: (amount: number) => string;
  onEquipmentClick: () => void;
}

export function EquipmentMetrics({ equipmentMetrics, isLoading, formatCurrency, onEquipmentClick }: EquipmentMetricsProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold flex items-center gap-2 mt-[15px] mb-[15px]">
        <Truck className="h-6 w-6" />
        Equipment Metrics
      </h2>
      
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : equipmentMetrics && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card data-testid="card-owned-equipment">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-500" />
                  Owned Fleet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{equipmentMetrics.summary.total_owned_equipment}</div>
                <p className="text-xs text-muted-foreground mt-1">pieces of equipment</p>
              </CardContent>
            </Card>

            <Card data-testid="card-active-rentals">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-green-500" />
                  Active Rentals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{equipmentMetrics.summary.active_rentals}</div>
                <p className="text-xs text-muted-foreground mt-1">currently rented</p>
              </CardContent>
            </Card>

            <Card data-testid="card-rental-cost-mtd">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Rental Spend MTD
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(equipmentMetrics.summary.total_rental_cost_mtd)}</div>
                <p className="text-xs text-muted-foreground mt-1">month to date</p>
              </CardContent>
            </Card>

            <Card data-testid="card-underutilized">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  Underutilized
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{equipmentMetrics.summary.underutilized_count}</div>
                <p className="text-xs text-muted-foreground mt-1">idle &gt;60 days</p>
              </CardContent>
            </Card>
          </div>

          {equipmentMetrics.underutilized.length > 0 && (
            <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" data-testid="card-underutilized-alert">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                  Underutilized Equipment - Consider Redeployment
                </CardTitle>
                <CardDescription>
                  These owned assets have been idle for over 60 days. Consider redeploying to active projects or evaluating disposal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {equipmentMetrics.underutilized.slice(0, 5).map((item, idx) => (
                    <div 
                      key={idx}
                      onClick={onEquipmentClick}
                      className="flex items-center justify-between p-2 bg-background rounded-md cursor-pointer hover-elevate active-elevate-2"
                      data-testid={`underutilized-${item.equipment_code}`}
                    >
                      <div>
                        <span className="font-medium text-sm">{item.equipment_code}</span>
                        <span className="text-sm text-muted-foreground ml-2">- {item.equipment_name}</span>
                        <p className="text-xs text-muted-foreground">
                          Idle {item.days_since_last_assignment} days | Carrying cost: {formatCurrency(item.monthly_carrying_cost)}/mo
                        </p>
                      </div>
                      <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">
                        {formatCurrency(item.purchase_price)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {equipmentMetrics.frequently_rented.length > 0 && (
            <Card data-testid="card-frequently-rented">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-primary" />
                  Frequently Rented Equipment - Purchase Analysis
                </CardTitle>
                <CardDescription>
                  Equipment types with high rental frequency. Evaluate purchase vs. continued rental based on projected ROI.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {equipmentMetrics.frequently_rented.map((item, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between p-3 bg-muted rounded-md"
                      data-testid={`frequently-rented-${idx}`}
                    >
                      <div className="flex-1">
                        <span className="font-medium text-sm">{item.equipment_type}</span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.rental_count} rentals | {Math.round(item.avg_rental_duration_days)} avg days | Total: {formatCurrency(item.total_rental_cost)}
                        </p>
                        <p className="text-xs mt-1">
                          {item.recommendation.startsWith('REVIEW') ? (
                            <span className="text-red-600 dark:text-red-400">{item.recommendation}</span>
                          ) : item.recommendation.startsWith('MONITOR') ? (
                            <span className="text-yellow-600 dark:text-yellow-400">{item.recommendation}</span>
                          ) : (
                            <span className="text-muted-foreground">{item.recommendation}</span>
                          )}
                        </p>
                      </div>
                      {item.recommendation.startsWith('REVIEW') && (
                        <Badge variant="destructive">Review</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {equipmentMetrics.rental_vs_owned.length > 0 && (
            <Card data-testid="card-rental-vs-owned">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500" />
                  Rental vs Owned Rate Comparison
                </CardTitle>
                <CardDescription>
                  Compare daily rental rates vs owned equipment operating costs. Break-even assumes daily usage.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {equipmentMetrics.rental_vs_owned.slice(0, 5).map((item, idx) => (
                    <div 
                      key={idx}
                      className="flex items-center justify-between p-3 bg-muted rounded-md"
                      data-testid={`rental-vs-owned-${idx}`}
                    >
                      <div className="flex-1">
                        <span className="font-medium text-sm">{item.equipment_type}</span>
                        <p className="text-xs text-muted-foreground mt-1">
                          Rental: {formatCurrency(item.avg_rental_daily_rate)}/day | Owned: {formatCurrency(item.avg_owned_daily_rate)}/day
                          {item.break_even_days > 0 && ` | Break-even: ${item.break_even_days} days`}
                        </p>
                        <p className="text-xs mt-1">
                          {item.recommendation.startsWith('EVALUATE') ? (
                            <span className="text-green-600 dark:text-green-400">{item.recommendation}</span>
                          ) : item.recommendation.startsWith('MONITOR') ? (
                            <span className="text-yellow-600 dark:text-yellow-400">{item.recommendation}</span>
                          ) : item.recommendation.startsWith('RENT') ? (
                            <span className="text-blue-600 dark:text-blue-400">{item.recommendation}</span>
                          ) : (
                            <span className="text-muted-foreground">{item.recommendation}</span>
                          )}
                        </p>
                      </div>
                      {item.daily_savings > 0 && (
                        <Badge className="bg-green-500 hover:bg-green-600">
                          {formatCurrency(item.daily_savings)}/day savings
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {equipmentMetrics.last_updated && (
            <p className="text-xs text-muted-foreground text-right">
              Equipment data from AI analysis: {new Date(equipmentMetrics.last_updated).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
