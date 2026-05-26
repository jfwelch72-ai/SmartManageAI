import React, { useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, spacing } from "@/theme";

// Task #3090: A tiny finger-signature pad built on react-native-svg +
// PanResponder so it works in plain Expo Go (no native module required).
// Strokes are captured live as SVG paths for display, then rasterized to a
// PNG (8-bit grayscale, uncompressed DEFLATE inside a zlib wrapper) on
// export(). The result is returned as a `data:image/png;base64,...` URL
// that the T&M `client-signoff` endpoint accepts as the `signature` field
// (server schema allows up to ~500 KB which is far more than a typical
// 320x180 monochrome signature occupies — roughly 8–15 KB compressed).

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** Returns `data:image/png;base64,...` or null if the pad is empty. */
  export: () => string | null;
  /** Returns raw width/height + stroke segments for callers who want
   *  to upload the PNG bytes through the attachment pipeline. */
  exportPngBytes: () => Uint8Array | null;
}

interface Props {
  height?: number;
  strokeColor?: string;
  strokeWidth?: number;
  backgroundColor?: string;
}

interface Point { x: number; y: number; }

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { height = 180, strokeColor = "#111", strokeWidth = 2.4, backgroundColor = "#fff" },
  ref
) {
  const [paths, setPaths] = useState<string[]>([]);
  const strokesRef = useRef<Point[][]>([]);
  const currentStrokeRef = useRef<Point[]>([]);
  const currentDRef = useRef<string>("");
  const [, force] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: height });

  function onLayout(e: LayoutChangeEvent) {
    const { width, height: h } = e.nativeEvent.layout;
    setSize({ w: width, h });
  }

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentStrokeRef.current = [{ x: locationX, y: locationY }];
          currentDRef.current = `M${round(locationX)},${round(locationY)}`;
          force((n) => n + 1);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentStrokeRef.current.push({ x: locationX, y: locationY });
          currentDRef.current += ` L${round(locationX)},${round(locationY)}`;
          force((n) => n + 1);
        },
        onPanResponderRelease: commitStroke,
        onPanResponderTerminate: commitStroke,
      }),
    []
  );

  function commitStroke() {
    if (currentStrokeRef.current.length > 0) {
      strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
      setPaths((p) => [...p, currentDRef.current]);
      currentStrokeRef.current = [];
      currentDRef.current = "";
    }
  }

  useImperativeHandle(
    ref,
    () => {
      const buildPng = (): Uint8Array | null => {
        const all = currentStrokeRef.current.length > 0
          ? [...strokesRef.current, currentStrokeRef.current]
          : strokesRef.current;
        if (all.length === 0) return null;
        const w = Math.max(8, Math.round(size.w));
        const h = Math.max(8, Math.round(size.h));
        return rasterizeToPng(w, h, all, strokeWidth);
      };
      return {
        clear: () => {
          currentStrokeRef.current = [];
          currentDRef.current = "";
          strokesRef.current = [];
          setPaths([]);
        },
        isEmpty: () =>
          strokesRef.current.length === 0 && currentStrokeRef.current.length === 0,
        export: () => {
          const png = buildPng();
          if (!png) return null;
          return `data:image/png;base64,${bytesToBase64(png)}`;
        },
        exportPngBytes: () => buildPng(),
      };
    },
    [paths, size.w, size.h, strokeWidth]
  );

  const allPaths = currentDRef.current ? [...paths, currentDRef.current] : paths;

  return (
    <View
      onLayout={onLayout}
      {...responder.panHandlers}
      style={[styles.pad, { height, backgroundColor }]}
      testID="signature-pad"
    >
      <Svg width="100%" height="100%">
        {allPaths.map((d, i) => (
          <Path
            key={i}
            d={d}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
});

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// -- Rasterizer ---------------------------------------------------------
// Draw each stroke segment into an 8-bit grayscale buffer using Bresenham
// + a small filled-disk brush so the line has thickness. White (255) is
// background, black (0) is ink. Output is then PNG-encoded.

function rasterizeToPng(
  w: number,
  h: number,
  strokes: Point[][],
  strokeWidth: number
): Uint8Array {
  const px = new Uint8Array(w * h);
  px.fill(255);
  const r = Math.max(1, Math.round(strokeWidth / 2));
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      stampDisk(px, w, h, stroke[0].x, stroke[0].y, r);
      continue;
    }
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1];
      const b = stroke[i];
      drawLine(px, w, h, a.x, a.y, b.x, b.y, r);
    }
  }
  return encodePngGray(w, h, px);
}

