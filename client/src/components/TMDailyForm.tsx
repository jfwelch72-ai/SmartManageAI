import { useState, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, ChevronDown, ChevronUp } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

interface TMDailyFormProps {
  projectName: string;
  onSubmit: (data: {
    date: string;
    tfrRepName: string;
    clientRepName: string;
    weather: string;
    descriptionOfWork: string;
    crewSize: number;
  }) => void;
}

export interface TMDailyFormRef {
  reset: () => void;
}

function MobileSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="md:hidden border rounded-lg overflow-hidden">
      <button
        type="button"
        className="flex items-center justify-between w-full p-3 min-h-[48px] text-sm font-medium text-left bg-muted/30 hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
        data-testid={`accordion-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        {title}
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>
      {open && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
}

const TMDailyForm = forwardRef<TMDailyFormRef, TMDailyFormProps>(({ projectName, onSubmit }, ref) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tfrRepName, setTfrRepName] = useState("");
  const [clientRepName, setClientRepName] = useState("");
  const [weather, setWeather] = useState("");
  const [descriptionOfWork, setDescriptionOfWork] = useState("");
  const [crewSize, setCrewSize] = useState("");

  useImperativeHandle(ref, () => ({
    reset: () => {
      setTfrRepName("");
      setClientRepName("");
      setWeather("");
      setDescriptionOfWork("");
      setCrewSize("");
    }
  }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      date,
      tfrRepName,
      clientRepName,
      weather,
      descriptionOfWork,
      crewSize: parseInt(crewSize) || 0,
    });
  };

  const dateField = (
    <div className="space-y-2">
      <Label htmlFor="date">Date</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            type="button"
            className={cn(
              "w-full justify-start text-left font-normal min-h-[44px]",
              !date && "text-muted-foreground"
            )}
            data-testid="input-tm-date"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(parseISO(date), "PPP") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarPicker
            mode="single"
            selected={date ? parseISO(date) : undefined}
            onSelect={(d) => d && setDate(format(d, "yyyy-MM-dd"))}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );

  const crewSizeField = (
    <div className="space-y-2">
      <Label htmlFor="crewSize">Crew Size</Label>
      <Input
        id="crewSize"
        type="number"
        min="1"
        placeholder="8"
        value={crewSize}
        onChange={(e) => setCrewSize(e.target.value)}
        required
        className="min-h-[44px]"
        data-testid="input-crew-size"
      />
    </div>
  );

  const companyRepField = (
    <div className="space-y-2">
      <Label htmlFor="tfrRepName">Company Representative</Label>
      <Input
        id="tfrRepName"
        placeholder="John Smith"
        value={tfrRepName}
        onChange={(e) => setTfrRepName(e.target.value)}
        required
        className="min-h-[44px]"
        data-testid="input-tfr-rep"
      />
    </div>
  );

  const clientRepField = (
    <div className="space-y-2">
      <Label htmlFor="clientRepName">Client Representative</Label>
      <Input
        id="clientRepName"
        placeholder="Jane Doe"
        value={clientRepName}
        onChange={(e) => setClientRepName(e.target.value)}
        className="min-h-[44px]"
        data-testid="input-client-rep"
      />
    </div>
  );

  const weatherField = (
    <div className="space-y-2">
      <Label htmlFor="weather">Weather Conditions</Label>
      <Input
        id="weather"
        placeholder="Sunny, 72°F"
        value={weather}
        onChange={(e) => setWeather(e.target.value)}
        className="min-h-[44px]"
        data-testid="input-weather"
      />
    </div>
  );

  const descriptionField = (
    <div className="space-y-2">
      <Label htmlFor="descriptionOfWork">Description of Work</Label>
      <Textarea
        id="descriptionOfWork"
        placeholder="Detail the work performed today..."
        value={descriptionOfWork}
        onChange={(e) => setDescriptionOfWork(e.target.value)}
        required
        className="min-h-32"
        data-testid="textarea-description"
      />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base sm:text-lg">T&M Daily Sheet - {projectName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          {/* Mobile: accordion sections */}
          <div className="md:hidden space-y-3">
            <MobileSection title="Date & Crew" defaultOpen={true}>
              {dateField}
              {crewSizeField}
            </MobileSection>
            <MobileSection title="Representatives" defaultOpen={true}>
              {companyRepField}
              {clientRepField}
            </MobileSection>
            <MobileSection title="Conditions & Work" defaultOpen={true}>
              {weatherField}
              {descriptionField}
            </MobileSection>
          </div>

          {/* Desktop: standard grid layout */}
          <div className="hidden md:block">
            <div className="grid grid-cols-2 gap-4">
              {dateField}
              {crewSizeField}
              {companyRepField}
              {clientRepField}
              <div className="col-span-2">{weatherField}</div>
              <div className="col-span-2">{descriptionField}</div>
            </div>
          </div>

          <Button type="submit" size="lg" className="w-full min-h-[48px]" data-testid="button-submit-tm">
            Submit Daily Sheet
          </Button>
        </form>
      </CardContent>
    </Card>
  );
});

TMDailyForm.displayName = "TMDailyForm";

export default TMDailyForm;
