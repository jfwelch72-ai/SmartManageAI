import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const SHEET_SIZES: Record<string, { length: number; area: number }> = {
  "4x8": { length: 8, area: 32 },
  "4x10": { length: 10, area: 40 },
  "4x12": { length: 12, area: 48 },
};

export default function DrywallCalculator() {
  const [roomLength, setRoomLength] = useState("");
  const [roomWidth, setRoomWidth] = useState("");
  const [wallHeight, setWallHeight] = useState("8");
  const [includeCeiling, setIncludeCeiling] = useState("yes");
  const [sheetSize, setSheetSize] = useState("4x8");
  const [numDoors, setNumDoors] = useState("1");
  const [numWindows, setNumWindows] = useState("2");
  const [wasteFactor, setWasteFactor] = useState("10");
  const [pricePerSheet, setPricePerSheet] = useState("");

  const results = useMemo(() => {
    const length = parseFloat(roomLength);
    const width = parseFloat(roomWidth);
    const height = parseFloat(wallHeight);
    if (isNaN(length) || isNaN(width) || isNaN(height) || length <= 0 || width <= 0 || height <= 0) return null;

    const perimeter = 2 * (length + width);
    const wallArea = perimeter * height;

    const ceilingArea = includeCeiling === "yes" ? length * width : 0;

    const doors = parseInt(numDoors, 10);
    const windows = parseInt(numWindows, 10);
    const doorArea = (!isNaN(doors) && doors > 0 ? doors : 0) * 21;
    const windowArea = (!isNaN(windows) && windows > 0 ? windows : 0) * 12;
    const openingsArea = doorArea + windowArea;

    const netArea = Math.max(wallArea + ceilingArea - openingsArea, 0);

    const sheet = SHEET_SIZES[sheetSize] ?? SHEET_SIZES["4x8"];
    const sheetArea = sheet.area;

    const waste = parseFloat(wasteFactor);
    const wasteMultiplier = !isNaN(waste) && waste >= 0 ? 1 + waste / 100 : 1.1;

    const sheetsNeeded = Math.ceil((netArea / sheetArea) * wasteMultiplier);

    const jointCompoundGallons = Math.ceil(netArea / 100);
    const jointTapeRolls = Math.ceil(netArea / 1000);
    const screwCount = Math.ceil(netArea);
    const screwLbs = Math.ceil(screwCount / 158);

    const pps = parseFloat(pricePerSheet);
    const costEstimate = !isNaN(pps) && pps > 0 ? sheetsNeeded * pps : null;

    return {
      wallArea,
      ceilingArea,
      openingsArea,
      netArea,
      sheetsNeeded,
      jointCompoundGallons,
      jointTapeRolls,
      screwCount,
      screwLbs,
      costEstimate,
    };
  }, [roomLength, roomWidth, wallHeight, includeCeiling, sheetSize, numDoors, numWindows, wasteFactor, pricePerSheet]);

  return (
    <Card data-testid="calculator-drywall">
      <CardHeader>
        <CardTitle>Drywall Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Estimate drywall sheets, joint compound, and tape requirements
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="drywall-room-length">Room Length (ft)</Label>
              <Input
                id="drywall-room-length"
                data-testid="input-drywall-room-length"
                type="number"
                min={0}
                placeholder="0"
                value={roomLength}
                onChange={(e) => setRoomLength(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drywall-room-width">Room Width (ft)</Label>
              <Input
                id="drywall-room-width"
                data-testid="input-drywall-room-width"
                type="number"
                min={0}
                placeholder="0"
                value={roomWidth}
                onChange={(e) => setRoomWidth(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drywall-wall-height">Wall Height (ft)</Label>
              <Input
                id="drywall-wall-height"
                data-testid="input-drywall-wall-height"
                type="number"
                min={0}
                placeholder="8"
                value={wallHeight}
                onChange={(e) => setWallHeight(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Include Ceiling</Label>
              <Select value={includeCeiling} onValueChange={setIncludeCeiling} data-testid="select-include-ceiling">
                <SelectTrigger data-testid="select-trigger-include-ceiling">
                  <SelectValue placeholder="Include ceiling?" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes" data-testid="select-item-ceiling-yes">Yes</SelectItem>
                  <SelectItem value="no" data-testid="select-item-ceiling-no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Sheet Size</Label>
              <Select value={sheetSize} onValueChange={setSheetSize} data-testid="select-sheet-size">
                <SelectTrigger data-testid="select-trigger-sheet-size">
                  <SelectValue placeholder="Select sheet size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4x8" data-testid="select-item-4x8">4' x 8'</SelectItem>
                  <SelectItem value="4x10" data-testid="select-item-4x10">4' x 10'</SelectItem>
                  <SelectItem value="4x12" data-testid="select-item-4x12">4' x 12'</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="drywall-waste-factor">Waste Factor (%)</Label>
              <Input
                id="drywall-waste-factor"
                data-testid="input-drywall-waste-factor"
                type="number"
                min={0}
                max={50}
                value={wasteFactor}
                onChange={(e) => setWasteFactor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="drywall-num-doors">Number of Doors</Label>
              <Input
                id="drywall-num-doors"
                data-testid="input-drywall-num-doors"
                type="number"
                min={0}
                placeholder="1"
                value={numDoors}
                onChange={(e) => setNumDoors(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">3' x 7' = 21 sq ft each</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="drywall-num-windows">Number of Windows</Label>
              <Input
                id="drywall-num-windows"
                data-testid="input-drywall-num-windows"
                type="number"
                min={0}
                placeholder="2"
                value={numWindows}
                onChange={(e) => setNumWindows(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">3' x 4' = 12 sq ft each</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="drywall-price-per-sheet">Price per Sheet ($)</Label>
              <Input
                id="drywall-price-per-sheet"
                data-testid="input-drywall-price-per-sheet"
                type="number"
                min={0}
                step="0.01"
                placeholder="Optional"
                value={pricePerSheet}
                onChange={(e) => setPricePerSheet(e.target.value)}
              />
            </div>
          </div>

          {results && (
            <Card data-testid="drywall-results-summary">
              <CardHeader>
                <CardTitle className="text-lg">Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Wall Area</span>
                    <Badge variant="secondary" data-testid="result-drywall-wall-area">
                      {results.wallArea.toFixed(2)} sq ft
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Ceiling Area</span>
                    <Badge variant="secondary" data-testid="result-drywall-ceiling-area">
                      {results.ceilingArea.toFixed(2)} sq ft
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Openings Deducted</span>
                    <Badge variant="secondary" data-testid="result-drywall-openings-area">
                      {results.openingsArea.toFixed(2)} sq ft
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">Net Area</span>
                    <Badge data-testid="result-drywall-net-area">
                      {results.netArea.toFixed(2)} sq ft
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">Sheets Needed (with {wasteFactor}% waste)</span>
                    <Badge data-testid="result-drywall-sheets-needed">
                      {results.sheetsNeeded}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Joint Compound</span>
                    <Badge variant="outline" data-testid="result-drywall-joint-compound">
                      {results.jointCompoundGallons} gallon{results.jointCompoundGallons !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Joint Tape</span>
                    <Badge variant="outline" data-testid="result-drywall-joint-tape">
                      {results.jointTapeRolls} roll{results.jointTapeRolls !== 1 ? "s" : ""} (500 ft each)
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Screws</span>
                    <Badge variant="outline" data-testid="result-drywall-screws">
                      {results.screwCount} (~{results.screwLbs} lb{results.screwLbs !== 1 ? "s" : ""})
                    </Badge>
                  </div>
                  {results.costEstimate !== null && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-sm font-medium">Estimated Cost</span>
                      <Badge data-testid="result-drywall-cost-estimate">
                        ${results.costEstimate.toFixed(2)}
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
