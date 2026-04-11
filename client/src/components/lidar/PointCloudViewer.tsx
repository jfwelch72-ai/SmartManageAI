import { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import * as WebIFC from "web-ifc";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  RotateCcw, Ruler,
  SquareDashedBottom, Box, Palette, Loader2, AlertCircle, Columns2, RefreshCw
} from "lucide-react";

export interface PointCloudViewerProps {
  fileUrl: string;
  fileName?: string;
  fileSize?: number | null;
  uploadDate?: string | Date | null;
  colorMode?: "RGB" | "ELEVATION" | "INTENSITY";
  onMeasurement?: (measurement: MeasurementResult) => void;
  compareFileUrl?: string;
  compareScanName?: string;
  bimOverlayUrl?: string;
}

export interface MeasurementResult {
  type: "DISTANCE" | "AREA" | "VOLUME";
  value: number;
  unit: string;
  points: { x: number; y: number; z: number }[];
  label: string;
}

type MeasurementMode = "none" | "distance" | "area" | "volume";
type ColorMode = "RGB" | "ELEVATION" | "INTENSITY";

function parseLASHeader(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const offsetToPoints = view.getUint32(96, true);
  const pointFormat = view.getUint8(104);
  const pointRecordLength = view.getUint16(105, true);
  const pointCountLegacy = view.getUint32(107, true);
  const scaleX = view.getFloat64(131, true);
  const scaleY = view.getFloat64(139, true);
  const scaleZ = view.getFloat64(147, true);
  const offsetX = view.getFloat64(155, true);
  const offsetY = view.getFloat64(163, true);
  const offsetZ = view.getFloat64(171, true);
  let pointCount = pointCountLegacy;
  if (pointCount === 0 && buffer.byteLength > 247) {
    pointCount = view.getUint32(247, true);
  }
  return { pointCount, offsetToPoints, pointRecordLength, pointFormat, scale: [scaleX, scaleY, scaleZ] as [number, number, number], offset: [offsetX, offsetY, offsetZ] as [number, number, number] };
}

function loadLASPoints(buffer: ArrayBuffer, budget: number) {
  const header = parseLASHeader(buffer);
  const actualCount = Math.min(header.pointCount, budget);
  const stride = header.pointRecordLength;
  const positions = new Float32Array(actualCount * 3);
  const colors = new Float32Array(actualCount * 3);
  const view = new DataView(buffer);
  const hasColor = header.pointFormat === 2 || header.pointFormat === 3 || header.pointFormat >= 7;
  const colorOffset = header.pointFormat === 2 ? 20 : 28;
  const step = header.pointCount > budget ? Math.floor(header.pointCount / budget) : 1;
  let idx = 0;
  let hasRealColor = false;

  for (let i = 0; i < header.pointCount && idx < actualCount; i += step) {
    const byteOffset = header.offsetToPoints + i * stride;
    if (byteOffset + 12 > buffer.byteLength) break;
    const rawX = view.getInt32(byteOffset, true);
    const rawY = view.getInt32(byteOffset + 4, true);
    const rawZ = view.getInt32(byteOffset + 8, true);
    positions[idx * 3] = rawX * header.scale[0] + header.offset[0];
    positions[idx * 3 + 1] = rawZ * header.scale[2] + header.offset[2];
    positions[idx * 3 + 2] = rawY * header.scale[1] + header.offset[1];

    if (hasColor && byteOffset + colorOffset + 6 <= buffer.byteLength) {
      const r = view.getUint16(byteOffset + colorOffset, true);
      const g = view.getUint16(byteOffset + colorOffset + 2, true);
      const b = view.getUint16(byteOffset + colorOffset + 4, true);
      colors[idx * 3] = r / 65535;
      colors[idx * 3 + 1] = g / 65535;
      colors[idx * 3 + 2] = b / 65535;
      if (r > 0 || g > 0 || b > 0) hasRealColor = true;
    } else {
      colors[idx * 3] = 0.6;
      colors[idx * 3 + 1] = 0.7;
      colors[idx * 3 + 2] = 0.8;
    }
    idx++;
  }
  return { positions: positions.slice(0, idx * 3), colors: colors.slice(0, idx * 3), count: idx, hasRealColor };
}