function stampDisk(px: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) px[y * w + x] = 0;
    }
  }
}

function drawLine(
  px: Uint8Array, w: number, h: number,
  x0: number, y0: number, x1: number, y1: number, r: number
): void {
  let ax = Math.round(x0), ay = Math.round(y0);
  const bx = Math.round(x1), by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  // Cap iterations to avoid pathological loops on tiny canvases.
  for (let i = 0; i < dx + Math.abs(dy) + 4; i++) {
    stampDisk(px, w, h, ax, ay, r);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}

// -- PNG encoder (grayscale, uncompressed DEFLATE) ----------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function deflateStored(data: Uint8Array): Uint8Array {
  const MAX = 65535;
  const numBlocks = Math.max(1, Math.ceil(data.length / MAX));
  const out = new Uint8Array(2 + numBlocks * 5 + data.length + 4);
  let p = 0;
  out[p++] = 0x78; out[p++] = 0x01; // zlib header: deflate, no compression
  for (let i = 0; i < numBlocks; i++) {
    const start = i * MAX;
    const len = Math.min(MAX, data.length - start);
    const last = i === numBlocks - 1 ? 1 : 0;
    out[p++] = last;                          // BFINAL, BTYPE=00 (stored)
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    out[p++] = nlen & 0xff;
    out[p++] = (nlen >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), p);
    p += len;
  }
  const a = adler32(data);
  out[p++] = (a >>> 24) & 0xff;
  out[p++] = (a >>> 16) & 0xff;
  out[p++] = (a >>> 8) & 0xff;
  out[p++] = a & 0xff;
  return out.subarray(0, p);
}

function writeUint32BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  writeUint32BE(chunk, 8 + data.length, crc);
  return chunk;
}

function encodePngGray(w: number, h: number, pixels: Uint8Array): Uint8Array {
  const stride = w + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: None
    raw.set(pixels.subarray(y * w, (y + 1) * w), y * stride + 1);
  }
  const idat = deflateStored(raw);
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, w);
  writeUint32BE(ihdr, 4, h);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // color type: grayscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: standard
  ihdr[12] = 0; // interlace: none
  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", idat);
  const iendChunk = makeChunk("IEND", new Uint8Array(0));
  const total = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let p = 0;
  out.set(sig, p); p += sig.length;
  out.set(ihdrChunk, p); p += ihdrChunk.length;
  out.set(idatChunk, p); p += idatChunk.length;
  out.set(iendChunk, p); p += iendChunk.length;
  return out;
}

// -- Base64 -------------------------------------------------------------
// Hermes ships `btoa` since Hermes 0.12 but we keep a pure-JS fallback
// for older runtimes / unit tests.

function bytesToBase64(bytes: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (typeof g.btoa === "function") {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))),
      );
    }
    return g.btoa(bin);
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    out += chars[(triplet >> 18) & 0x3f];
    out += chars[(triplet >> 12) & 0x3f];
    out += i + 1 < bytes.length ? chars[(triplet >> 6) & 0x3f] : "=";
    out += i + 2 < bytes.length ? chars[triplet & 0x3f] : "=";
  }
  return out;
}

const styles = StyleSheet.create({
  pad: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginTop: spacing(1),
  },
});
