import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function RectangleTab() {
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");

  const results = useMemo(() => {
    const l = parseFloat(length);
    const w = parseFloat(width);
    if (!l || !w || l <= 0 || w <= 0) return null;
    const area = l * w;
    const perimeter = 2 * (l + w);
    const diagonal = Math.sqrt(l * l + w * w);
    return {
      area: area.toFixed(2),
      perimeter: perimeter.toFixed(2),
      diagonal: diagonal.toFixed(4),
    };
  }, [length, width]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="rect-length">Length</Label>
          <Input
            id="rect-length"
            data-testid="input-rect-length"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 10"
            value={length}
            onChange={(e) => setLength(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rect-width">Width</Label>
          <Input
            id="rect-width"
            data-testid="input-rect-width"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 8"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </div>
      </div>
      {results && (
        <div className="space-y-3" data-testid="rect-results">
          <h3 className="font-semibold text-sm">Results</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Area</span>
              <Badge variant="secondary" data-testid="result-rect-area">{results.area}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Perimeter</span>
              <Badge variant="secondary" data-testid="result-rect-perimeter">{results.perimeter}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Diagonal</span>
              <Badge data-testid="result-rect-diagonal">{results.diagonal}</Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TriangleTab() {
  const [mode, setMode] = useState("right");
  const [base, setBase] = useState("");
  const [height, setHeight] = useState("");
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
  const [sideC, setSideC] = useState("");

  const results = useMemo(() => {
    if (mode === "right") {
      const b = parseFloat(base);
      const h = parseFloat(height);
      if (!b || !h || b <= 0 || h <= 0) return null;
      const area = 0.5 * b * h;
      const hypotenuse = Math.sqrt(b * b + h * h);
      return {
        area: area.toFixed(2),
        hypotenuse: hypotenuse.toFixed(4),
        perimeter: (b + h + hypotenuse).toFixed(2),
      };
    } else {
      const a = parseFloat(sideA);
      const b = parseFloat(sideB);
      const c = parseFloat(sideC);
      if (!a || !b || !c || a <= 0 || b <= 0 || c <= 0) return null;
      if (a + b <= c || a + c <= b || b + c <= a) return null;
      const s = (a + b + c) / 2;
      const area = Math.sqrt(s * (s - a) * (s - b) * (s - c));
      const perimeter = a + b + c;
      return {
        area: area.toFixed(2),
        perimeter: perimeter.toFixed(2),
        semiperimeter: s.toFixed(2),
      };
    }
  }, [mode, base, height, sideA, sideB, sideC]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="tri-mode">Triangle Mode</Label>
        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger id="tri-mode" data-testid="select-tri-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="right">Right Triangle (two sides)</SelectItem>
            <SelectItem value="heron">Any Triangle (three sides)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "right" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tri-base">Base</Label>
            <Input
              id="tri-base"
              data-testid="input-tri-base"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 6"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tri-height">Height</Label>
            <Input
              id="tri-height"
              data-testid="input-tri-height"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 8"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tri-side-a">Side A</Label>
            <Input
              id="tri-side-a"
              data-testid="input-tri-side-a"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 5"
              value={sideA}
              onChange={(e) => setSideA(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tri-side-b">Side B</Label>
            <Input
              id="tri-side-b"
              data-testid="input-tri-side-b"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 7"
              value={sideB}
              onChange={(e) => setSideB(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tri-side-c">Side C</Label>
            <Input
              id="tri-side-c"
              data-testid="input-tri-side-c"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 9"
              value={sideC}
              onChange={(e) => setSideC(e.target.value)}
            />
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-3" data-testid="tri-results">
          <h3 className="font-semibold text-sm">Results</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Area</span>
              <Badge variant="secondary" data-testid="result-tri-area">{results.area}</Badge>
            </div>
            {mode === "right" && "hypotenuse" in results && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Hypotenuse</span>
                <Badge data-testid="result-tri-hypotenuse">{results.hypotenuse}</Badge>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Perimeter</span>
              <Badge variant="secondary" data-testid="result-tri-perimeter">{results.perimeter}</Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CircleTab() {
  const [radius, setRadius] = useState("");
  const [diameter, setDiameter] = useState("");
  const [lastEdited, setLastEdited] = useState<"radius" | "diameter">("radius");

  const handleRadiusChange = (val: string) => {
    setRadius(val);
    setLastEdited("radius");
    const r = parseFloat(val);
    if (!isNaN(r) && r > 0) {
      setDiameter((r * 2).toString());
    } else {
      setDiameter("");
    }
  };

  const handleDiameterChange = (val: string) => {
    setDiameter(val);
    setLastEdited("diameter");
    const d = parseFloat(val);
    if (!isNaN(d) && d > 0) {
      setRadius((d / 2).toString());
    } else {
      setRadius("");
    }
  };

  const results = useMemo(() => {
    const r = parseFloat(radius);
    if (!r || r <= 0) return null;
    const area = Math.PI * r * r;
    const circumference = 2 * Math.PI * r;
    return {
      area: area.toFixed(4),
      circumference: circumference.toFixed(4),
    };
  }, [radius]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="circle-radius">Radius</Label>
          <Input
            id="circle-radius"
            data-testid="input-circle-radius"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 5"
            value={radius}
            onChange={(e) => handleRadiusChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="circle-diameter">Diameter</Label>
          <Input
            id="circle-diameter"
            data-testid="input-circle-diameter"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 10"
            value={diameter}
            onChange={(e) => handleDiameterChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Auto-calculated from {lastEdited === "radius" ? "radius" : "diameter"}</p>
        </div>
      </div>
      {results && (
        <div className="space-y-3" data-testid="circle-results">
          <h3 className="font-semibold text-sm">Results</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Area</span>
              <Badge variant="secondary" data-testid="result-circle-area">{results.area}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Circumference</span>
              <Badge data-testid="result-circle-circumference">{results.circumference}</Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SlopeTab() {
  const [rise, setRise] = useState("");
  const [run, setRun] = useState("");

  const results = useMemo(() => {
    const ri = parseFloat(rise);
    const ru = parseFloat(run);
    if (!ri || !ru || ri <= 0 || ru <= 0) return null;
    const angleRad = Math.atan(ri / ru);
    const angleDeg = (angleRad * 180) / Math.PI;
    const grade = (ri / ru) * 100;
    const slopeLength = Math.sqrt(ri * ri + ru * ru);
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(Math.round(ri * 100), Math.round(ru * 100));
    const ratioRise = Math.round(ri * 100) / g;
    const ratioRun = Math.round(ru * 100) / g;
    return {
      angle: angleDeg.toFixed(2),
      grade: grade.toFixed(2),
      slopeRatio: `${ratioRise}:${ratioRun}`,
      slopeLength: slopeLength.toFixed(4),
    };
  }, [rise, run]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="slope-rise">Rise (ft)</Label>
          <Input
            id="slope-rise"
            data-testid="input-slope-rise"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 3"
            value={rise}
            onChange={(e) => setRise(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slope-run">Run (ft)</Label>
          <Input
            id="slope-run"
            data-testid="input-slope-run"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 12"
            value={run}
            onChange={(e) => setRun(e.target.value)}
          />
        </div>
      </div>
      {results && (
        <div className="space-y-3" data-testid="slope-results">
          <h3 className="font-semibold text-sm">Results</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Slope Angle</span>
              <Badge variant="secondary" data-testid="result-slope-angle">{results.angle} deg</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Grade</span>
              <Badge variant="secondary" data-testid="result-slope-grade">{results.grade}%</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Slope Ratio</span>
              <Badge variant="secondary" data-testid="result-slope-ratio">{results.slopeRatio}</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">Slope Length</span>
              <Badge data-testid="result-slope-length">{results.slopeLength} ft</Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GeometryCalculator() {
  return (
    <Card data-testid="calculator-geometry">
      <CardHeader>
        <CardTitle>Geometry Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate areas, volumes, angles, and geometric conversions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="rectangle" data-testid="geometry-tabs">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="rectangle" data-testid="tab-rectangle">Rectangle</TabsTrigger>
            <TabsTrigger value="triangle" data-testid="tab-triangle">Triangle</TabsTrigger>
            <TabsTrigger value="circle" data-testid="tab-circle">Circle</TabsTrigger>
            <TabsTrigger value="slope" data-testid="tab-slope">Slope</TabsTrigger>
          </TabsList>
          <TabsContent value="rectangle">
            <RectangleTab />
          </TabsContent>
          <TabsContent value="triangle">
            <TriangleTab />
          </TabsContent>
          <TabsContent value="circle">
            <CircleTab />
          </TabsContent>
          <TabsContent value="slope">
            <SlopeTab />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
