import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LaborCostEstimator() {
  const [hourlyRate, setHourlyRate] = useState("");
  const [numWorkers, setNumWorkers] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("");
  const [numDays, setNumDays] = useState("");
  const [overtimeHoursPerDay, setOvertimeHoursPerDay] = useState("");
  const [burdenRate, setBurdenRate] = useState(35);

  const parseNum = (val: string) => {
    const n = parseFloat(val);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  const rate = parseNum(hourlyRate);
  const workers = parseNum(numWorkers);
  const hpd = parseNum(hoursPerDay);
  const days = parseNum(numDays);
  const otHpd = parseNum(overtimeHoursPerDay);

  const regularHoursTotal = workers * hpd * days;
  const regularCost = regularHoursTotal * rate;
  const overtimeHoursTotal = workers * otHpd * days;
  const overtimeCost = overtimeHoursTotal * rate * 1.5;
  const subtotalLabor = regularCost + overtimeCost;
  const burdenCost = subtotalLabor * (burdenRate / 100);
  const totalLaborCost = subtotalLabor + burdenCost;
  const costPerDay = days > 0 ? totalLaborCost / days : 0;
  const costPerWorkerPerDay = days > 0 && workers > 0 ? totalLaborCost / days / workers : 0;

  const hasInputs = rate > 0 && workers > 0 && hpd > 0 && days > 0;

  return (
    <Card data-testid="calculator-labor-cost">
      <CardHeader>
        <CardTitle>Labor Cost Estimator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate total labor costs including regular time, overtime, and burden/benefits
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lc-hourly-rate">Hourly Rate ($)</Label>
              <Input
                id="lc-hourly-rate"
                data-testid="input-hourly-rate"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-num-workers">Number of Workers</Label>
              <Input
                id="lc-num-workers"
                data-testid="input-num-workers"
                type="number"
                min={0}
                step={1}
                placeholder="0"
                value={numWorkers}
                onChange={(e) => setNumWorkers(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-hours-per-day">Hours per Day</Label>
              <Input
                id="lc-hours-per-day"
                data-testid="input-hours-per-day"
                type="number"
                min={0}
                step="0.5"
                placeholder="8"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-num-days">Number of Days</Label>
              <Input
                id="lc-num-days"
                data-testid="input-num-days"
                type="number"
                min={0}
                step={1}
                placeholder="0"
                value={numDays}
                onChange={(e) => setNumDays(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lc-overtime-hours">Overtime Hours per Day <span className="text-muted-foreground text-xs">(optional, 1.5x rate)</span></Label>
              <Input
                id="lc-overtime-hours"
                data-testid="input-overtime-hours"
                type="number"
                min={0}
                step="0.5"
                placeholder="0"
                value={overtimeHoursPerDay}
                onChange={(e) => setOvertimeHoursPerDay(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <Label>Benefits / Burden Rate</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  step={0.5}
                  value={burdenRate}
                  onChange={(e) => {
                    const v = Math.min(60, Math.max(0, Number(e.target.value)));
                    setBurdenRate(v);
                  }}
                  className="w-20 text-right"
                  data-testid="input-burden-rate"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <Slider
              value={[burdenRate]}
              onValueChange={(v) => setBurdenRate(v[0])}
              min={0}
              max={60}
              step={0.5}
              className="w-full"
              data-testid="slider-burden-rate"
            />
          </div>

          {hasInputs && (
            <Card data-testid="results-summary">
              <CardHeader>
                <CardTitle className="text-lg">Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Regular Hours Total</span>
                    <Badge variant="secondary" data-testid="result-regular-hours">
                      {regularHoursTotal.toLocaleString()} hrs
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Regular Cost</span>
                    <Badge variant="secondary" data-testid="result-regular-cost">
                      ${formatCurrency(regularCost)}
                    </Badge>
                  </div>
                  {overtimeHoursTotal > 0 && (
                    <>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-muted-foreground text-sm">Overtime Hours Total</span>
                        <Badge variant="secondary" data-testid="result-overtime-hours">
                          {overtimeHoursTotal.toLocaleString()} hrs
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <span className="text-muted-foreground text-sm">Overtime Cost (1.5x)</span>
                        <Badge variant="secondary" data-testid="result-overtime-cost">
                          ${formatCurrency(overtimeCost)}
                        </Badge>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">Subtotal Labor</span>
                    <Badge variant="outline" data-testid="result-subtotal-labor">
                      ${formatCurrency(subtotalLabor)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Burden Cost ({burdenRate}%)</span>
                    <Badge variant="secondary" data-testid="result-burden-cost">
                      ${formatCurrency(burdenCost)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">Total Labor Cost</span>
                    <Badge data-testid="result-total-labor-cost">
                      ${formatCurrency(totalLaborCost)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Cost Per Day</span>
                    <Badge variant="outline" data-testid="result-cost-per-day">
                      ${formatCurrency(costPerDay)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Cost Per Worker Per Day</span>
                    <Badge variant="outline" data-testid="result-cost-per-worker-per-day">
                      ${formatCurrency(costPerWorkerPerDay)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
