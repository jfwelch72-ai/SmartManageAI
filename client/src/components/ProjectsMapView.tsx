import { useMemo, useEffect } from "react";
import type { ProjectWithNames } from "@/hooks/use-data";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { EmptyState } from "./EmptyState";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

const defaultIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Props {
  projects: ProjectWithNames[];
  onProjectClick: (project: ProjectWithNames) => void;
}

export default function ProjectsMapView({ projects, onProjectClick }: Props) {
  useEffect(() => {
    L.Marker.prototype.options.icon = defaultIcon;
  }, []);

  type LocatedProject = ProjectWithNames & { siteLatitude: number; siteLongitude: number };

  const located = useMemo<LocatedProject[]>(() => {
    return projects.filter((p): p is LocatedProject => {
      return typeof p.siteLatitude === "number"
        && typeof p.siteLongitude === "number"
        && !isNaN(p.siteLatitude)
        && !isNaN(p.siteLongitude);
    });
  }, [projects]);

  const center: [number, number] = located.length
    ? [
        located.reduce((s, p) => s + p.siteLatitude, 0) / located.length,
        located.reduce((s, p) => s + p.siteLongitude, 0) / located.length,
      ]
    : [39.8283, -98.5795]; // US center

  if (located.length === 0) {
    return (
      <div data-testid="view-map">
        <EmptyState
          icon={MapPin}
          title="No projects on the map yet"
          description="Add a site latitude and longitude to a project (Project → Settings → Location) and it will show up here as a pin."
        />
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden" data-testid="view-map">
      <div className="h-[60vh] min-h-96 w-full">
        <MapContainer center={center} zoom={located.length === 1 ? 11 : 5} scrollWheelZoom className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {located.map((p) => {
            return (
              <Marker key={p.id} position={[p.siteLatitude, p.siteLongitude]} data-testid={`map-pin-${p.code}`}>
                <Popup>
                  <div className="space-y-1">
                    <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                    <div className="font-medium text-sm">{p.name}</div>
                    {p.clientName && <div className="text-xs">{p.clientName}</div>}
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => onProjectClick(p)}
                      data-testid={`map-open-${p.code}`}
                    >
                      Open project →
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
      {located.length < projects.length && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t bg-muted/30">
          Showing {located.length} of {projects.length} projects. {projects.length - located.length} project(s) are missing site coordinates.
        </div>
      )}
    </div>
  );
}
