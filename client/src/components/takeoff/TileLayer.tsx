/**
 * Task #2138 — Konva component that paints the visible PDF tiles
 * over the low-res placeholder. Each tile is positioned in world
 * coordinates so it lines up perfectly with the placeholder
 * underneath; KonvaImage draws the bitmap at the right physical
 * size by setting both `image` and explicit `width`/`height`.
 *
 * Stays thin on purpose — all decision logic (which bucket, which
 * coords, eviction) lives in the hook + scheduler. This component
 * just renders whatever the hook hands it.
 */

import { Image as KonvaImage } from "react-konva";
import {
  TILE_SIZE_PX,
  type TileCoord,
} from "@/lib/takeoff/tileCoords";

export interface TileLayerProps {
  tiles: Array<{ coord: TileCoord; bitmap: ImageBitmap }>;
}

export function TileLayer({ tiles }: TileLayerProps) {
  return (
    <>
      {tiles.map(({ coord, bitmap }) => {
        const tileWorld = TILE_SIZE_PX / coord.zoomBucket;
        return (
          <KonvaImage
            key={`tile-${coord.sheetId}-${coord.pageIndex}-${coord.zoomBucket}-${coord.tileX}-${coord.tileY}`}
            image={bitmap as unknown as HTMLImageElement}
            x={coord.tileX * tileWorld}
            y={coord.tileY * tileWorld}
            width={tileWorld}
            height={tileWorld}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
    </>
  );
}
