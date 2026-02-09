import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeftRight } from "lucide-react";

interface UnitDef {
  label: string;
  value: string;
  factor: number;
}

const lengthUnits: UnitDef[] = [
  { label: "Feet", value: "feet", factor: 0.3048 },
  { label: "Inches", value: "inches", factor: 0.0254 },
  { label: "Yards", value: "yards", factor: 0.9144 },
  { label: "Miles", value: "miles", factor: 1609.344 },
  { label: "Meters", value: "meters", factor: 1 },
  { label: "Centimeters", value: "centimeters", factor: 0.01 },
  { label: "Millimeters", value: "millimeters", factor: 0.001 },
];

const areaUnits: UnitDef[] = [
  { label: "sq ft", value: "sq_ft", factor: 0.09290304 },
  { label: "sq in", value: "sq_in", factor: 0.00064516 },
  { label: "sq yd", value: "sq_yd", factor: 0.83612736 },
  { label: "sq m", value: "sq_m", factor: 1 },
  { label: "sq cm", value: "sq_cm", factor: 0.0001 },
  { label: "Acres", value: "acres", factor: 4046.8564224 },
  { label: "Hectares", value: "hectares", factor: 10000 },
];

const volumeUnits: UnitDef[] = [
  { label: "cubic ft", value: "cubic_ft", factor: 0.028316846592 },
  { label: "cubic in", value: "cubic_in", factor: 0.000016387064 },
  { label: "cubic yd", value: "cubic_yd", factor: 0.764554857984 },
  { label: "cubic m", value: "cubic_m", factor: 1 },
  { label: "Gallons", value: "gallons", factor: 0.003785411784 },
  { label: "Liters", value: "liters", factor: 0.001 },
];

function formatResult(value: number): string {
  const formatted = value.toFixed(4);
  return parseFloat(formatted).toString();
}

function convert(inputValue: string, fromUnit: string, toUnit: string, units: UnitDef[]): string {
  const num = parseFloat(inputValue);
  if (isNaN(num) || inputValue.trim() === "") return "";
  const from = units.find((u) => u.value === fromUnit);
  const to = units.find((u) => u.value === toUnit);
  if (!from || !to) return "";
  const result = num * (from.factor / to.factor);
  return formatResult(result);
}

interface ConverterTabProps {
  units: UnitDef[];
  tabKey: string;
  inputValue: string;
  fromUnit: string;
  toUnit: string;
  onInputChange: (val: string) => void;
  onFromChange: (val: string) => void;
  onToChange: (val: string) => void;
  onSwap: () => void;
}

function ConverterTab({ units, tabKey, inputValue, fromUnit, toUnit, onInputChange, onFromChange, onToChange, onSwap }: ConverterTabProps) {
  const result = convert(inputValue, fromUnit, toUnit, units);
  const fromLabel = units.find((u) => u.value === fromUnit)?.label ?? "";
  const toLabel = units.find((u) => u.value === toUnit)?.label ?? "";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${tabKey}-input`}>Value</Label>
          <Input
            id={`${tabKey}-input`}
            data-testid={`input-${tabKey}-value`}
            type="number"
            placeholder="Enter value"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
          />
        </div>

        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex flex-col gap-2 flex-1 min-w-[140px]">
            <Label>From</Label>
            <Select value={fromUnit} onValueChange={onFromChange}>
              <SelectTrigger data-testid={`select-${tabKey}-from`}>
                <SelectValue placeholder="Select unit" />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.value} value={u.value} data-testid={`select-${tabKey}-from-${u.value}`}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            size="icon"
            variant="outline"
            onClick={onSwap}
            data-testid={`button-${tabKey}-swap`}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>

          <div className="flex flex-col gap-2 flex-1 min-w-[140px]">
            <Label>To</Label>
            <Select value={toUnit} onValueChange={onToChange}>
              <SelectTrigger data-testid={`select-${tabKey}-to`}>
                <SelectValue placeholder="Select unit" />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.value} value={u.value} data-testid={`select-${tabKey}-to-${u.value}`}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-md border p-4" data-testid={`result-${tabKey}`}>
        {result !== "" ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Result</span>
            <span className="text-2xl font-semibold">
              {result} {toLabel}
            </span>
            <span className="text-sm text-muted-foreground">
              {inputValue} {fromLabel} = {result} {toLabel}
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            Enter a value to see the conversion result
          </span>
        )}
      </div>
    </div>
  );
}

export default function UnitConverter() {
  const [lengthInput, setLengthInput] = useState("");
  const [lengthFrom, setLengthFrom] = useState("feet");
  const [lengthTo, setLengthTo] = useState("meters");

  const [areaInput, setAreaInput] = useState("");
  const [areaFrom, setAreaFrom] = useState("sq_ft");
  const [areaTo, setAreaTo] = useState("sq_m");

  const [volumeInput, setVolumeInput] = useState("");
  const [volumeFrom, setVolumeFrom] = useState("cubic_ft");
  const [volumeTo, setVolumeTo] = useState("cubic_m");

  return (
    <Card data-testid="calculator-unit-converter">
      <CardHeader>
        <CardTitle>Unit Converter</CardTitle>
        <CardDescription className="text-muted-foreground">
          Convert between common construction units of measurement
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="length" data-testid="tabs-unit-converter">
          <TabsList className="w-full" data-testid="tabs-list-unit-converter">
            <TabsTrigger value="length" className="flex-1" data-testid="tab-length">
              Length
            </TabsTrigger>
            <TabsTrigger value="area" className="flex-1" data-testid="tab-area">
              Area
            </TabsTrigger>
            <TabsTrigger value="volume" className="flex-1" data-testid="tab-volume">
              Volume
            </TabsTrigger>
          </TabsList>

          <TabsContent value="length">
            <ConverterTab
              units={lengthUnits}
              tabKey="length"
              inputValue={lengthInput}
              fromUnit={lengthFrom}
              toUnit={lengthTo}
              onInputChange={setLengthInput}
              onFromChange={setLengthFrom}
              onToChange={setLengthTo}
              onSwap={() => {
                setLengthFrom(lengthTo);
                setLengthTo(lengthFrom);
              }}
            />
          </TabsContent>

          <TabsContent value="area">
            <ConverterTab
              units={areaUnits}
              tabKey="area"
              inputValue={areaInput}
              fromUnit={areaFrom}
              toUnit={areaTo}
              onInputChange={setAreaInput}
              onFromChange={setAreaFrom}
              onToChange={setAreaTo}
              onSwap={() => {
                setAreaFrom(areaTo);
                setAreaTo(areaFrom);
              }}
            />
          </TabsContent>

          <TabsContent value="volume">
            <ConverterTab
              units={volumeUnits}
              tabKey="volume"
              inputValue={volumeInput}
              fromUnit={volumeFrom}
              toUnit={volumeTo}
              onInputChange={setVolumeInput}
              onFromChange={setVolumeFrom}
              onToChange={setVolumeTo}
              onSwap={() => {
                setVolumeFrom(volumeTo);
                setVolumeTo(volumeFrom);
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
