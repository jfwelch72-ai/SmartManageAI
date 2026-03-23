import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import * as WebIFC from "web-ifc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  RotateCcw, Maximize, Move, ZoomIn, ZoomOut, MousePointer,
  ChevronRight, ChevronDown, Building2, Layers, Box, AlertCircle,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Loader2, Ruler, SquareDashedBottom, Plus, X
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface BimViewerProps {
  fileUrl: string;
  fileName?: string;
  onAddToTakeoff?: (elements: BimElementSummary[]) => void;
  onElementSelect?: (elements: BimSelectedElement[]) => void;
  highlightStoreyId?: number | null;
}

export interface BimSelectedElement {
  expressID: number;
  type: string;
  name: string;
  storeyExpressId?: number;
  storeyName?: string;
}

export interface BimElementSummary {
  expressID: number;
  type: string;
  name: string;
  material?: string;
  dimensions?: { length?: number; area?: number; volume?: number };
  properties: { name: string; value: string }[];
}

export interface BimStoreyInfo {
  expressID: number;
  name: string;
}

interface IFCTreeNode {
  expressID: number;
  type: string;
  name: string;
  children: IFCTreeNode[];
}

interface IFCProperty {
  name: string;
  value: string;
}

interface IFCElementInfo {
  expressID: number;
  type: string;
  name: string;
  properties: IFCProperty[];
}

interface Measurement3D {
  id: string;
  type: "distance" | "area";
  points: THREE.Vector3[];
  value: number;
  label: string;
}

const IFC_TYPE_NAMES: Record<number, string> = {
  [WebIFC.IFCPROJECT]: "Project",
  [WebIFC.IFCSITE]: "Site",
  [WebIFC.IFCBUILDING]: "Building",
  [WebIFC.IFCBUILDINGSTOREY]: "Building Storey",
  [WebIFC.IFCSPACE]: "Space",
  [WebIFC.IFCWALL]: "Wall",
  [WebIFC.IFCWALLSTANDARDCASE]: "Wall",
  [WebIFC.IFCSLAB]: "Slab",
  [WebIFC.IFCCOLUMN]: "Column",
  [WebIFC.IFCBEAM]: "Beam",
  [WebIFC.IFCDOOR]: "Door",
  [WebIFC.IFCWINDOW]: "Window",
  [WebIFC.IFCSTAIR]: "Stair",
  [WebIFC.IFCSTAIRFLIGHT]: "Stair Flight",
  [WebIFC.IFCROOF]: "Roof",
  [WebIFC.IFCRAILING]: "Railing",
  [WebIFC.IFCFURNISHINGELEMENT]: "Furniture",
  [WebIFC.IFCPLATE]: "Plate",
  [WebIFC.IFCMEMBER]: "Member",
  [WebIFC.IFCCOVERING]: "Covering",
  [WebIFC.IFCFOOTING]: "Footing",
  [WebIFC.IFCCURTAINWALL]: "Curtain Wall",
  [WebIFC.IFCOPENINGELEMENT]: "Opening",
  [WebIFC.IFCFLOWSEGMENT]: "Flow Segment",
  [WebIFC.IFCFLOWTERMINAL]: "Flow Terminal",
  [WebIFC.IFCFLOWFITTING]: "Flow Fitting",
  [WebIFC.IFCPIPESEGMENT]: "Pipe Segment",
  [WebIFC.IFCDUCTSEGMENT]: "Duct Segment",
};

function getTypeName(typeId: number): string {
  return IFC_TYPE_NAMES[typeId] || `IFC Element`;
}

function getPropertyValue(prop: any): string {
  if (prop === null || prop === undefined) return "";
  if (typeof prop === "object") {
    if (prop.value !== undefined) return String(prop.value);
    return "";
  }
  return String(prop);
}