async function decompressLAZ(buffer: ArrayBuffer, budget: number): Promise<{ positions: Float32Array; colors: Float32Array; count: number; hasRealColor: boolean }> {
  try {
    const lazPerf = await import("laz-perf");
    const module = await (lazPerf as { default: () => Promise<{ LASZip: new () => { open: (data: Uint8Array, len: number) => void; getPoint: (buf: Uint8Array) => void; getCount: () => number; close: () => void } }> }).default();
    const laszip = new module.LASZip();
    const uint8 = new Uint8Array(buffer);
    laszip.open(uint8, uint8.length);
    const totalPoints = laszip.getCount();
    const count = Math.min(totalPoints, budget);
    const step = totalPoints > budget ? Math.floor(totalPoints / budget) : 1;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const header = parseLASHeader(buffer);
    const pointBuf = new Uint8Array(header.pointRecordLength);
    const pointView = new DataView(pointBuf.buffer);
    const hasColor = header.pointFormat === 2 || header.pointFormat === 3 || header.pointFormat >= 7;
    const colorOffset = header.pointFormat === 2 ? 20 : 28;
    let idx = 0;
    let hasRealColor = false;

    for (let i = 0; i < totalPoints && idx < count; i++) {
      laszip.getPoint(pointBuf);
      if (i % step !== 0) continue;
      const rawX = pointView.getInt32(0, true);
      const rawY = pointView.getInt32(4, true);
      const rawZ = pointView.getInt32(8, true);
      positions[idx * 3] = rawX * header.scale[0] + header.offset[0];
      positions[idx * 3 + 1] = rawZ * header.scale[2] + header.offset[2];
      positions[idx * 3 + 2] = rawY * header.scale[1] + header.offset[1];
      if (hasColor && pointBuf.length >= colorOffset + 6) {
        const r = pointView.getUint16(colorOffset, true);
        const g = pointView.getUint16(colorOffset + 2, true);
        const b = pointView.getUint16(colorOffset + 4, true);
        colors[idx * 3] = r / 65535;
        colors[idx * 3 + 1] = g / 65535;
        colors[idx * 3 + 2] = b / 65535;
        if (r > 0 || g > 0 || b > 0) hasRealColor = true;
      } else {
        colors[idx * 3] = 0.6;
        colors[idx * 3 + 1] = 0.7;
        colors[idx * 3 + 2] = 0.8;
      }
      idx++;
    }
    laszip.close();
    return { positions: positions.slice(0, idx * 3), colors: colors.slice(0, idx * 3), count: idx, hasRealColor };
  } catch {
    throw new Error("LAZ decompression failed. The laz-perf library may not be fully compatible with this file. Try converting to LAS or PLY format.");
  }
}

