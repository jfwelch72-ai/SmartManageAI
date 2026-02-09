import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export default function PaintCalculator() {
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("8");
  const [includeCeiling, setIncludeCeiling] = useState("no");
  const [coats, setCoats] = useState("2");
  const [coverage, setCoverage] = useState("400");
  const [doors, setDoors] = useState("1");
  const [windows, setWindows] = useState("2");
  const [pricePerGallon, setPricePerGallon] = useState("");

  const results = useMemo(() => {
    const l = parseFloat(length);
    const w = parseFloat(width);
    const h = parseFloat(height);
    const numCoats = parseInt(coats);
    const cov = parseInt(coverage);
    const numDoors = parseInt(doors) || 0;
    const numWindows = parseInt(windows) || 0;
    const price = parseFloat(pricePerGallon);

    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0) return null;

    const wallArea = 2 * (l + w) * h;
    const ceilingArea = includeCeiling === "yes" ? l * w : 0;
    const openings = numDoors * 21 + numWindows * 12;
    const paintableAreaPerCoat = wallArea + ceilingArea - openings;

    if (paintableAreaPerCoat <= 0) return null;

    const totalPaintableArea = paintableAreaPerCoat * numCoats;
    const gallonsPerCoat = Math.ceil(paintableAreaPerCoat / cov);
    const totalGallons = Math.ceil(totalPaintableArea / cov);
    const costEstimate = !isNaN(price) && price > 0 ? totalGallons * price : null;

    return {
      paintableAreaPerCoat: paintableAreaPerCoat.toFixed(2),
      totalPaintableArea: totalPaintableArea.toFixed(2),
      gallonsPerCoat,
      totalGallons,
      costEstimate: costEstimate !== null ? costEstimate.toFixed(2) : null,
    };
  }, [length, width, height, includeCeiling, coats, coverage, doors, windows, pricePerGallon]);

  return (
    <Card data-testid="calculator-paint">
      <CardHeader>
        <CardTitle>Paint & Coating Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate paint coverage, gallons needed, and coating costs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="paint-length">Room Length (ft)</Label>
            <Input
              id="paint-length"
              data-testid="input-paint-length"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 12"
              value={length}
              onChange={(e) => setLength(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-width">Room Width (ft)</Label>
            <Input
              id="paint-width"
              data-testid="input-paint-width"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 10"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-height">Wall Height (ft)</Label>
            <Input
              id="paint-height"
              data-testid="input-paint-height"
              type="number"
              min="0"
              step="0.1"
              placeholder="e.g. 8"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-ceiling">Include Ceiling</Label>
            <Select value={includeCeiling} onValueChange={setIncludeCeiling}>
              <SelectTrigger id="paint-ceiling" data-testid="select-paint-ceiling">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="yes">Yes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-coats">Number of Coats</Label>
            <Select value={coats} onValueChange={setCoats}>
              <SelectTrigger id="paint-coats" data-testid="select-paint-coats">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 Coat</SelectItem>
                <SelectItem value="2">2 Coats</SelectItem>
                <SelectItem value="3">3 Coats</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-coverage">Coverage (sq ft/gallon)</Label>
            <Select value={coverage} onValueChange={setCoverage}>
              <SelectTrigger id="paint-coverage" data-testid="select-paint-coverage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="350">350 sq ft/gal</SelectItem>
                <SelectItem value="400">400 sq ft/gal</SelectItem>
                <SelectItem value="450">450 sq ft/gal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-doors">Number of Doors</Label>
            <Input
              id="paint-doors"
              data-testid="input-paint-doors"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 1"
              value={doors}
              onChange={(e) => setDoors(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">21 sq ft each</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-windows">Number of Windows</Label>
            <Input
              id="paint-windows"
              data-testid="input-paint-windows"
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 2"
              value={windows}
              onChange={(e) => setWindows(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">12 sq ft each</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paint-price">Price per Gallon ($)</Label>
            <Input
              id="paint-price"
              data-testid="input-paint-price"
              type="number"
              min="0"
              step="0.01"
              placeholder="Optional"
              value={pricePerGallon}
              onChange={(e) => setPricePerGallon(e.target.value)}
            />
          </div>
        </div>

        {results && (
          <div className="mt-6 space-y-3" data-testid="paint-results">
            <h3 className="font-semibold text-sm">Results</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Paintable Area (per coat)</span>
                <Badge variant="secondary" data-testid="result-paint-area-per-coat">
                  {results.paintableAreaPerCoat} sq ft
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Total Paintable Area</span>
                <Badge variant="secondary" data-testid="result-paint-total-area">
                  {results.totalPaintableArea} sq ft
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Gallons per Coat</span>
                <Badge variant="secondary" data-testid="result-paint-gallons-per-coat">
                  {results.gallonsPerCoat} gal
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Total Gallons ({coats} coat{parseInt(coats) > 1 ? "s" : ""})</span>
                <Badge data-testid="result-paint-total-gallons">
                  {results.totalGallons} gal
                </Badge>
              </div>
              {results.costEstimate && (
                <div className="flex items-center justify-between gap-2 sm:col-span-2">
                  <span className="text-sm text-muted-foreground">Estimated Cost</span>
                  <Badge data-testid="result-paint-cost">
                    ${results.costEstimate}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