function TreeNodeComponent({
  node,
  level,
  selectedIds,
  expandedIds,
  onToggle,
  onSelect,
}: {
  node: IFCTreeNode;
  level: number;
  selectedIds: Set<number>;
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
  onSelect: (id: number, multi: boolean) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.expressID);
  const isSelected = selectedIds.has(node.expressID);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 px-1 py-0.5 text-xs cursor-pointer hover:bg-accent/50 rounded-sm transition-colors",
          isSelected && "bg-primary/20 text-primary font-medium"
        )}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={(e) => onSelect(node.expressID, e.shiftKey)}
        data-testid={`bim-tree-node-${node.expressID}`}
      >
        {hasChildren ? (
          <button
            className="shrink-0 p-0.5"
            onClick={(e) => { e.stopPropagation(); onToggle(node.expressID); }}
            data-testid={`bim-tree-toggle-${node.expressID}`}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {node.type === "Building" || node.type === "Building Storey" ? (
          <Building2 className="w-3 h-3 shrink-0 text-muted-foreground" />
        ) : node.type === "Site" || node.type === "Project" ? (
          <Layers className="w-3 h-3 shrink-0 text-muted-foreground" />
        ) : (
          <Box className="w-3 h-3 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name || node.type}</span>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeComponent
              key={child.expressID}
              node={child}
              level={level + 1}
              selectedIds={selectedIds}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function buildRelationTree(ifcApi: WebIFC.IfcAPI, modelID: number, fileName?: string): IFCTreeNode[] {
  const aggregatesMap = new Map<number, number[]>();
  const containsMap = new Map<number, number[]>();

  try {
    const relAggregates = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELAGGREGATES);
    for (let i = 0; i < relAggregates.size(); i++) {
      try {
        const rel = ifcApi.GetLine(modelID, relAggregates.get(i));
        const parentRef = rel?.RelatingObject?.value;
        const children = rel?.RelatedObjects;
        if (parentRef && Array.isArray(children)) {
          const childIds = children.map((c: any) => c.value).filter(Boolean);
          const existing = aggregatesMap.get(parentRef) || [];
          aggregatesMap.set(parentRef, [...existing, ...childIds]);
        }
      } catch (e) {
        console.warn("[BIM] Failed to parse IfcRelAggregates entry:", e);
      }
    }
  } catch (e) {
    console.warn("[BIM] Failed to load IfcRelAggregates:", e);
  }

  try {
    const relContains = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < relContains.size(); i++) {
      try {
        const rel = ifcApi.GetLine(modelID, relContains.get(i));
        const spatialRef = rel?.RelatingStructure?.value;
        const elements = rel?.RelatedElements;
        if (spatialRef && Array.isArray(elements)) {
          const elemIds = elements.map((e: any) => e.value).filter(Boolean);
          const existing = containsMap.get(spatialRef) || [];
          containsMap.set(spatialRef, [...existing, ...elemIds]);
        }
      } catch (e) {
        console.warn("[BIM] Failed to parse IfcRelContainedInSpatialStructure entry:", e);
      }
    }
  } catch (e) {
    console.warn("[BIM] Failed to load IfcRelContainedInSpatialStructure:", e);
  }

  function getNodeName(expressID: number): string {
    try {
      const line = ifcApi.GetLine(modelID, expressID);
      return line?.Name?.value || line?.LongName?.value || "";
    } catch (e) {
      console.warn(`[BIM] Failed to get name for element ${expressID}:`, e);
      return "";
    }
  }

  function getNodeType(expressID: number): string {
    try {
      const line = ifcApi.GetLine(modelID, expressID);
      const typeNum = line?.type;
      if (typeNum && IFC_TYPE_NAMES[typeNum]) return IFC_TYPE_NAMES[typeNum];
      return line?.constructor?.name?.replace("Ifc", "")?.replace(/([A-Z])/g, " $1").trim() || "Element";
    } catch (e) {
      console.warn(`[BIM] Failed to get type for element ${expressID}:`, e);
      return "Element";
    }
  }

  function buildNode(expressID: number): IFCTreeNode {
    const name = getNodeName(expressID);
    const type = getNodeType(expressID);
    const children: IFCTreeNode[] = [];

    const aggChildren = aggregatesMap.get(expressID) || [];
    for (const childId of aggChildren) {
      children.push(buildNode(childId));
    }

    const containedChildren = containsMap.get(expressID) || [];
    for (const childId of containedChildren) {
      children.push(buildNode(childId));
    }

    return {
      expressID,
      type,
      name: name || `${type} #${expressID}`,
      children,
    };
  }

  const roots: IFCTreeNode[] = [];
  try {
    const projects = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT);
    for (let i = 0; i < projects.size(); i++) {
      roots.push(buildNode(projects.get(i)));
    }
  } catch (e) {
    console.warn("[BIM] Failed to load IfcProject entries:", e);
  }

  if (roots.length === 0) {
    return [{
      expressID: -1,
      type: "Model",
      name: fileName || "IFC Model",
      children: [],
    }];
  }

  return roots;
}

function getElementProperties(ifcApi: WebIFC.IfcAPI, modelID: number, expressID: number): IFCElementInfo | null {
  try {
    const line = ifcApi.GetLine(modelID, expressID);
    const name = line?.Name?.value || `Element #${expressID}`;
    const typeNum = line?.type;
    const typeName = typeNum && IFC_TYPE_NAMES[typeNum] ? IFC_TYPE_NAMES[typeNum] : "Element";
    const properties: IFCProperty[] = [];

    properties.push({ name: "Express ID", value: String(expressID) });
    if (line?.GlobalId?.value) properties.push({ name: "Global ID", value: line.GlobalId.value });
    if (line?.Name?.value) properties.push({ name: "Name", value: line.Name.value });
    if (line?.Description?.value) properties.push({ name: "Description", value: line.Description.value });
    if (line?.ObjectType?.value) properties.push({ name: "Object Type", value: line.ObjectType.value });
    if (line?.Tag?.value) properties.push({ name: "Tag", value: line.Tag.value });
    if (line?.LongName?.value) properties.push({ name: "Long Name", value: line.LongName.value });

    try {
      const relDefines = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYPROPERTIES);
      for (let i = 0; i < relDefines.size(); i++) {
        try {
          const rel = ifcApi.GetLine(modelID, relDefines.get(i));
          const relatedObjects = rel?.RelatedObjects;
          if (!Array.isArray(relatedObjects)) continue;

          const isRelated = relatedObjects.some((obj: any) => obj.value === expressID);
          if (!isRelated) continue;

          const psetRef = rel?.RelatingPropertyDefinition?.value;
          if (!psetRef) continue;

          const pset = ifcApi.GetLine(modelID, psetRef);
          const psetName = pset?.Name?.value || "";

          if (pset?.HasProperties && Array.isArray(pset.HasProperties)) {
            for (const propRef of pset.HasProperties) {
              if (!propRef?.value) continue;
              try {
                const prop = ifcApi.GetLine(modelID, propRef.value);
                if (prop?.Name?.value && prop?.NominalValue !== undefined) {
                  properties.push({
                    name: `${psetName ? psetName + " / " : ""}${prop.Name.value}`,
                    value: getPropertyValue(prop.NominalValue),
                  });
                }
              } catch (e) {
                console.warn(`[BIM] Failed to read property ${propRef.value}:`, e);
              }
            }
          }

          if (pset?.Quantities && Array.isArray(pset.Quantities)) {
            for (const qRef of pset.Quantities) {
              if (!qRef?.value) continue;
              try {
                const qty = ifcApi.GetLine(modelID, qRef.value);
                const qName = qty?.Name?.value;
                const qVal = qty?.LengthValue?.value ?? qty?.AreaValue?.value ?? qty?.VolumeValue?.value ?? qty?.CountValue?.value ?? qty?.WeightValue?.value;
                if (qName && qVal !== undefined) {
                  properties.push({
                    name: `${psetName ? psetName + " / " : ""}${qName}`,
                    value: String(qVal),
                  });
                }
              } catch (e) {
                console.warn(`[BIM] Failed to read quantity ${qRef.value}:`, e);
              }
            }
          }
        } catch (e) {
          console.warn("[BIM] Failed to parse IfcRelDefinesByProperties entry:", e);
        }
      }
    } catch (e) {
      console.warn("[BIM] Failed to load IfcRelDefinesByProperties:", e);
    }

    try {
      const relDefType = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELDEFINESBYTYPE);
      for (let i = 0; i < relDefType.size(); i++) {
        try {
          const rel = ifcApi.GetLine(modelID, relDefType.get(i));
          const related = rel?.RelatedObjects;
          if (!Array.isArray(related)) continue;
          const isRelated = related.some((obj: any) => obj.value === expressID);
          if (!isRelated) continue;

          const typeRef = rel?.RelatingType?.value;
          if (typeRef) {
            const typeObj = ifcApi.GetLine(modelID, typeRef);
            if (typeObj?.Name?.value) {
              properties.push({ name: "Type Name", value: typeObj.Name.value });
            }
          }
        } catch (e) {
          console.warn("[BIM] Failed to parse IfcRelDefinesByType entry:", e);
        }
      }
    } catch (e) {
      console.warn("[BIM] Failed to load IfcRelDefinesByType:", e);
    }

    try {
      const relAssociates = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELASSOCIATESMATERIAL);
      for (let i = 0; i < relAssociates.size(); i++) {
        try {
          const rel = ifcApi.GetLine(modelID, relAssociates.get(i));
          const related = rel?.RelatedObjects;
          if (!Array.isArray(related)) continue;
          const isRelated = related.some((obj: any) => obj.value === expressID);
          if (!isRelated) continue;

          const matRef = rel?.RelatingMaterial?.value;
          if (matRef) {
            const mat = ifcApi.GetLine(modelID, matRef);
            if (mat?.Name?.value) {
              properties.push({ name: "Material", value: mat.Name.value });
            } else if (mat?.ForLayerSet?.value) {
              const layerSet = ifcApi.GetLine(modelID, mat.ForLayerSet.value);
              if (layerSet?.LayerSetName?.value) {
                properties.push({ name: "Material Layer Set", value: layerSet.LayerSetName.value });
              }
            }
          }
        } catch (e) {
          console.warn("[BIM] Failed to parse IfcRelAssociatesMaterial entry:", e);
        }
      }
    } catch (e) {
      console.warn("[BIM] Failed to load IfcRelAssociatesMaterial:", e);
    }

    return { expressID, type: typeName, name, properties: properties.slice(0, 40) };
  } catch {
    return null;
  }
}