async function loadPointCloudFromUrl(url: string, budget: number, fileName?: string): Promise<{ geometry: THREE.BufferGeometry; count: number; hasRealColor: boolean }> {
  const extension = (fileName || url).split(".").pop()?.toLowerCase() || "";

  if (extension === "ply") {
    const loader = new PLYLoader();
    const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
    const count = geometry.attributes.position.count;
    const hasRealColor = !!geometry.attributes.color;
    if (!hasRealColor) {
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = 0.6;
        colors[i * 3 + 1] = 0.7;
        colors[i * 3 + 2] = 0.8;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    return { geometry, count, hasRealColor };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
  const buffer = await response.arrayBuffer();

  let result: { positions: Float32Array; colors: Float32Array; count: number; hasRealColor: boolean };

  if (extension === "las") {
    result = loadLASPoints(buffer, budget);
  } else if (extension === "laz") {
    result = await decompressLAZ(buffer, budget);
  } else if (extension === "e57") {
    throw new Error("E57 format requires specialized server-side conversion due to its complex XML+binary structure. Please convert to LAS or PLY format for browser viewing.");
  } else {
    throw new Error(`Unsupported point cloud format: .${extension}`);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(result.colors, 3));
  return { geometry, count: result.count, hasRealColor: result.hasRealColor };
}

function checkBrowserCapabilities(): { supported: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (typeof WebAssembly === "undefined") {
    warnings.push("WebAssembly is not supported by your browser.");
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) {
      warnings.push("WebGL is not supported or is disabled in your browser.");
    }
  } catch {
    warnings.push("Could not detect WebGL support.");
  }
  return { supported: warnings.length === 0, warnings };
}

export default function PointCloudViewer({
  fileUrl,
  fileName,
  fileSize,
  uploadDate,
  colorMode: initialColorMode = "RGB",
  onMeasurement,
  compareFileUrl,
  compareScanName,
  bimOverlayUrl,
}: PointCloudViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number>(0);
  const pointCloudRef = useRef<THREE.Points | null>(null);
  const originalColorsRef = useRef<Float32Array | null>(null);
  const hasRealColorRef = useRef(false);
  const comparePointCloudRef = useRef<THREE.Points | null>(null);
  const bimOverlayRef = useRef<THREE.Group | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState("Checking browser compatibility...");
  const [error, setError] = useState<string | null>(null);
  const [compatWarnings, setCompatWarnings] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);
  const [pointSize, setPointSize] = useState(2);
  const [pointBudget, setPointBudget] = useState(1000000);
  const [colorMode, setColorMode] = useState<ColorMode>(initialColorMode);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>("none");
  const [measurementPoints, setMeasurementPoints] = useState<THREE.Vector3[]>([]);
  const [measurements, setMeasurements] = useState<MeasurementResult[]>([]);
  const [pointCount, setPointCount] = useState(0);
  const [showCompare, setShowCompare] = useState(false);
  const [showBimOverlay, setShowBimOverlay] = useState(false);
  const [compareMode, setCompareMode] = useState<"overlay" | "side-by-side">("overlay");

  const initScene = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const compat = checkBrowserCapabilities();
    if (!compat.supported) {
      setCompatWarnings(compat.warnings);
      setError("3D viewer could not load. Your browser may not support this feature, or there was a network issue.");
      setLoading(false);
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    camera.position.set(0, 50, 100);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      setCompatWarnings(["WebGL renderer failed to initialize. Your browser or GPU may not support WebGL."]);
      setError("3D viewer could not load. Your browser may not support this feature, or there was a network issue.");
      setLoading(false);
      return;
    }
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.minDistance = 1;
    controls.maxDistance = 5000;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 50);
    scene.add(dirLight);
    scene.add(new THREE.GridHelper(200, 20, 0x444466, 0x333355));
    scene.add(new THREE.AxesHelper(10));

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animationFrameRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  const fitCameraToCloud = useCallback((geometry: THREE.BufferGeometry) => {
    if (!cameraRef.current || !controlsRef.current) return;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 1.5;
    cameraRef.current.position.set(center.x + distance * 0.5, center.y + distance * 0.5, center.z + distance);
    controlsRef.current.target.copy(center);
    controlsRef.current.update();
  }, []);

  const applyColorMode = useCallback((points: THREE.Points, mode: ColorMode) => {
    const positions = points.geometry.attributes.position;
    const colorAttr = points.geometry.attributes.color;
    if (!positions || !colorAttr) return;
    const count = positions.count;

    if (mode === "RGB" && originalColorsRef.current && hasRealColorRef.current) {
      for (let i = 0; i < count * 3 && i < originalColorsRef.current.length; i++) {
        (colorAttr.array as Float32Array)[i] = originalColorsRef.current[i];
      }
      colorAttr.needsUpdate = true;
      return;
    }

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = positions.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const range = maxY - minY || 1;

    for (let i = 0; i < count; i++) {
      const t = (positions.getY(i) - minY) / range;
      if (mode === "ELEVATION") {
        colorAttr.setXYZ(i, t < 0.5 ? 0 : (t - 0.5) * 2, t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2, 1 - t);
      } else if (mode === "INTENSITY") {
        const intensity = 0.3 + (t * 0.7);
        colorAttr.setXYZ(i, intensity, intensity, intensity);
      } else {
        if (originalColorsRef.current && hasRealColorRef.current) {
          colorAttr.setXYZ(i, originalColorsRef.current[i * 3], originalColorsRef.current[i * 3 + 1], originalColorsRef.current[i * 3 + 2]);
        }
      }
    }
    colorAttr.needsUpdate = true;
  }, []);

  useEffect(() => {
    const cleanup = initScene();
    return cleanup;
  }, [initScene, retryCount]);

  const handleRetry = useCallback(() => {
    setError(null);
    setCompatWarnings([]);
    setLoading(true);
    setLoadingStatus("Checking browser compatibility...");
    setRetryCount(c => c + 1);
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    setLoading(true);
    setError(null);
    setLoadingStatus("Checking browser compatibility...");

    const loadCloud = async () => {
      try {
        const compat = checkBrowserCapabilities();
        if (!compat.supported) {
          setCompatWarnings(compat.warnings);
          throw new Error("3D viewer could not load. Your browser may not support this feature, or there was a network issue.");
        }

        setLoadingStatus("Loading 3D engine...");

        if (pointCloudRef.current) {
          scene.remove(pointCloudRef.current);
          pointCloudRef.current.geometry.dispose();
          (pointCloudRef.current.material as THREE.PointsMaterial).dispose();
          pointCloudRef.current = null;
        }

        setLoadingStatus("Downloading point cloud data...");
        const { geometry, count, hasRealColor } = await loadPointCloudFromUrl(fileUrl, pointBudget, fileName);
        hasRealColorRef.current = hasRealColor;

        const colorArr = geometry.attributes.color.array as Float32Array;
        originalColorsRef.current = new Float32Array(colorArr);

        setLoadingStatus("Processing model...");
        const material = new THREE.PointsMaterial({ size: pointSize, vertexColors: true, sizeAttenuation: true });
        const points = new THREE.Points(geometry, material);
        scene.add(points);
        pointCloudRef.current = points;
        setPointCount(count);

        setLoadingStatus("Rendering point cloud...");
        applyColorMode(points, colorMode);
        fitCameraToCloud(geometry);
        setLoading(false);
      } catch (err) {
        console.error("Point cloud load error:", err);
        setError("3D viewer could not load. Your browser may not support this feature, or there was a network issue.");
        setLoading(false);
      }
    };

    loadCloud();
  }, [fileUrl, fileName, pointBudget, retryCount]);

  useEffect(() => {
    if (pointCloudRef.current) {
      (pointCloudRef.current.material as THREE.PointsMaterial).size = pointSize;
    }
    if (comparePointCloudRef.current) {
      (comparePointCloudRef.current.material as THREE.PointsMaterial).size = pointSize;
    }
  }, [pointSize]);

  useEffect(() => {
    if (pointCloudRef.current) {
      applyColorMode(pointCloudRef.current, colorMode);
    }
  }, [colorMode, applyColorMode]);

  useEffect(() => {
    if (!sceneRef.current || !compareFileUrl || !showCompare) {
      if (comparePointCloudRef.current && sceneRef.current) {
        sceneRef.current.remove(comparePointCloudRef.current);
        comparePointCloudRef.current.geometry.dispose();
        (comparePointCloudRef.current.material as THREE.PointsMaterial).dispose();
        comparePointCloudRef.current = null;
      }
      return;
    }

    const loadCompare = async () => {
      try {
        const { geometry } = await loadPointCloudFromUrl(compareFileUrl, Math.floor(pointBudget / 2), compareScanName);

        const colors = geometry.attributes.color;
        if (colors) {
          for (let i = 0; i < colors.count; i++) {
            colors.setXYZ(i, 1.0, 0.3, 0.3);
          }
          colors.needsUpdate = true;
        }

        const material = new THREE.PointsMaterial({ size: pointSize, vertexColors: true, sizeAttenuation: true, opacity: 0.7, transparent: true });

        if (comparePointCloudRef.current) {
          sceneRef.current!.remove(comparePointCloudRef.current);
          comparePointCloudRef.current.geometry.dispose();
          (comparePointCloudRef.current.material as THREE.PointsMaterial).dispose();
        }

        const comparePoints = new THREE.Points(geometry, material);

        if (compareMode === "side-by-side" && pointCloudRef.current) {
          const mainBounds = new THREE.Box3().setFromObject(pointCloudRef.current);
          const mainSize = new THREE.Vector3();
          mainBounds.getSize(mainSize);
          comparePoints.position.x += mainSize.x * 1.5;
        }

        sceneRef.current!.add(comparePoints);
        comparePointCloudRef.current = comparePoints;
      } catch (err) {
        console.error("Failed to load comparison scan:", err);
      }
    };

    loadCompare();
  }, [compareFileUrl, compareScanName, showCompare, pointBudget, pointSize, compareMode]);

  useEffect(() => {
    if (!sceneRef.current || !bimOverlayUrl || !showBimOverlay) {
      if (bimOverlayRef.current && sceneRef.current) {
        sceneRef.current.remove(bimOverlayRef.current);
        bimOverlayRef.current = null;
      }
      return;
    }

    const loadBimOverlay = async () => {
      const group = new THREE.Group();
      group.name = "bim-overlay";

      try {
        const response = await fetch(bimOverlayUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const bimBounds = await loadIfcGeometry(buffer, group);
          if (pointCloudRef.current) {
            applyDeviationColoring(pointCloudRef.current, bimBounds);
          }
        } else {
          buildFallbackBimWireframe(group);
        }
      } catch (err) {
        console.warn("[LiDAR BIM] IFC loading failed, using fallback:", err);
        buildFallbackBimWireframe(group);
      }

      if (bimOverlayRef.current) {
        sceneRef.current!.remove(bimOverlayRef.current);
      }
      sceneRef.current!.add(group);
      bimOverlayRef.current = group;
    };

    loadBimOverlay();
  }, [bimOverlayUrl, showBimOverlay]);

  const handleCanvasClick = useCallback((event: React.MouseEvent) => {
    if (measurementMode === "none" || !containerRef.current || !cameraRef.current || !sceneRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 2 };
    raycaster.setFromCamera(mouse, cameraRef.current);
    const allPoints = [pointCloudRef.current, comparePointCloudRef.current].filter(Boolean) as THREE.Points[];
    const intersects = raycaster.intersectObjects(allPoints);

    if (intersects.length > 0) {
      const point = intersects[0].point.clone();
      const newPoints = [...measurementPoints, point];
      setMeasurementPoints(newPoints);

      const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xff4444 }));
      sphere.position.copy(point);
      sphere.name = "measurement-marker";
      sceneRef.current.add(sphere);

      if (measurementMode === "distance" && newPoints.length === 2) {
        const dist = newPoints[0].distanceTo(newPoints[1]);
        const result: MeasurementResult = { type: "DISTANCE", value: Math.round(dist * 100) / 100, unit: "ft", points: newPoints.map(p => ({ x: p.x, y: p.y, z: p.z })), label: `Distance: ${dist.toFixed(2)} ft` };
        setMeasurements(prev => [...prev, result]);
        onMeasurement?.(result);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(newPoints), new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 }));
        line.name = "measurement-line";
        sceneRef.current.add(line);
        setMeasurementPoints([]);
      } else if (measurementMode === "area" && newPoints.length >= 3) {
        const area = computePolygonArea(newPoints);
        const result: MeasurementResult = { type: "AREA", value: Math.round(area * 100) / 100, unit: "sq ft", points: newPoints.map(p => ({ x: p.x, y: p.y, z: p.z })), label: `Area: ${area.toFixed(2)} sq ft` };
        setMeasurements(prev => [...prev, result]);
        onMeasurement?.(result);
        setMeasurementPoints([]);
      } else if (measurementMode === "volume" && newPoints.length >= 4) {
        const vol = computeVolumeEstimate(newPoints);
        const result: MeasurementResult = { type: "VOLUME", value: Math.round(vol * 100) / 100, unit: "cu ft", points: newPoints.map(p => ({ x: p.x, y: p.y, z: p.z })), label: `Volume: ${vol.toFixed(2)} cu ft` };
        setMeasurements(prev => [...prev, result]);
        onMeasurement?.(result);
        setMeasurementPoints([]);
      }
    }
  }, [measurementMode, measurementPoints, onMeasurement]);

  const resetView = useCallback(() => {
    if (pointCloudRef.current) {
      fitCameraToCloud(pointCloudRef.current.geometry);
    } else if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(0, 50, 100);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [fitCameraToCloud]);

  const clearMeasurements = useCallback(() => {
    if (!sceneRef.current) return;
    const toRemove: THREE.Object3D[] = [];
    sceneRef.current.traverse((child) => {
      if (child.name === "measurement-marker" || child.name === "measurement-line") toRemove.push(child);
    });
    toRemove.forEach(obj => sceneRef.current?.remove(obj));
    setMeasurements([]);
    setMeasurementPoints([]);
  }, []);

  const cycleColorMode = useCallback(() => {
    const modes: ColorMode[] = ["RGB", "ELEVATION", "INTENSITY"];
    setColorMode(modes[(modes.indexOf(colorMode) + 1) % modes.length]);
  }, [colorMode]);

  return (
    <div className="flex flex-col h-full" data-testid="point-cloud-viewer">
      <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2">
          <Badge variant="outline" data-testid="badge-point-count">{pointCount.toLocaleString()} points</Badge>
          <Badge variant="secondary" data-testid="badge-color-mode">{colorMode}</Badge>
          {fileName && <span className="text-sm text-muted-foreground truncate max-w-48" data-testid="text-filename">{fileName}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={resetView} title="Reset View" data-testid="button-reset-view"><RotateCcw className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={cycleColorMode} title="Color Mode" data-testid="button-color-mode"><Palette className="h-4 w-4" /></Button>
          <Button variant={measurementMode === "distance" ? "default" : "ghost"} size="icon" onClick={() => setMeasurementMode(measurementMode === "distance" ? "none" : "distance")} title="Measure Distance" data-testid="button-measure-distance"><Ruler className="h-4 w-4" /></Button>
          <Button variant={measurementMode === "area" ? "default" : "ghost"} size="icon" onClick={() => setMeasurementMode(measurementMode === "area" ? "none" : "area")} title="Measure Area" data-testid="button-measure-area"><SquareDashedBottom className="h-4 w-4" /></Button>
          <Button variant={measurementMode === "volume" ? "default" : "ghost"} size="icon" onClick={() => setMeasurementMode(measurementMode === "volume" ? "none" : "volume")} title="Measure Volume" data-testid="button-measure-volume"><Box className="h-4 w-4" /></Button>
          {compareFileUrl && (
            <>
              <Button variant={showCompare ? "default" : "outline"} size="sm" onClick={() => setShowCompare(!showCompare)} data-testid="button-toggle-compare">
                {showCompare ? "Hide Compare" : "Compare"}
              </Button>
              {showCompare && (
                <Button variant="ghost" size="icon" onClick={() => setCompareMode(compareMode === "overlay" ? "side-by-side" : "overlay")} title={compareMode === "overlay" ? "Switch to Side-by-Side" : "Switch to Overlay"} data-testid="button-toggle-compare-mode">
                  <Columns2 className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
          {bimOverlayUrl && (
            <Button variant={showBimOverlay ? "default" : "outline"} size="sm" onClick={() => setShowBimOverlay(!showBimOverlay)} data-testid="button-toggle-bim-overlay">
              {showBimOverlay ? "Hide BIM" : "BIM Overlay"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-[200px]">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Point Size</span>
          <Slider value={[pointSize]} onValueChange={([v]) => setPointSize(v)} min={0.5} max={10} step={0.5} className="w-24" data-testid="slider-point-size" />
          <span className="text-xs text-muted-foreground w-6">{pointSize}</span>
        </div>
        <div className="flex items-center gap-2 min-w-[200px]">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Point Budget</span>
          <Slider value={[pointBudget]} onValueChange={([v]) => setPointBudget(v)} min={100000} max={2000000} step={100000} className="w-24" data-testid="slider-point-budget" />
          <span className="text-xs text-muted-foreground w-16">{(pointBudget / 1000).toFixed(0)}k</span>
        </div>
        {showCompare && compareFileUrl && (
          <Badge variant="outline" data-testid="badge-compare-mode">{compareMode === "overlay" ? "Overlay" : "Side-by-Side"}</Badge>
        )}
        {measurementMode !== "none" && (
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="default" data-testid="badge-measurement-mode">Measuring: {measurementMode} ({measurementPoints.length} points)</Badge>
            <Button variant="ghost" size="sm" onClick={clearMeasurements} data-testid="button-clear-measurements">Clear</Button>
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-[400px]" ref={containerRef} onClick={handleCanvasClick} data-testid="canvas-container">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10" data-testid="loading-overlay">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{loadingStatus}</p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 z-10" data-testid="error-overlay">
            <div className="flex flex-col items-center gap-3 max-w-md text-center px-4">
              <AlertCircle className="h-12 w-12 text-destructive/60" />
              <h3 className="text-base font-semibold" data-testid="lidar-error-title">Failed to Load Point Cloud</h3>
              <p className="text-sm text-muted-foreground" data-testid="lidar-error-message">{error}</p>
              {compatWarnings.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-1" data-testid="lidar-compat-warnings">
                  {compatWarnings.map((w, i) => (
                    <p key={i}>• {w}</p>
                  ))}
                </div>
              )}
              {(fileName || fileSize != null || uploadDate) && (
                <div className="border rounded-lg p-3 bg-muted/30 text-left w-full" data-testid="lidar-file-metadata">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">File Information</p>
                  <div className="space-y-1 text-sm">
                    {fileName && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">File name</span>
                        <span className="font-medium truncate ml-2 max-w-[200px]" data-testid="lidar-meta-filename">{fileName}</span>
                      </div>
                    )}
                    {fileName && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Format</span>
                        <span className="font-medium" data-testid="lidar-meta-format">{fileName.split(".").pop()?.toUpperCase() || "Unknown"}</span>
                      </div>
                    )}
                    {fileSize != null && fileSize > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size</span>
                        <span className="font-medium" data-testid="lidar-meta-size">{(fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                      </div>
                    )}
                    {uploadDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Upload date</span>
                        <span className="font-medium" data-testid="lidar-meta-date">{new Date(uploadDate).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <Button variant="outline" size="sm" onClick={handleRetry} data-testid="lidar-retry-button">
                <RefreshCw className="h-4 w-4 mr-2" /> Retry
              </Button>
            </div>
          </div>
        )}
      </div>

      {measurements.length > 0 && (
        <div className="border-t p-2 bg-muted/30 max-h-32 overflow-y-auto" data-testid="measurements-panel">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Measurements</span>
            <Button variant="ghost" size="sm" onClick={clearMeasurements} className="h-6 text-xs" data-testid="button-clear-all-measurements">Clear All</Button>
          </div>
          <div className="space-y-1">
            {measurements.map((m, i) => (
              <div key={i} className="flex items-center gap-2 text-xs" data-testid={`measurement-result-${i}`}>
                <Badge variant="outline" className="text-[10px]">{m.type}</Badge>
                <span>{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function loadIfcGeometry(buffer: ArrayBuffer, group: THREE.Group): Promise<THREE.Box3> {
  const ifcApi = new WebIFC.IfcAPI();
  ifcApi.SetWasmPath("https://unpkg.com/web-ifc@0.0.57/");
  await ifcApi.Init();

  const uint8 = new Uint8Array(buffer);
  const modelID = ifcApi.OpenModel(uint8);

  const flatMeshes = ifcApi.LoadAllGeometry(modelID);
  const totalMeshes = flatMeshes.size();

  for (let i = 0; i < totalMeshes; i++) {
    const flatMesh = flatMeshes.get(i);
    const placedGeometries = flatMesh.geometries;

    for (let j = 0; j < placedGeometries.size(); j++) {
      const pg = placedGeometries.get(j);
      const geomData = ifcApi.GetGeometry(modelID, pg.geometryExpressID);
      const verts = ifcApi.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize());
      const indices = ifcApi.GetIndexArray(geomData.GetIndexData(), geomData.GetIndexDataSize());

      if (verts.length === 0 || indices.length === 0) continue;

      const geometry = new THREE.BufferGeometry();
      const posFloats = new Float32Array(verts.length / 2);
      const normFloats = new Float32Array(verts.length / 2);

      for (let k = 0; k < verts.length; k += 6) {
        const idx = k / 2;
        posFloats[idx] = verts[k];
        posFloats[idx + 1] = verts[k + 1];
        posFloats[idx + 2] = verts[k + 2];
        normFloats[idx] = verts[k + 3];
        normFloats[idx + 1] = verts[k + 4];
        normFloats[idx + 2] = verts[k + 5];
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(posFloats, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(normFloats, 3));
      geometry.setIndex(Array.from(indices));

      const color = new THREE.Color(pg.color.x, pg.color.y, pg.color.z);
      const material = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: Math.min(pg.color.w, 0.5),
        side: THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0.1,
      });

      const mesh = new THREE.Mesh(geometry, material);
      const matrix = new THREE.Matrix4().fromArray(pg.flatTransformation);
      mesh.applyMatrix4(matrix);
      group.add(mesh);
    }
  }

  ifcApi.CloseModel(modelID);

  const bounds = new THREE.Box3();
  if (group.children.length > 0) {
    bounds.setFromObject(group);
  }
  return bounds;
}

function buildFallbackBimWireframe(group: THREE.Group): void {
  const planeGeo = new THREE.PlaneGeometry(40, 40);
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.4 });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  group.add(plane);

  const boxGeo = new THREE.BoxGeometry(10, 8, 10);
  const edges = new THREE.EdgesGeometry(boxGeo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.6 });
  const edgeLines = new THREE.LineSegments(edges, edgeMat);
  edgeLines.position.y = 4;
  group.add(edgeLines);
}

function applyDeviationColoring(pointCloud: THREE.Points, bimBounds: THREE.Box3): void {
  const positions = pointCloud.geometry.attributes.position;
  const colorAttr = pointCloud.geometry.attributes.color;
  if (!positions || !colorAttr) return;

  const center = new THREE.Vector3();
  bimBounds.getCenter(center);
  const bimSize = new THREE.Vector3();
  bimBounds.getSize(bimSize);
  const maxDim = Math.max(bimSize.x, bimSize.y, bimSize.z) || 1;

  const worldPos = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    worldPos.set(positions.getX(i), positions.getY(i), positions.getZ(i));

    const dx = Math.max(0, Math.abs(worldPos.x - center.x) - bimSize.x / 2);
    const dy = Math.max(0, Math.abs(worldPos.y - center.y) - bimSize.y / 2);
    const dz = Math.max(0, Math.abs(worldPos.z - center.z) - bimSize.z / 2);
    const deviation = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const normalizedDev = Math.min(1, deviation / (maxDim * 0.3));

    if (normalizedDev < 0.33) {
      colorAttr.setXYZ(i, 0, 1, 0);
    } else if (normalizedDev < 0.66) {
      colorAttr.setXYZ(i, 1, 1, 0);
    } else {
      colorAttr.setXYZ(i, 1, 0, 0);
    }
  }
  colorAttr.needsUpdate = true;
}

function computePolygonArea(points: THREE.Vector3[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].z - points[j].x * points[i].z;
  }
  return Math.abs(area) / 2;
}

function computeVolumeEstimate(points: THREE.Vector3[]): number {
  if (points.length < 4) return 0;
  const baseArea = computePolygonArea(points);
  const avgHeight = points.reduce((s, p) => s + p.y, 0) / points.length;
  return baseArea * Math.abs(avgHeight);
}
