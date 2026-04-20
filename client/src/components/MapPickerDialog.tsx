import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const pickerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialLat?: number | null;
  initialLng?: number | null;
  title?: string;
  description?: string;
  onConfirm: (lat: number, lng: number) => void | Promise<void>;
  isSaving?: boolean;
}

function ClickCapture({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapPickerDialog({
  open,
  onOpenChange,
  initialLat,
  initialLng,
  title = "Pick location on map",
  description = "Click anywhere on the map or drag the pin to set the exact site location. You can also fine-tune the coordinates below.",
  onConfirm,
  isSaving = false,
}: Props) {
  const { toast } = useToast();
  const hasInitial =
    typeof initialLat === "number" &&
    typeof initialLng === "number" &&
    !isNaN(initialLat) &&
    !isNaN(initialLng);

  const [lat, setLat] = useState<number | null>(hasInitial ? initialLat! : null);
  const [lng, setLng] = useState<number | null>(hasInitial ? initialLng! : null);
  const [latText, setLatText] = useState(hasInitial ? String(initialLat) : "");
  const [lngText, setLngText] = useState(hasInitial ? String(initialLng) : "");

  useEffect(() => {
    if (open) {
      const has =
        typeof initialLat === "number" &&
        typeof initialLng === "number" &&
        !isNaN(initialLat) &&
        !isNaN(initialLng);
      setLat(has ? initialLat! : null);
      setLng(has ? initialLng! : null);
      setLatText(has ? String(initialLat) : "");
      setLngText(has ? String(initialLng) : "");
    }
  }, [open, initialLat, initialLng]);

  const setPicked = (newLat: number, newLng: number) => {
    const roundedLat = Number(newLat.toFixed(6));
    const roundedLng = Number(newLng.toFixed(6));
    setLat(roundedLat);
    setLng(roundedLng);
    setLatText(String(roundedLat));
    setLngText(String(roundedLng));
  };

  const center: [number, number] =
    lat != null && lng != null ? [lat, lng] : [39.8283, -98.5795];
  const zoom = lat != null && lng != null ? 13 : 4;

  const handleConfirm = async () => {
    const parsedLat = parseFloat(latText);
    const parsedLng = parseFloat(lngText);
    if (
      isNaN(parsedLat) ||
      isNaN(parsedLng) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLng < -180 ||
      parsedLng > 180
    ) {
      toast({
        title: "Invalid coordinates",
        description: "Pick a point on the map or enter a valid latitude/longitude.",
        variant: "destructive",
      });
      return;
    }
    await onConfirm(parsedLat, parsedLng);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="dialog-map-picker">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border overflow-hidden h-[55vh] min-h-80 w-full">
            <MapContainer
              center={center}
              zoom={zoom}
              scrollWheelZoom
              className="h-full w-full"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ClickCapture onPick={setPicked} />
              {lat != null && lng != null && (
                <Marker
                  position={[lat, lng]}
                  draggable
                  icon={pickerIcon}
                  eventHandlers={{
                    dragend: (e) => {
                      const m = e.target as L.Marker;
                      const pos = m.getLatLng();
                      setPicked(pos.lat, pos.lng);
                    },
                  }}
                />
              )}
            </MapContainer>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Latitude</Label>
              <Input
                type="number"
                step="0.000001"
                value={latText}
                onChange={(e) => {
                  setLatText(e.target.value);
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setLat(v);
                }}
                placeholder="e.g., 40.7128"
                className="h-8 text-sm"
                data-testid="input-picker-latitude"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Longitude</Label>
              <Input
                type="number"
                step="0.000001"
                value={lngText}
                onChange={(e) => {
                  setLngText(e.target.value);
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) setLng(v);
                }}
                placeholder="e.g., -74.0060"
                className="h-8 text-sm"
                data-testid="input-picker-longitude"
              />
            </div>
          </div>
          {lat == null || lng == null ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Click anywhere on the map to drop a pin.
            </p>
          ) : (
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-picker-coords"
            >
              Selected: {lat.toFixed(6)}, {lng.toFixed(6)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-testid="button-picker-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSaving || lat == null || lng == null}
            data-testid="button-picker-confirm"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <MapPin className="mr-2 h-4 w-4" />
                Use this location
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