function findElementStorey(ifcApi: WebIFC.IfcAPI, modelID: number, expressID: number): { expressID: number; name: string } | null {
  try {
    const relContains = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < relContains.size(); i++) {
      try {
        const rel = ifcApi.GetLine(modelID, relContains.get(i));
        const elements = rel?.RelatedElements;
        if (!Array.isArray(elements)) continue;
        const isContained = elements.some((e: any) => e.value === expressID);
        if (!isContained) continue;
        const structRef = rel?.RelatingStructure?.value;
        if (!structRef) continue;
        const struct = ifcApi.GetLine(modelID, structRef);
        if (struct?.type === WebIFC.IFCBUILDINGSTOREY) {
          return { expressID: structRef, name: struct?.Name?.value || struct?.LongName?.value || `Storey #${structRef}` };
        }
      } catch {}
    }
  } catch {}
  return null;
}

function getStoreysFromTree(nodes: IFCTreeNode[]): BimStoreyInfo[] {
  const storeys: BimStoreyInfo[] = [];
  function walk(node: IFCTreeNode) {
    if (node.type === "Building Storey") {
      storeys.push({ expressID: node.expressID, name: node.name });
    }
    node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return storeys;
}

function getElementsInStorey(ifcApi: WebIFC.IfcAPI, modelID: number, storeyExpressId: number): number[] {
  const elementIds: number[] = [];
  try {
    const relContains = ifcApi.GetLineIDsWithType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < relContains.size(); i++) {
      try {
        const rel = ifcApi.GetLine(modelID, relContains.get(i));
        const structRef = rel?.RelatingStructure?.value;
        if (structRef !== storeyExpressId) continue;
        const elements = rel?.RelatedElements;
        if (Array.isArray(elements)) {
          elements.forEach((e: any) => { if (e.value) elementIds.push(e.value); });
        }
      } catch {}
    }
  } catch {}
  return elementIds;
}

