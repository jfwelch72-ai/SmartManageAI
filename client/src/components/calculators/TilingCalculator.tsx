import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const TILE_SIZES: Record<string, { w: number; h: number }> = {
  "4x4": { w: 4, h: 4 },
  "6x6": { w: 6, h: 6 },
  "12x12": { w: 12, h: 12 },
  "12x24": { w: 12, h: 24 },
  "18x18": { w: 18, h: 18 },
  "24x24": { w: 24, h: 24 },
};

const GROUT_WIDTHS: Record<string, number> = {
  "1/16": 1 / 16,
  "1/8": 1 / 8,
  "3/16": 3 / 16,
  "1/4": 1 / 4,
};

export default function TilingCalculator() {
  const [areaLength, setAreaLength] = useState("");
  const [areaWidth, setAreaWidth] = useState("");
  const [tileSize, setTileSize] = useState("12x12");
  const [customTileW, setCustomTileW] = useState("");
  const [customTileH, setCustomTileH] = useState("");
  const [groutWidth, setGroutWidth] = useState("1/8");
  const [pattern, setPattern] = useState("grid");
  const [wasteFactor, setWasteFactor] = useState("10");
  const [pricePerTile, setPricePerTile] = useState("");
  const [pricePerBox, setPricePerBox] = useState("");
  const [tilesPerBox, setTilesPerBox] = useState("");

  const isCustom = tileSize === "custom";

  const results = useMemo(() => {
    const length = parseFloat(areaLength);
    const width = parseFloat(areaWidth);
    if (isNaN(length) || isNaN(width) || length <= 0 || width <= 0) return null;

    let tileW: number;
    let tileH: number;
    if (isCustom) {
      tileW = parseFloat(customTileW);
      tileH = parseFloat(customTileH);
      if (isNaN(tileW) || isNaN(tileH) || tileW <= 0 || tileH <= 0) return null;
    } else {
      const size = TILE_SIZES[tileSize];
      tileW = size.w;
      tileH = size.h;
    }

    const grout = GROUT_WIDTHS[groutWidth] ?? 0.125;
    const totalArea = length * width;

    const effectiveW = tileW + grout;
    const effectiveH = tileH + grout;
    let tilesPerSqFt = 144 / (effectiveW * effectiveH);

    if (pattern === "diagonal") {
      tilesPerSqFt *= 1.15;
    }

    const waste = parseFloat(wasteFactor);
    const wasteMultiplier = !isNaN(waste) && waste >= 0 ? 1 + waste / 100 : 1.1;

    const totalTiles = Math.ceil(totalArea * tilesPerSqFt * wasteMultiplier);

    const tpb = parseInt(tilesPerBox, 10);
    const boxesNeeded = !isNaN(tpb) && tpb > 0 ? Math.ceil(totalTiles / tpb) : null;

    const isSmallTile = tileW <= 6 && tileH <= 6;
    const groutLbs = isSmallTile
      ? totalArea * (1 / 10)
      : totalArea * (0.5 / 10);

    const ppt = parseFloat(pricePerTile);
    const ppb = parseFloat(pricePerBox);
    let costEstimate: number | null = null;
    if (!isNaN(ppt) && ppt > 0) {
      costEstimate = totalTiles * ppt;
    } else if (!isNaN(ppb) && ppb > 0 && boxesNeeded !== null) {
      costEstimate = boxesNeeded * ppb;
    }

    return {
      totalArea,
      tilesPerSqFt,
      totalTiles,
      boxesNeeded,
      groutLbs: Math.ceil(groutLbs),
      costEstimate,
    };
  }, [areaLength, areaWidth, tileSize, customTileW, customTileH, groutWidth, pattern, wasteFactor, pricePerTile, pricePerBox, tilesPerBox, isCustom]);

  const handlePatternChange = (val: string) => {
    setPattern(val);
    if (val === "diagonal") {
      setWasteFactor("15");
    } else {
      setWasteFactor("10");
    }
  };

  return (
    <Card data-testid="calculator-tiling">
      <CardHeader>
        <CardTitle>Tiling & Flooring Calculator</CardTitle>
        <CardDescription className="text-muted-foreground">
          Calculate tile counts, grout, and flooring coverage
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tiling-area-length">Area Length (ft)</Label>
              <Input
                id="tiling-area-length"
                data-testid="input-tiling-area-length"
                type="number"
                min={0}
                placeholder="0"
                value={areaLength}
                onChange={(e) => setAreaLength(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tiling-area-width">Area Width (ft)</Label>
              <Input
                id="tiling-area-width"
                data-testid="input-tiling-area-width"
                type="number"
                min={0}
                placeholder="0"
                value={areaWidth}
                onChange={(e) => setAreaWidth(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tile Size</Label>
              <Select value={tileSize} onValueChange={setTileSize} data-testid="select-tile-size">
                <SelectTrigger data-testid="select-trigger-tile-size">
                  <SelectValue placeholder="Select tile size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4x4" data-testid="select-item-4x4">4" x 4"</SelectItem>
                  <SelectItem value="6x6" data-testid="select-item-6x6">6" x 6"</SelectItem>
                  <SelectItem value="12x12" data-testid="select-item-12x12">12" x 12"</SelectItem>
                  <SelectItem value="12x24" data-testid="select-item-12x24">12" x 24"</SelectItem>
                  <SelectItem value="18x18" data-testid="select-item-18x18">18" x 18"</SelectItem>
                  <SelectItem value="24x24" data-testid="select-item-24x24">24" x 24"</SelectItem>
                  <SelectItem value="custom" data-testid="select-item-custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Grout Joint Width</Label>
              <Select value={groutWidth} onValueChange={setGroutWidth} data-testid="select-grout-width">
                <SelectTrigger data-testid="select-trigger-grout-width">
                  <SelectValue placeholder="Select grout width" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1/16" data-testid="select-item-grout-1-16">1/16"</SelectItem>
                  <SelectItem value="1/8" data-testid="select-item-grout-1-8">1/8"</SelectItem>
                  <SelectItem value="3/16" data-testid="select-item-grout-3-16">3/16"</SelectItem>
                  <SelectItem value="1/4" data-testid="select-item-grout-1-4">1/4"</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {isCustom && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="custom-tile-w">Tile Width (inches)</Label>
                <Input
                  id="custom-tile-w"
                  data-testid="input-custom-tile-width"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={customTileW}
                  onChange={(e) => setCustomTileW(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-tile-h">Tile Height (inches)</Label>
                <Input
                  id="custom-tile-h"
                  data-testid="input-custom-tile-height"
                  type="number"
                  min={0}
                  placeholder="0"
                  value={customTileH}
                  onChange={(e) => setCustomTileH(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pattern</Label>
              <Select value={pattern} onValueChange={handlePatternChange} data-testid="select-pattern">
                <SelectTrigger data-testid="select-trigger-pattern">
                  <SelectValue placeholder="Select pattern" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grid" data-testid="select-item-grid">Standard Grid</SelectItem>
                  <SelectItem value="brick" data-testid="select-item-brick">Brick / Offset</SelectItem>
                  <SelectItem value="diagonal" data-testid="select-item-diagonal">Diagonal (45 degrees)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tiling-waste-factor">Waste Factor (%)</Label>
              <Input
                id="tiling-waste-factor"
                data-testid="input-tiling-waste-factor"
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
              <Label htmlFor="tiling-price-per-tile">Price per Tile ($)</Label>
              <Input
                id="tiling-price-per-tile"
                data-testid="input-price-per-tile"
                type="number"
                min={0}
                step="0.01"
                placeholder="Optional"
                value={pricePerTile}
                onChange={(e) => setPricePerTile(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tiling-price-per-box">Price per Box ($)</Label>
              <Input
                id="tiling-price-per-box"
                data-testid="input-price-per-box"
                type="number"
                min={0}
                step="0.01"
                placeholder="Optional"
                value={pricePerBox}
                onChange={(e) => setPricePerBox(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tiling-tiles-per-box">Tiles per Box</Label>
              <Input
                id="tiling-tiles-per-box"
                data-testid="input-tiles-per-box"
                type="number"
                min={1}
                placeholder="Optional"
                value={tilesPerBox}
                onChange={(e) => setTilesPerBox(e.target.value)}
              />
            </div>
          </div>

          {results && (
            <Card data-testid="tiling-results-summary">
              <CardHeader>
                <CardTitle className="text-lg">Results</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Total Area</span>
                    <Badge variant="secondary" data-testid="result-tiling-total-area">
                      {results.totalArea.toFixed(2)} sq ft
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Tiles per sq ft</span>
                    <Badge variant="secondary" data-testid="result-tiling-tiles-per-sqft">
                      {results.tilesPerSqFt.toFixed(2)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-sm font-medium">Tiles Needed (with {wasteFactor}% waste)</span>
                    <Badge data-testid="result-tiling-total-tiles">
                      {results.totalTiles}
                    </Badge>
                  </div>
                  {results.boxesNeeded !== null && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-muted-foreground text-sm">Boxes Needed</span>
                      <Badge variant="outline" data-testid="result-tiling-boxes-needed">
                        {results.boxesNeeded}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-muted-foreground text-sm">Grout Estimate</span>
                    <Badge variant="outline" data-testid="result-tiling-grout-lbs">
                      {results.groutLbs} lbs
                    </Badge>
                  </div>
                  {results.costEstimate !== null && (
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className="text-sm font-medium">Estimated Cost</span>
                      <Badge data-testid="result-tiling-cost-estimate">
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
