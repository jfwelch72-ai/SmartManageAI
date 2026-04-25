import { useMemo, useEffect, useState } from "react";
import type { ProjectWithNames } from "@/hooks/use-data";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { EmptyState } from "./EmptyState";
import { MapPin, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import MapPickerDialog from "./MapPickerDialog";
import StaleDrawingsBadge from "./StaleDrawingsBadge";
import { useDrawingSetStaleSummary } from "@/hooks/use-drawing-set-stale-summary";

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

function ContextMenuCapture({
  onContext,
}: {
  onContext: (lat: number, lng: number, point: { x: number; y: number }) => void;
}) {
  useMapEvents({
    contextmenu(e) {
      e.originalEvent.preventDefault();
      onContext(e.latlng.lat, e.latlng.lng, {
        x: e.containerPoint.x,
        y: e.containerPoint.y,
      });
    },
  });
  return null;
}

export default function ProjectsMapView({ projects, onProjectClick }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isGeocoding, setIsGeocoding] = useState(false);

  useEffect(() => {
    L.Marker.prototype.options.icon = defaultIcon;
  }, []);

  // Task #1915 — share the org-scoped stale-drawings roll-up with the table
  // and kanban views so opening the map doesn't trigger any extra requests.
  const { data: staleSummaryData } = useDrawingSetStaleSummary(projects.length > 0);
  const staleSummary = staleSummaryData?.summary ?? {};

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
  const canManageLocation = canGeocode;

  const unlocated = useMemo(
    () =>
      projects.filter(
        (p) =>
          typeof p.siteLatitude !== "number" ||
          typeof p.siteLongitude !== "number" ||
          isNaN(p.siteLatitude as number) ||
          isNaN(p.siteLongitude as number),
      ),
    [projects],
  );

  const missingCount = projects.length - located.length;

  const hasGeocodableAddress = (p: ProjectWithNames) =>
    Boolean((p.locationAddress && p.locationAddress.trim()) || (p.city && p.city.trim()));

  const pendingGeocodeCount = useMemo(
    () => projects.filter(p => (p.siteLatitude == null || p.siteLongitude == null) && hasGeocodableAddress(p)).length,
    [projects],
  );

  // Task #590: surface projects whose addresses have already failed to resolve
  // so admins know which records need manual address fixes instead of just
  // assuming the geocoder hasn't run yet.
  const unresolvedProjects = useMemo(
    () => projects.filter(p =>
      (p.siteLatitude == null || p.siteLongitude == null)
      && hasGeocodableAddress(p)
      && (p.lastGeocodeStatus === "NOT_FOUND" || p.lastGeocodeStatus === "FAILED")
    ),
    [projects],
  );

  const [contextPos, setContextPos] = useState<{
    x: number;
    y: number;
    lat: number;
    lng: number;
  } | null>(null);
  const [pickerState, setPickerState] = useState<{
    project: ProjectWithNames;
    initialLat: number | null;
    initialLng: number | null;
  } | null>(null);
  const [isSavingPick, setIsSavingPick] = useState(false);

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

  const openPickerForProject = (
    project: ProjectWithNames,
    seedLat: number | null,
    seedLng: number | null,
  ) => {
    setContextPos(null);
    setPickerState({
      project,
      initialLat: seedLat,
      initialLng: seedLng,
    });
  };

  const handleSavePickedLocation = async (lat: number, lng: number) => {
    if (!pickerState) return;
    setIsSavingPick(true);
    try {
      await apiRequest(
        "PATCH",
        `/api/projects/${pickerState.project.code}`,
        { siteLatitude: lat, siteLongitude: lng },
      );
      await queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Location saved",
        description: `${pickerState.project.code} pinned at ${lat.toFixed(6)}, ${lng.toFixed(6)}.`,
      });
      setPickerState(null);
    } catch (err) {
      toast({
        title: "Failed to save location",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsSavingPick(false);
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
        {unresolvedProjects.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-3 py-2 text-xs"
            data-testid="banner-unresolved-addresses"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <span className="font-medium text-amber-900 dark:text-amber-200">
                {unresolvedProjects.length} project address{unresolvedProjects.length === 1 ? "" : "es"} couldn't be located.
              </span>{" "}
              <span className="text-amber-800/80 dark:text-amber-200/70">
                Update the address on{" "}
                {unresolvedProjects.slice(0, 3).map((p, i) => (
                  <span key={p.id}>{i > 0 && ", "}<span className="font-mono">{p.code}</span></span>
                ))}
                {unresolvedProjects.length > 3 && ` and ${unresolvedProjects.length - 3} more`}
                {" "}to retry automatically.
              </span>
            </div>
          </div>
        )}
        <EmptyState
          icon={MapPin}
          title="No projects on the map yet"
          description={
            pendingGeocodeCount > 0
              ? `${pendingGeocodeCount} project(s) have an address but no coordinates. Click below to look them up automatically, or right-click the map to drop a pin manually.`
              : canManageLocation && unlocated.length > 0
                ? "Right-click anywhere on the map below to drop a pin and set a location for one of your projects."
                : "Add a site latitude and longitude to a project (Project → Settings → Location) — or open a project and use Pick on map — and it will show up here as a pin."
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
        {canManageLocation && unlocated.length > 0 && (
          <div
            className="rounded-md border overflow-hidden relative"
            data-testid="empty-map-picker"
          >
            <div className="h-[50vh] min-h-80 w-full relative">
              <MapContainer
                center={center}
                zoom={4}
                scrollWheelZoom
                className="h-full w-full"
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ContextMenuCapture
                  onContext={(lat, lng, point) =>
                    setContextPos({ lat, lng, x: point.x, y: point.y })
                  }
                />
              </MapContainer>
              {contextPos && (
                <div
                  className="absolute z-[1000]"
                  style={{ left: contextPos.x, top: contextPos.y }}
                >
                  <DropdownMenu
                    open
                    onOpenChange={(o) => {
                      if (!o) setContextPos(null);
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <span className="block w-px h-px" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-72"
                      data-testid="menu-set-location-for-project"
                    >
                      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                        Set location at {contextPos.lat.toFixed(5)},{" "}
                        {contextPos.lng.toFixed(5)} for…
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {unlocated.slice(0, 12).map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onSelect={() => {
                            openPickerForProject(
                              p,
                              contextPos.lat,
                              contextPos.lng,
                            );
                          }}
                          data-testid={`menu-item-set-location-${p.code}`}
                        >
                          <MapPin className="mr-2 h-3.5 w-3.5" />
                          <span className="font-mono text-xs mr-2">{p.code}</span>
                          <span className="truncate">{p.name}</span>
                        </DropdownMenuItem>
                      ))}
                      {unlocated.length > 12 && (
                        <div className="px-2 py-1 text-[10px] text-muted-foreground">
                          Showing first 12 of {unlocated.length} unlocated projects.
                        </div>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>
        )}
        {pickerState && (
          <MapPickerDialog
            open={!!pickerState}
            onOpenChange={(o) => {
              if (!o) setPickerState(null);
            }}
            initialLat={pickerState.initialLat}
            initialLng={pickerState.initialLng}
            title={`Set location for ${pickerState.project.code}`}
            description={`Click the map or drag the pin to set the exact site location for ${pickerState.project.name}.`}
            isSaving={isSavingPick}
            onConfirm={handleSavePickedLocation}
          />
        )}
      </div>
    );
  }

  const unresolvedBanner = unresolvedProjects.length > 0 && (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 px-3 py-2 text-xs"
      data-testid="banner-unresolved-addresses"
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="space-y-1">
        <div className="font-medium text-amber-900 dark:text-amber-200">
          {unresolvedProjects.length} project address{unresolvedProjects.length === 1 ? "" : "es"} couldn't be located
        </div>
        <div className="text-amber-800/80 dark:text-amber-200/70">
          Check the address on{" "}
          {unresolvedProjects.slice(0, 3).map((p, i) => (
            <span key={p.id} data-testid={`text-unresolved-${p.code}`}>
              {i > 0 && ", "}
              <span className="font-mono">{p.code}</span>
            </span>
          ))}
          {unresolvedProjects.length > 3 && ` and ${unresolvedProjects.length - 3} more`}
          {" "}so it can be re-tried automatically.
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3" data-testid="view-map">
      {unresolvedBanner}
      <div className="rounded-md border overflow-hidden relative">
      <div className="h-[60vh] min-h-96 w-full relative">
        <MapContainer center={center} zoom={located.length === 1 ? 11 : 5} scrollWheelZoom className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {canManageLocation && unlocated.length > 0 && (
            <ContextMenuCapture
              onContext={(lat, lng, point) =>
                setContextPos({ lat, lng, x: point.x, y: point.y })
              }
            />
          )}
          {located.map((p) => {
            return (
              <Marker key={p.id} position={[p.siteLatitude, p.siteLongitude]} data-testid={`map-pin-${p.code}`}>
                <Popup>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                      <StaleDrawingsBadge
                        projectCode={p.code}
                        summary={staleSummary[p.id]}
                      />
                    </div>
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
                    {canManageLocation && (
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline block"
                        onClick={() =>
                          openPickerForProject(p, p.siteLatitude, p.siteLongitude)
                        }
                        data-testid={`map-relocate-${p.code}`}
                      >
                        Move pin…
                      </button>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        {contextPos && canManageLocation && unlocated.length > 0 && (
          <div
            className="absolute z-[1000]"
            style={{ left: contextPos.x, top: contextPos.y }}
          >
            <DropdownMenu
              open
              onOpenChange={(o) => {
                if (!o) setContextPos(null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <span className="block w-px h-px" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-72"
                data-testid="menu-set-location-for-project"
              >
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Set location at {contextPos.lat.toFixed(5)},{" "}
                  {contextPos.lng.toFixed(5)} for…
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {unlocated.slice(0, 12).map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => {
                      openPickerForProject(p, contextPos.lat, contextPos.lng);
                    }}
                    data-testid={`menu-item-set-location-${p.code}`}
                  >
                    <MapPin className="mr-2 h-3.5 w-3.5" />
                    <span className="font-mono text-xs mr-2">{p.code}</span>
                    <span className="truncate">{p.name}</span>
                  </DropdownMenuItem>
                ))}
                {unlocated.length > 12 && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">
                    Showing first 12 of {unlocated.length} unlocated projects.
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {missingCount > 0 && (
        <div className="px-3 py-2 text-xs border-t bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-muted-foreground">
            Showing {located.length} of {projects.length} projects. {missingCount} project(s) are missing site coordinates.
            {canManageLocation && unlocated.length > 0 && " Right-click anywhere on the map to set a location for one of them."}
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
      {pickerState && (
        <MapPickerDialog
          open={!!pickerState}
          onOpenChange={(o) => {
            if (!o) setPickerState(null);
          }}
          initialLat={pickerState.initialLat}
          initialLng={pickerState.initialLng}
          title={`Set location for ${pickerState.project.code}`}
          description={`Click the map or drag the pin to set the exact site location for ${pickerState.project.name}.`}
          isSaving={isSavingPick}
          onConfirm={handleSavePickedLocation}
        />
      )}
    </div>
  );
}