export default function BimViewer({ fileUrl, fileName, onAddToTakeoff, onElementSelect, highlightStoreyId }: BimViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const ifcApiRef = useRef<WebIFC.IfcAPI | null>(null);
  const meshMapRef = useRef<Map<number, THREE.Mesh[]>>(new Map());
  const modelIdRef = useRef<number>(0);
  const animFrameRef = useRef<number>(0);
  const allMeshesGroupRef = useRef<THREE.Group>(new THREE.Group());
  const measureGroupRef = useRef<THREE.Group>(new THREE.Group());

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [error, setError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<IFCTreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [selectedElementIds, setSelectedElementIds] = useState<Set<number>>(new Set());
  const [elementInfo, setElementInfo] = useState<IFCElementInfo | null>(null);
  const [showTree, setShowTree] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [controlMode, setControlMode] = useState<"orbit" | "pan" | "measure_distance" | "measure_area">("orbit");
  const [measurements, setMeasurements] = useState<Measurement3D[]>([]);
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([]);
  const [showActionPanel, setShowActionPanel] = useState(false);

  const highlightMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x00aaff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    []
  );
  const storeyHighlightMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0xff8800, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    []
  );
  const originalMaterialsRef = useRef<Map<number, Map<THREE.Mesh, THREE.Material | THREE.Material[]>>>(new Map());

  const storeys = useMemo(() => getStoreysFromTree(treeData), [treeData]);

  const selectedElementSummaries = useMemo((): BimElementSummary[] => {
    if (selectedElementIds.size === 0 || !ifcApiRef.current) return [];
    const summaries: BimElementSummary[] = [];
    for (const id of selectedElementIds) {
      const info = getElementProperties(ifcApiRef.current, modelIdRef.current, id);
      if (info) {
        const dims: BimElementSummary["dimensions"] = {};
        for (const p of info.properties) {
          const ln = p.name.toLowerCase();
          if (ln.includes("length")) dims.length = parseFloat(p.value) || undefined;
          if (ln.includes("area")) dims.area = parseFloat(p.value) || undefined;
          if (ln.includes("volume")) dims.volume = parseFloat(p.value) || undefined;
        }
        const materialProp = info.properties.find(p => p.name === "Material" || p.name === "Material Layer Set");
        summaries.push({
          expressID: info.expressID,
          type: info.type,
          name: info.name,
          material: materialProp?.value,
          dimensions: dims,
          properties: info.properties,
        });
      }
    }
    return summaries;
  }, [selectedElementIds]);

  useEffect(() => {
    if (selectedElementIds.size > 0) {
      setShowActionPanel(true);
    } else {
      setShowActionPanel(false);
    }
    if (onElementSelect && ifcApiRef.current) {
      const elements: BimSelectedElement[] = [];
      for (const id of selectedElementIds) {
        const info = getElementProperties(ifcApiRef.current, modelIdRef.current, id);
        if (info) {
          const storey = findElementStorey(ifcApiRef.current, modelIdRef.current, id);
          elements.push({
            expressID: id,
            type: info.type,
            name: info.name,
            storeyExpressId: storey?.expressID,
            storeyName: storey?.name,
          });
        }
      }
      onElementSelect(elements);
    }
  }, [selectedElementIds, onElementSelect]);

  useEffect(() => {
    if (!ifcApiRef.current || loading) return;
    const elementIds = highlightStoreyId
      ? getElementsInStorey(ifcApiRef.current, modelIdRef.current, highlightStoreyId)
      : [];
    meshMapRef.current.forEach((meshes, id) => {
      const origMap = originalMaterialsRef.current.get(id);
      if (!origMap) return;
      if (selectedElementIds.has(id)) return;
      if (elementIds.includes(id)) {
        meshes.forEach((m) => { m.material = storeyHighlightMaterial; });
      } else {
        meshes.forEach((m) => { const o = origMap.get(m); if (o) m.material = o as THREE.Material; });
      }
    });
  }, [highlightStoreyId, loading, selectedElementIds, storeyHighlightMaterial]);

  const initThreeScene = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.position.set(30, 30, 30);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 5000;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(50, 100, 50);
    dirLight1.castShadow = true;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-50, 50, -50);
    scene.add(dirLight2);

    scene.add(new THREE.HemisphereLight(0xddeeff, 0x0f0e0d, 0.3));
    scene.add(new THREE.GridHelper(200, 50, 0xcccccc, 0xe0e0e0));
    scene.add(allMeshesGroupRef.current);
    scene.add(measureGroupRef.current);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
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
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      controls.dispose();
    };
  }, []);

  const loadIfcModel = useCallback(async () => {
    try {
      setLoadingStatus("Initializing IFC parser...");
      setProgress(5);

      const ifcApi = new WebIFC.IfcAPI();
      ifcApi.SetWasmPath("/");
      await ifcApi.Init();
      ifcApiRef.current = ifcApi;

      setLoadingStatus("Downloading IFC file...");
      setProgress(15);

      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);

      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to read file stream");

      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) setProgress(15 + Math.floor((received / total) * 40));
      }

      const allData = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        allData.set(chunk, offset);
        offset += chunk.length;
      }

      setLoadingStatus("Parsing IFC model...");
      setProgress(60);

      const modelID = ifcApi.OpenModel(allData);
      modelIdRef.current = modelID;

      setLoadingStatus("Building 3D geometry...");
      setProgress(70);

      if (!sceneRef.current) throw new Error("Scene not initialized");

      const meshMap = meshMapRef.current;
      meshMap.clear();
      originalMaterialsRef.current.clear();

      const flatMeshes = ifcApi.LoadAllGeometry(modelID);
      const totalMeshes = flatMeshes.size();

      for (let i = 0; i < totalMeshes; i++) {
        const flatMesh = flatMeshes.get(i);
        const expressID = flatMesh.expressID;
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
            transparent: pg.color.w < 1,
            opacity: pg.color.w,
            side: THREE.DoubleSide,
            roughness: 0.7,
            metalness: 0.1,
          });

          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData.expressID = expressID;

          const matrix = new THREE.Matrix4().fromArray(pg.flatTransformation);
          mesh.applyMatrix4(matrix);

          allMeshesGroupRef.current.add(mesh);

          if (!meshMap.has(expressID)) meshMap.set(expressID, []);
          meshMap.get(expressID)!.push(mesh);

          if (!originalMaterialsRef.current.has(expressID)) {
            originalMaterialsRef.current.set(expressID, new Map());
          }
          originalMaterialsRef.current.get(expressID)!.set(mesh, material);
        }

        if (i % 50 === 0) setProgress(70 + Math.floor((i / totalMeshes) * 20));
      }

      setLoadingStatus("Building model tree...");
      setProgress(92);

      const tree = buildRelationTree(ifcApi, modelID, fileName);
      setTreeData(tree);

      const initialExpanded = new Set<number>();
      const expandLevels = (nodes: IFCTreeNode[], depth: number) => {
        if (depth > 3) return;
        for (const n of nodes) {
          if (n.children.length > 0) {
            initialExpanded.add(n.expressID);
            expandLevels(n.children, depth + 1);
          }
        }
      };
      expandLevels(tree, 0);
      setExpandedIds(initialExpanded);

      fitCameraToModel();
      setProgress(100);
      setLoadingStatus("Model loaded");
      setLoading(false);
    } catch (err: any) {
      console.error("IFC load error:", err);
      setError(err.message || "Failed to load IFC model");
      setLoading(false);
    }
  }, [fileUrl, fileName]);

  const fitCameraToModel = useCallback(() => {
    const group = allMeshesGroupRef.current;
    if (group.children.length === 0) return;

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (cameraRef.current && controlsRef.current) {
      const fov = cameraRef.current.fov * (Math.PI / 180);
      const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

      cameraRef.current.position.set(
        center.x + dist * 0.5,
        center.y + dist * 0.5,
        center.z + dist * 0.5
      );
      cameraRef.current.near = maxDim * 0.001;
      cameraRef.current.far = maxDim * 100;
      cameraRef.current.updateProjectionMatrix();

      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  }, []);

  const applySelection = useCallback((ids: Set<number>) => {
    meshMapRef.current.forEach((meshes, id) => {
      const origMap = originalMaterialsRef.current.get(id);
      if (!origMap) return;
      if (ids.has(id)) {
        meshes.forEach((m) => { m.material = highlightMaterial; });
      } else {
        meshes.forEach((m) => { const o = origMap.get(m); if (o) m.material = o as THREE.Material; });
      }
    });
  }, [highlightMaterial]);

  const handleSelectElement = useCallback((expressID: number, multiSelect = false) => {
    if (expressID < 0) {
      setSelectedElementIds(new Set());
      setElementInfo(null);
      applySelection(new Set());
      return;
    }

    setSelectedElementIds(prev => {
      let next: Set<number>;
      if (multiSelect) {
        next = new Set(prev);
        if (next.has(expressID)) {
          next.delete(expressID);
        } else {
          next.add(expressID);
        }
      } else {
        next = new Set([expressID]);
      }
      applySelection(next);
      return next;
    });

    const selectedMeshes = meshMapRef.current.get(expressID);
    if (selectedMeshes && selectedMeshes.length > 0) {
      const box = new THREE.Box3();
      selectedMeshes.forEach((m) => box.expandByObject(m));
      const center = box.getCenter(new THREE.Vector3());
      if (controlsRef.current) {
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
      }
    }

    if (ifcApiRef.current) {
      const info = getElementProperties(ifcApiRef.current, modelIdRef.current, expressID);
      setElementInfo(info);
    }
  }, [applySelection]);

  const handleToggleNode = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleResetView = useCallback(() => {
    fitCameraToModel();
    setSelectedElementIds(new Set());
    applySelection(new Set());
    setElementInfo(null);
    setMeasurePoints([]);
  }, [fitCameraToModel, applySelection]);

  const handleZoomIn = useCallback(() => {
    if (cameraRef.current && controlsRef.current) {
      const dir = new THREE.Vector3();
      cameraRef.current.getWorldDirection(dir);
      cameraRef.current.position.addScaledVector(dir, 5);
      controlsRef.current.update();
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (cameraRef.current && controlsRef.current) {
      const dir = new THREE.Vector3();
      cameraRef.current.getWorldDirection(dir);
      cameraRef.current.position.addScaledVector(dir, -5);
      controlsRef.current.update();
    }
  }, []);

  const setOrbitMode = useCallback(() => {
    if (!controlsRef.current) return;
    controlsRef.current.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    setControlMode("orbit");
    setMeasurePoints([]);
  }, []);

  const setPanMode = useCallback(() => {
    if (!controlsRef.current) return;
    controlsRef.current.mouseButtons.LEFT = THREE.MOUSE.PAN;
    setControlMode("pan");
    setMeasurePoints([]);
  }, []);

  const setMeasureDistanceMode = useCallback(() => {
    if (!controlsRef.current) return;
    controlsRef.current.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    setControlMode("measure_distance");
    setMeasurePoints([]);
  }, []);

  const setMeasureAreaMode = useCallback(() => {
    if (!controlsRef.current) return;
    controlsRef.current.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    setControlMode("measure_area");
    setMeasurePoints([]);
  }, []);

  const addMeasureAnnotation = useCallback((measurement: Measurement3D) => {
    const group = measureGroupRef.current;
    if (measurement.type === "distance" && measurement.points.length === 2) {
      const p1 = measurement.points[0];
      const p2 = measurement.points[1];
      const lineMat = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 });
      const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const line = new THREE.Line(lineGeom, lineMat);
      line.userData.measurementId = measurement.id;
      group.add(line);

      const sphereGeom = new THREE.SphereGeometry(0.15, 8, 8);
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
      const s1 = new THREE.Mesh(sphereGeom, sphereMat);
      s1.position.copy(p1);
      s1.userData.measurementId = measurement.id;
      group.add(s1);
      const s2 = new THREE.Mesh(sphereGeom, sphereMat);
      s2.position.copy(p2);
      s2.userData.measurementId = measurement.id;
      group.add(s2);
    } else if (measurement.type === "area" && measurement.points.length >= 3) {
      const pts = measurement.points;
      const lineGeom = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x44aaff, linewidth: 2 });
      const line = new THREE.Line(lineGeom, lineMat);
      line.userData.measurementId = measurement.id;
      group.add(line);
    }
  }, []);

  const clearMeasurement = useCallback((id: string) => {
    const group = measureGroupRef.current;
    const toRemove = group.children.filter(c => c.userData.measurementId === id);
    toRemove.forEach(c => {
      group.remove(c);
      if ((c as any).geometry) (c as any).geometry.dispose();
      if ((c as any).material) (c as any).material.dispose();
    });
    setMeasurements(prev => prev.filter(m => m.id !== id));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sceneRef.current || !cameraRef.current) return;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current || !cameraRef.current) return;

      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, cameraRef.current);

      if (controlMode === "measure_distance") {
        const intersects = raycaster.intersectObjects(allMeshesGroupRef.current.children, true);
        if (intersects.length > 0) {
          const point = intersects[0].point.clone();
          setMeasurePoints(prev => {
            const next = [...prev, point];
            if (next.length === 2) {
              const dist = next[0].distanceTo(next[1]);
              const id = `dist-${Date.now()}`;
              const m: Measurement3D = { id, type: "distance", points: next, value: dist, label: `${dist.toFixed(2)} m` };
              setMeasurements(p => [...p, m]);
              addMeasureAnnotation(m);
              return [];
            }
            return next;
          });
        }
        return;
      }

      if (controlMode === "measure_area") {
        const intersects = raycaster.intersectObjects(allMeshesGroupRef.current.children, true);
        if (intersects.length > 0) {
          const face = intersects[0].face;
          const mesh = intersects[0].object as THREE.Mesh;
          if (face && mesh.geometry) {
            const pos = mesh.geometry.attributes.position;
            const a = new THREE.Vector3().fromBufferAttribute(pos, face.a).applyMatrix4(mesh.matrixWorld);
            const b = new THREE.Vector3().fromBufferAttribute(pos, face.b).applyMatrix4(mesh.matrixWorld);
            const c = new THREE.Vector3().fromBufferAttribute(pos, face.c).applyMatrix4(mesh.matrixWorld);
            const ab = new THREE.Vector3().subVectors(b, a);
            const ac = new THREE.Vector3().subVectors(c, a);
            const area = ab.cross(ac).length() / 2;
            const id = `area-${Date.now()}`;
            const m: Measurement3D = { id, type: "area", points: [a, b, c], value: area, label: `${area.toFixed(2)} m²` };
            setMeasurements(p => [...p, m]);
            addMeasureAnnotation(m);
          }
        }
        return;
      }

      const intersects = raycaster.intersectObjects(allMeshesGroupRef.current.children, true);
      if (intersects.length > 0) {
        const expressID = intersects[0].object.userData.expressID;
        if (expressID !== undefined) handleSelectElement(expressID, event.shiftKey);
      } else {
        if (!event.shiftKey) handleSelectElement(-1);
      }
    };

    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [handleSelectElement, controlMode, addMeasureAnnotation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedElementIds(new Set());
        applySelection(new Set());
        setElementInfo(null);
        setMeasurePoints([]);
        if (controlMode === "measure_distance" || controlMode === "measure_area") {
          setOrbitMode();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [applySelection, controlMode, setOrbitMode]);

  useEffect(() => {
    const cleanup = initThreeScene();
    loadIfcModel();
    return () => {
      cleanup?.();
      if (ifcApiRef.current) {
        try { ifcApiRef.current.CloseModel(modelIdRef.current); } catch (e) { console.warn("[BIM] Failed to close model:", e); }
      }
    };
  }, [initThreeScene, loadIfcModel]);

  const handleAddToTakeoff = useCallback(() => {
    if (onAddToTakeoff && selectedElementSummaries.length > 0) {
      onAddToTakeoff(selectedElementSummaries);
    }
  }, [onAddToTakeoff, selectedElementSummaries]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center" data-testid="bim-viewer-error">
        <AlertCircle className="w-16 h-16 text-destructive/50 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to Load BIM Model</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-4">{error}</p>
        <Button variant="outline" onClick={() => { setError(null); setLoading(true); loadIfcModel(); }} data-testid="bim-retry-button">
          <RotateCcw className="w-4 h-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full" data-testid="bim-viewer">
      {showTree && (
        <div className="w-56 border-r bg-card flex flex-col shrink-0" data-testid="bim-model-tree">
          <div className="flex items-center justify-between px-2 py-1.5 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model Tree</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowTree(false)} data-testid="bim-hide-tree">
              <PanelLeftClose className="w-3.5 h-3.5" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="py-1">
              {treeData.length === 0 && !loading ? (
                <div className="px-3 py-4 text-xs text-muted-foreground text-center">No elements found</div>
              ) : (
                treeData.map((node) => (
                  <TreeNodeComponent
                    key={node.expressID}
                    node={node}
                    level={0}
                    selectedIds={selectedElementIds}
                    expandedIds={expandedIds}
                    onToggle={handleToggleNode}
                    onSelect={handleSelectElement}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 relative" ref={containerRef}>
        <div className="absolute top-2 left-2 z-10 flex gap-1 bg-background/80 backdrop-blur-sm rounded-md border p-1" data-testid="bim-toolbar">
          {!showTree && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowTree(true)} title="Show Tree" data-testid="bim-show-tree">
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant={controlMode === "orbit" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={setOrbitMode}
            title="Orbit"
            data-testid="bim-orbit-button"
          >
            <MousePointer className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant={controlMode === "pan" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={setPanMode}
            title="Pan"
            data-testid="bim-pan-button"
          >
            <Move className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant={controlMode === "measure_distance" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={setMeasureDistanceMode}
            title="Measure Distance"
            data-testid="bim-measure-distance-button"
          >
            <Ruler className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant={controlMode === "measure_area" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={setMeasureAreaMode}
            title="Measure Surface Area"
            data-testid="bim-measure-area-button"
          >
            <SquareDashedBottom className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleZoomIn} title="Zoom In" data-testid="bim-zoom-in">
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleZoomOut} title="Zoom Out" data-testid="bim-zoom-out">
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={fitCameraToModel} title="Fit All" data-testid="bim-fit-all">
            <Maximize className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleResetView} title="Reset View" data-testid="bim-reset-view">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
          {!showProperties && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowProperties(true)} title="Show Properties" data-testid="bim-show-properties">
              <PanelRightOpen className="w-3.5 h-3.5" />
            </Button>
          )}
          {selectedElementIds.size > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 ml-1" data-testid="bim-selection-count">
              {selectedElementIds.size} selected
            </Badge>
          )}
        </div>

        {(controlMode === "measure_distance" || controlMode === "measure_area") && (
          <div className="absolute top-12 left-2 z-10 bg-background/90 backdrop-blur-sm rounded-md border p-2 text-xs text-muted-foreground max-w-[220px]" data-testid="bim-measure-hint">
            {controlMode === "measure_distance" ? (
              measurePoints.length === 0
                ? "Click first point on the model to start measuring"
                : "Click second point to complete distance measurement"
            ) : (
              "Click a surface on the model to measure its area"
            )}
          </div>
        )}

        {measurements.length > 0 && (
          <div className="absolute bottom-2 left-2 z-10 bg-background/90 backdrop-blur-sm rounded-md border p-2 space-y-1 max-w-[250px] max-h-40 overflow-auto" data-testid="bim-measurements-list">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Measurements</span>
            {measurements.map(m => (
              <div key={m.id} className="flex items-center justify-between text-xs gap-2">
                <span className="truncate">{m.type === "distance" ? "Distance" : "Area"}: {m.label}</span>
                <Button size="icon" variant="ghost" className="h-4 w-4 shrink-0" onClick={() => clearMeasurement(m.id)} data-testid={`bim-clear-measurement-${m.id}`}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {showActionPanel && selectedElementSummaries.length > 0 && (
          <div className="absolute bottom-2 right-2 z-10 bg-background/95 backdrop-blur-sm rounded-lg border shadow-lg p-3 w-72 max-h-60 overflow-auto" data-testid="bim-action-panel">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Selection Summary</span>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setShowActionPanel(false)} data-testid="bim-close-action-panel">
                <X className="w-3 h-3" />
              </Button>
            </div>
            <div className="space-y-1.5 mb-3">
              {selectedElementSummaries.slice(0, 5).map(el => (
                <div key={el.expressID} className="text-xs border-b border-border/50 pb-1 last:border-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] px-1 shrink-0">{el.type}</Badge>
                    <span className="truncate font-medium">{el.name}</span>
                  </div>
                  {el.material && <span className="text-[10px] text-muted-foreground">Material: {el.material}</span>}
                  <div className="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                    {el.dimensions?.length !== undefined && <span>L: {el.dimensions.length.toFixed(2)}</span>}
                    {el.dimensions?.area !== undefined && <span>A: {el.dimensions.area.toFixed(2)}</span>}
                    {el.dimensions?.volume !== undefined && <span>V: {el.dimensions.volume.toFixed(2)}</span>}
                  </div>
                </div>
              ))}
              {selectedElementSummaries.length > 5 && (
                <div className="text-[10px] text-muted-foreground">...and {selectedElementSummaries.length - 5} more elements</div>
              )}
            </div>
            {onAddToTakeoff && (
              <Button size="sm" className="w-full h-7 text-xs" onClick={handleAddToTakeoff} data-testid="bim-add-to-takeoff">
                <Plus className="w-3 h-3 mr-1" />
                Add to Takeoff ({selectedElementSummaries.length})
              </Button>
            )}
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm" data-testid="bim-loading">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <p className="text-sm font-medium mb-2" data-testid="bim-loading-status">{loadingStatus}</p>
            <div className="w-64">
              <Progress value={progress} className="h-2" data-testid="bim-loading-progress" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{progress}%</p>
          </div>
        )}

        <canvas ref={canvasRef} className="w-full h-full block" data-testid="bim-canvas" />
      </div>

      {showProperties && (
        <div className="w-64 border-l bg-card flex flex-col shrink-0" data-testid="bim-properties-panel">
          <div className="flex items-center justify-between px-2 py-1.5 border-b">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Properties</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowProperties(false)} data-testid="bim-hide-properties">
              <PanelRightClose className="w-3.5 h-3.5" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {elementInfo ? (
              <div className="p-2 space-y-3" data-testid="bim-element-info">
                <div>
                  <p className="text-sm font-semibold break-words" data-testid="bim-element-name">{elementInfo.name}</p>
                  <Badge variant="secondary" className="text-[10px] mt-1" data-testid="bim-element-type">{elementInfo.type}</Badge>
                </div>
                <div className="space-y-1">
                  {elementInfo.properties.map((prop, i) => (
                    <div key={i} className="flex flex-col py-1 border-b border-border/50 last:border-0">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{prop.name}</span>
                      <span className="text-xs break-words" data-testid={`bim-prop-${i}`}>{prop.value || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-center p-4" data-testid="bim-no-selection">
                <Box className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">Click an element in the 3D view or model tree to see its properties</p>
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
