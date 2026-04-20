import { useMemo, useEffect, useState } from "react";
import type { ProjectWithNames } from "@/hooks/use-data";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { EmptyState } from "./EmptyState";
import { MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  const { user } = useAuth();
  const { toast } = useToast();
  const [isGeocoding, setIsGeocoding] = useState(false);

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

  const canGeocode = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPER_ADMIN";
  const missingCount = projects.length - located.length;

  const hasGeocodableAddress = (p: ProjectWithNames) =>
    Boolean((p.locationAddress && p.locationAddress.trim()) || (p.city && p.city.trim()));

  const pendingGeocodeCount = useMemo(
    () => projects.filter(p => (p.siteLatitude == null || p.siteLongitude == null) && hasGeocodableAddress(p)).length,
    [projects],
  );

  const handleGeocode = async () => {
    if (isGeocoding) return;
    setIsGeocoding(true);
    try {
      const res = await apiRequest("POST", "/api/projects/geocode-pending", {});
      const data = await res.json() as { scanned: number; geocoded: number; failed: number; notFound: number };
      toast({
        title: "Geocoding complete",
        description: `Scanned ${data.scanned}, located ${data.geocoded}, not found ${data.notFound}, failed ${data.failed}.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    } catch (err) {
      toast({
        title: "Geocoding failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsGeocoding(false);
    }
  };

  const center: [number, number] = located.length
    ? [
        located.reduce((s, p) => s + p.siteLatitude, 0) / located.length,
        located.reduce((s, p) => s + p.siteLongitude, 0) / located.length,
      ]
    : [39.8283, -98.5795]; // US center

  if (located.length === 0) {
    return (
      <div className="space-y-3" data-testid="view-map">
        <EmptyState
          icon={MapPin}
          title="No projects on the map yet"
          description={
            pendingGeocodeCount > 0
              ? `${pendingGeocodeCount} project(s) have an address but no coordinates. Click below to look them up automatically.`
              : "Add a site latitude and longitude to a project (Project → Settings → Location) and it will show up here as a pin."
          }
        />
        {canGeocode && pendingGeocodeCount > 0 && (
          <div className="flex justify-center">
            <Button
              onClick={handleGeocode}
              disabled={isGeocoding}
              data-testid="button-geocode-projects"
            >
              {isGeocoding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Locating addresses…
                </>
              ) : (
                <>
                  <MapPin className="mr-2 h-4 w-4" />
                  Locate {pendingGeocodeCount} project address{pendingGeocodeCount === 1 ? "" : "es"}
                </>
              )}
            </Button>
          </div>
        )}
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
      {missingCount > 0 && (
        <div className="px-3 py-2 text-xs border-t bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-muted-foreground">
            Showing {located.length} of {projects.length} projects. {missingCount} project(s) are missing site coordinates.
          </span>
          {canGeocode && pendingGeocodeCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleGeocode}
              disabled={isGeocoding}
              data-testid="button-geocode-projects"
            >
              {isGeocoding ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  Locating…
                </>
              ) : (
                <>
                  <MapPin className="mr-2 h-3 w-3" />
                  Locate {pendingGeocodeCount} address{pendingGeocodeCount === 1 ? "" : "es"}
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
