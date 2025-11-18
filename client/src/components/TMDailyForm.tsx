import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TMDailyFormProps {
  projectName: string;
  onSubmit: (data: any) => void;
}

export default function TMDailyForm({ projectName, onSubmit }: TMDailyFormProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [tfrRep, setTfrRep] = useState("");
  const [clientRep, setClientRep] = useState("");
  const [weather, setWeather] = useState("");
  const [description, setDescription] = useState("");
  const [crewSize, setCrewSize] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      date,
      tfrRep,
      clientRep,
      weather,
      description,
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
              <Label htmlFor="tfrRep">TFR Representative</Label>
              <Input
                id="tfrRep"
                placeholder="John Smith"
                value={tfrRep}
                onChange={(e) => setTfrRep(e.target.value)}
                required
                data-testid="input-tfr-rep"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientRep">Client Representative</Label>
              <Input
                id="clientRep"
                placeholder="Jane Doe"
                value={clientRep}
                onChange={(e) => setClientRep(e.target.value)}
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
              <Label htmlFor="description">Description of Work</Label>
              <Textarea
                id="description"
                placeholder="Detail the work performed today..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
}
