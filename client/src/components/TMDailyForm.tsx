import { useState, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>T&M Daily Sheet - {projectName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                data-testid="input-tm-date"
              />
            </div>

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
                data-testid="input-crew-size"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tfrRepName">Company Representative</Label>
              <Input
                id="tfrRepName"
                placeholder="John Smith"
                value={tfrRepName}
                onChange={(e) => setTfrRepName(e.target.value)}
                required
                data-testid="input-tfr-rep"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientRepName">Client Representative</Label>
              <Input
                id="clientRepName"
                placeholder="Jane Doe"
                value={clientRepName}
                onChange={(e) => setClientRepName(e.target.value)}
                data-testid="input-client-rep"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="weather">Weather Conditions</Label>
              <Input
                id="weather"
                placeholder="Sunny, 72°F"
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
                data-testid="input-weather"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
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
          </div>

          <Button type="submit" className="w-full" data-testid="button-submit-tm">
            Submit Daily Sheet
          </Button>
        </form>
      </CardContent>
    </Card>
  );
});

TMDailyForm.displayName = "TMDailyForm";

export default TMDailyForm;
