import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

const JOIST_DEPTHS: Record<string, number> = {
  "2x6": 5.5,
  "2x8": 7.25,
  "2x10": 9.25,
  "2x12": 11.25,
};

export default function LumberCalculator() {
  const [activeTab, setActiveTab] = useState("studs");

  const [wallLength, setWallLength] = useState<string>("20");
  const [wallHeight, setWallHeight] = useState<string>("8");
  const [studSpacing, setStudSpacing] = useState<string>("16");
  const [cornerCount, setCornerCount] = useState<string>("4");
  const [openingCount, setOpeningCount] = useState<string>("0");

  const [spanLength, setSpanLength] = useState<string>("20");
  const [joistSpacing, setJoistSpacing] = useState<string>("16");
  const [joistSize, setJoistSize] = useState<string>("2x8");

  const [bfThickness, setBfThickness] = useState<string>("1");
  const [bfWidth, setBfWidth] = useState<string>("6");
  const [bfLength, setBfLength] = useState<string>("8");
  const [bfQuantity, setBfQuantity] = useState<string>("1");

  const [wasteFactor, setWasteFactor] = useState<string>("10");
  const [unitPrice, setUnitPrice] = useState<string>("");

  const studResults = useMemo(() => {
    const len = parseFloat(wallLength) || 0;
    const h = parseFloat(wallHeight) || 0;
    const spacing = parseFloat(studSpacing) || 16;
    const corners = parseInt(cornerCount) || 0;
    const openings = parseInt(openingCount) || 0;
    const waste = (parseFloat(wasteFactor) || 0) / 100;

    const fieldStuds = Math.ceil((len * 12) / spacing) + 1;
    const extraCornerStuds = corners * 2;
    const extraOpeningStuds = openings * 2;
    const baseStuds = fieldStuds + extraCornerStuds + extraOpeningStuds;
    const totalStuds = Math.ceil(baseStuds * (1 + waste));

    const plateLength = 3 * len;
    const totalLinearFt = totalStuds * h + plateLength;

    return { totalStuds, plateLength, totalLinearFt };
  }, [wallLength, wallHeight, studSpacing, cornerCount, openingCount, wasteFactor]);

  const joistResults = useMemo(() => {
    const span = parseFloat(spanLength) || 0;
    const spacing = parseFloat(joistSpacing) || 16;
    const waste = (parseFloat(wasteFactor) || 0) / 100;
    const depth = JOIST_DEPTHS[joistSize] || 7.25;

    const baseJoists = Math.ceil((span * 12) / spacing) + 1;
    const totalJoists = Math.ceil(baseJoists * (1 + waste));
    const rimBoardLength = span * 2;
    const totalBoardFeet = (totalJoists * 1.5 * depth * span) / 12 + (2 * 1.5 * depth * span) / 12;

    return { totalJoists, rimBoardLength, totalBoardFeet: Math.round(totalBoardFeet * 100) / 100 };
  }, [spanLength, joistSpacing, joistSize, wasteFactor]);

  const boardFeetResults = useMemo(() => {
    const t = parseFloat(bfThickness) || 0;
    const w = parseFloat(bfWidth) || 0;
    const l = parseFloat(bfLength) || 0;
    const q = parseInt(bfQuantity) || 0;
    const waste = (parseFloat(wasteFactor) || 0) / 100;

    const baseBF = (t * w * l * q) / 12;
    const totalBF = baseBF * (1 + waste);
    return { totalBoardFeet: Math.round(totalBF * 100) / 100 };
  }, [bfThickness, bfWidth, bfLength, bfQuantity, wasteFactor]);

  const costEstimate = useMemo(() => {
    const price = parseFloat(unitPrice);
    if (!price || price <= 0) return null;

    if (activeTab === "studs") return Math.round(studResults.totalStuds * price * 100) / 100;
    if (activeTab === "joists") return Math.round(joistResults.totalJoists * price * 100) / 100;
    if (activeTab === "boardfeet") return Math.round(boardFeetResults.totalBoardFeet * price * 100) / 100;
    return null;
  }, [activeTab, unitPrice, studResults, joistResults, boardFeetResults]);

  return (
    <Card data-testid="calculator-lumber">
      <CardHeader>
        <CardTitle>Lumber & Framing Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate board feet, stud counts, and framing materials
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4 flex-wrap" data-testid="lumber-tabs">
            <TabsTrigger value="studs" data-testid="tab-studs">Stud Calculator</TabsTrigger>
            <TabsTrigger value="joists" data-testid="tab-joists">Joist / Rafter</TabsTrigger>
            <TabsTrigger value="boardfeet" data-testid="tab-boardfeet">Board Feet</TabsTrigger>
          </TabsList>

          <TabsContent value="studs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stud-wall-length">Wall Length (ft)</Label>
                <Input
                  id="stud-wall-length"
                  data-testid="input-wall-length"
                  type="number"
                  min="0"
                  value={wallLength}
                  onChange={(e) => setWallLength(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stud-wall-height">Wall Height (ft)</Label>
                <Input
                  id="stud-wall-height"
                  data-testid="input-wall-height"
                  type="number"
                  min="0"
                  value={wallHeight}
                  onChange={(e) => setWallHeight(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stud-spacing">Stud Spacing</Label>
                <Select value={studSpacing} onValueChange={setStudSpacing}>
                  <SelectTrigger id="stud-spacing" data-testid="select-stud-spacing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12" O.C.</SelectItem>
                    <SelectItem value="16">16" O.C.</SelectItem>
                    <SelectItem value="24">24" O.C.</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stud-corners">Corner Count</Label>
                <Input
                  id="stud-corners"
                  data-testid="input-corner-count"
                  type="number"
                  min="0"
                  value={cornerCount}
                  onChange={(e) => setCornerCount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stud-openings">Number of Openings</Label>
                <Input
                  id="stud-openings"
                  data-testid="input-opening-count"
                  type="number"
                  min="0"
                  value={openingCount}
                  onChange={(e) => setOpeningCount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">King + trimmer studs per opening</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="font-semibold text-sm">Results</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Total Studs Needed</p>
                  <p className="text-lg font-semibold" data-testid="result-total-studs">{studResults.totalStuds}</p>
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Plates (linear ft)</p>
                  <p className="text-lg font-semibold" data-testid="result-plate-length">{studResults.plateLength.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">Top double + bottom single</p>
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Total Linear Feet</p>
                  <p className="text-lg font-semibold" data-testid="result-total-linear-ft">{studResults.totalLinearFt.toFixed(1)}</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="joists">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="joist-span">Span Length (ft)</Label>
                <Input
                  id="joist-span"
                  data-testid="input-span-length"
                  type="number"
                  min="0"
                  value={spanLength}
                  onChange={(e) => setSpanLength(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="joist-spacing">Joist Spacing</Label>
                <Select value={joistSpacing} onValueChange={setJoistSpacing}>
                  <SelectTrigger id="joist-spacing" data-testid="select-joist-spacing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12" O.C.</SelectItem>
                    <SelectItem value="16">16" O.C.</SelectItem>
                    <SelectItem value="24">24" O.C.</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="joist-size">Joist Size</Label>
                <Select value={joistSize} onValueChange={setJoistSize}>
                  <SelectTrigger id="joist-size" data-testid="select-joist-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2x6">2x6</SelectItem>
                    <SelectItem value="2x8">2x8</SelectItem>
                    <SelectItem value="2x10">2x10</SelectItem>
                    <SelectItem value="2x12">2x12</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="font-semibold text-sm">Results</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Number of Joists</p>
                  <p className="text-lg font-semibold" data-testid="result-total-joists">{joistResults.totalJoists}</p>
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Rim / Band Board (linear ft)</p>
                  <p className="text-lg font-semibold" data-testid="result-rim-board">{joistResults.rimBoardLength.toFixed(1)}</p>
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Total Board Feet</p>
                  <p className="text-lg font-semibold" data-testid="result-joist-board-feet">{joistResults.totalBoardFeet}</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="boardfeet">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bf-thickness">Thickness (inches)</Label>
                <Input
                  id="bf-thickness"
                  data-testid="input-bf-thickness"
                  type="number"
                  min="0"
                  step="0.25"
                  value={bfThickness}
                  onChange={(e) => setBfThickness(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bf-width">Width (inches)</Label>
                <Input
                  id="bf-width"
                  data-testid="input-bf-width"
                  type="number"
                  min="0"
                  step="0.25"
                  value={bfWidth}
                  onChange={(e) => setBfWidth(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bf-length">Length (ft)</Label>
                <Input
                  id="bf-length"
                  data-testid="input-bf-length"
                  type="number"
                  min="0"
                  value={bfLength}
                  onChange={(e) => setBfLength(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bf-quantity">Quantity</Label>
                <Input
                  id="bf-quantity"
                  data-testid="input-bf-quantity"
                  type="number"
                  min="1"
                  value={bfQuantity}
                  onChange={(e) => setBfQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="font-semibold text-sm">Results</h4>
              <div className="rounded-md border p-3 space-y-1">
                <p className="text-xs text-muted-foreground">Total Board Feet</p>
                <p className="text-lg font-semibold" data-testid="result-total-board-feet">{boardFeetResults.totalBoardFeet}</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 border-t pt-4 space-y-4">
          <h4 className="font-semibold text-sm">Common Settings</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lumber-waste">Waste Factor (%)</Label>
              <Input
                id="lumber-waste"
                data-testid="input-lumber-waste"
                type="number"
                min="0"
                max="100"
                value={wasteFactor}
                onChange={(e) => setWasteFactor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lumber-price">Unit Price per Piece ($)</Label>
              <Input
                id="lumber-price"
                data-testid="input-lumber-unit-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="Optional"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
          </div>

          {costEstimate !== null && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground">Estimated Cost:</span>
              <Badge variant="secondary" data-testid="badge-lumber-cost">
                ${costEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Badge>
              <span className="text-xs text-muted-foreground">(includes {wasteFactor}% waste)</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
