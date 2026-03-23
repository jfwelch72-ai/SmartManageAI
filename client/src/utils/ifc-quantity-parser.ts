export interface BimElementGroup {
  ifcType: string;
  displayName: string;
  count: number;
  totalLength: number | null;
  totalArea: number | null;
  totalVolume: number | null;
  materials: string[];
  elements: BimElement[];
}

export interface BimElement {
  expressId: number;
  ifcType: string;
  name: string;
  material: string;
  length: number | null;
  area: number | null;
  volume: number | null;
  properties: Record<string, string | number>;
}

export interface BimExtractionResult {
  groups: BimElementGroup[];
  totalElementCount: number;
  ifcSchema: string;
  fileName: string;
  extractedAt: string;
}

const IFC_TYPE_DISPLAY_NAMES: Record<string, string> = {
  IFCWALL: "Walls",
  IFCWALLSTANDARDCASE: "Walls",
  IFCSLAB: "Slabs",
  IFCBEAM: "Beams",
  IFCCOLUMN: "Columns",
  IFCDOOR: "Doors",
  IFCWINDOW: "Windows",
  IFCROOF: "Roofs",
  IFCSTAIR: "Stairs",
  IFCSTAIRFLIGHT: "Stair Flights",
  IFCRAILING: "Railings",
  IFCCURTAINWALL: "Curtain Walls",
  IFCPLATE: "Plates",
  IFCMEMBER: "Members",
  IFCFOOTING: "Footings",
  IFCPILE: "Piles",
  IFCFLOWSEGMENT: "Pipes/Ducts",
  IFCPIPESEGMENT: "Pipes",
  IFCDUCTSEGMENT: "Ducts",
  IFCFLOWTERMINAL: "Flow Terminals",
  IFCFLOWFITTING: "Flow Fittings",
  IFCPIPEFITTING: "Pipe Fittings",
  IFCDUCTFITTING: "Duct Fittings",
  IFCFURNITURE: "Furniture",
  IFCFURNISHINGELEMENT: "Furnishings",
  IFCCOVERING: "Coverings",
  IFCBUILDINGELEMENTPROXY: "Building Elements",
  IFCOPENINGELEMENT: "Openings",
  IFCSPACE: "Spaces",
};

const BUILDING_ELEMENT_TYPES = new Set([
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCBEAM", "IFCCOLUMN",
  "IFCDOOR", "IFCWINDOW", "IFCROOF", "IFCSTAIR", "IFCSTAIRFLIGHT",
  "IFCRAILING", "IFCCURTAINWALL", "IFCPLATE", "IFCMEMBER", "IFCFOOTING",
  "IFCPILE", "IFCFLOWSEGMENT", "IFCPIPESEGMENT", "IFCDUCTSEGMENT",
  "IFCFLOWTERMINAL", "IFCFLOWFITTING", "IFCPIPEFITTING", "IFCDUCTFITTING",
  "IFCFURNITURE", "IFCFURNISHINGELEMENT", "IFCCOVERING",
  "IFCBUILDINGELEMENTPROXY", "IFCSPACE",
]);

function getDisplayName(ifcType: string): string {
  const upper = ifcType.toUpperCase();
  return IFC_TYPE_DISPLAY_NAMES[upper] || ifcType.replace(/^IFC/i, "").replace(/([A-Z])/g, " $1").trim();
}

function extractQuantityValue(props: any, key: string): number | null {
  if (!props) return null;
  const val = props[key];
  if (val !== undefined && val !== null) {
    const num = typeof val === "object" && val.value !== undefined ? val.value : val;
    const parsed = Number(num);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function parseIfcFile(
  fileArrayBuffer: ArrayBuffer,
  fileName: string,
  onProgress?: (pct: number) => void,
): Promise<BimExtractionResult> {
  const { IfcAPI } = await import("web-ifc");
  const ifcApi = new IfcAPI();
  ifcApi.SetWasmPath("/web-ifc/");
  await ifcApi.Init();

  onProgress?.(10);

  const data = new Uint8Array(fileArrayBuffer);
  const modelID = ifcApi.OpenModel(data);

  try {
    onProgress?.(30);

    const elementsByType = new Map<string, BimElement[]>();
    let totalCount = 0;

    let allTypes: any[] = [];
    try {
      allTypes = ifcApi.GetAllTypesOfModel(modelID) || [];
    } catch {
      allTypes = [];
    }

    const relevantTypeIds: number[] = [];
    const typeIdToName = new Map<number, string>();

    for (const entry of allTypes) {
      const typeName = (entry as any).typeName || (entry as any).typeString || "";
      const typeId = (entry as any).typeID || (entry as any).type;
      if (typeName && typeof typeId === "number" && BUILDING_ELEMENT_TYPES.has(typeName.toUpperCase())) {
        relevantTypeIds.push(typeId);
        typeIdToName.set(typeId, typeName.toUpperCase());
      }
    }

    onProgress?.(40);

    for (const typeId of relevantTypeIds) {
      const typeName = typeIdToName.get(typeId) || "UNKNOWN";

      let elementIds: any;
      try {
        elementIds = ifcApi.GetLineIDsWithType(modelID, typeId);
      } catch {
        continue;
      }

      if (!elementIds || elementIds.size() === 0) continue;

      for (let i = 0; i < elementIds.size(); i++) {
        const expressId = elementIds.get(i);
        let props: any = {};
        try {
          props = ifcApi.GetLine(modelID, expressId, true);
        } catch {
          continue;
        }

        const name = props?.Name?.value || props?.Name || `${typeName} #${expressId}`;
        let material = "Unknown";

        try {
          const matRelations = ifcApi.GetLineIDsWithType(modelID, 2655215786);
          if (matRelations) {
            for (let m = 0; m < matRelations.size(); m++) {
              const rel = ifcApi.GetLine(modelID, matRelations.get(m), false);
              if (rel?.RelatedObjects) {
                const relatedIds = Array.isArray(rel.RelatedObjects)
                  ? rel.RelatedObjects.map((r: any) => r?.value || r)
                  : [];
                if (relatedIds.includes(expressId)) {
                  const mat = rel.RelatingMaterial;
                  if (mat?.value) {
                    try {
                      const matLine = ifcApi.GetLine(modelID, mat.value, false);
                      material = matLine?.Name?.value || matLine?.Name || "Unknown";
                    } catch {}
                  }
                  break;
                }
              }
            }
          }
        } catch {}

        let length: number | null = null;
        let area: number | null = null;
        let volume: number | null = null;

        try {
          const qtoRelations = ifcApi.GetLineIDsWithType(modelID, 1883228015);
          if (qtoRelations) {
            for (let q = 0; q < qtoRelations.size(); q++) {
              const rel = ifcApi.GetLine(modelID, qtoRelations.get(q), true);
              if (rel?.RelatedObjects) {
                const relatedIds = Array.isArray(rel.RelatedObjects)
                  ? rel.RelatedObjects.map((r: any) => r?.value || r)
                  : [];
                if (relatedIds.includes(expressId)) {
                  const qto = rel.RelatingPropertyDefinition;
                  if (qto?.value) {
                    try {
                      const qtoLine = ifcApi.GetLine(modelID, qto.value, true);
                      if (qtoLine?.Quantities) {
                        for (const qty of qtoLine.Quantities) {
                          const qtyLine = typeof qty === "object" && qty.value
                            ? ifcApi.GetLine(modelID, qty.value, false)
                            : qty;
                          const qtyName = (qtyLine?.Name?.value || "").toLowerCase();
                          if (qtyName.includes("length") || qtyName.includes("height")) {
                            length = extractQuantityValue(qtyLine, "LengthValue") ?? extractQuantityValue(qtyLine, "NominalValue");
                          }
                          if (qtyName.includes("area") || qtyName.includes("surface")) {
                            area = extractQuantityValue(qtyLine, "AreaValue") ?? extractQuantityValue(qtyLine, "NominalValue");
                          }
                          if (qtyName.includes("volume")) {
                            volume = extractQuantityValue(qtyLine, "VolumeValue") ?? extractQuantityValue(qtyLine, "NominalValue");
                          }
                        }
                      }
                    } catch {}
                  }
                }
              }
            }
          }
        } catch {}

        const displayType = IFC_TYPE_DISPLAY_NAMES[typeName] || typeName;
        const groupKey = displayType;

        if (!elementsByType.has(groupKey)) {
          elementsByType.set(groupKey, []);
        }

        elementsByType.get(groupKey)!.push({
          expressId,
          ifcType: typeName,
          name: String(name),
          material: String(material),
          length,
          area,
          volume,
          properties: {},
        });

        totalCount++;
      }
    }

    onProgress?.(80);

    const groups: BimElementGroup[] = [];
    for (const [displayName, elements] of elementsByType) {
      const materials = [...new Set(elements.map(e => e.material).filter(m => m !== "Unknown"))];
      const totalLength = elements.reduce((sum, e) => sum + (e.length || 0), 0) || null;
      const totalArea = elements.reduce((sum, e) => sum + (e.area || 0), 0) || null;
      const totalVolume = elements.reduce((sum, e) => sum + (e.volume || 0), 0) || null;

      groups.push({
        ifcType: elements[0].ifcType,
        displayName,
        count: elements.length,
        totalLength: totalLength && totalLength > 0 ? Math.round(totalLength * 100) / 100 : null,
        totalArea: totalArea && totalArea > 0 ? Math.round(totalArea * 100) / 100 : null,
        totalVolume: totalVolume && totalVolume > 0 ? Math.round(totalVolume * 100) / 100 : null,
        materials,
        elements,
      });
    }

    groups.sort((a, b) => b.count - a.count);

    onProgress?.(100);

    return {
      groups,
      totalElementCount: totalCount,
      ifcSchema: "IFC2X3",
      fileName,
      extractedAt: new Date().toISOString(),
    };
  } finally {
    try {
      ifcApi.CloseModel(modelID);
    } catch {}
  }
}

export function computeExtractionDiff(
  previous: BimExtractionResult,
  current: BimExtractionResult,
): BimExtractionDiff {
  const prevMap = new Map(previous.groups.map(g => [g.displayName, g]));
  const currMap = new Map(current.groups.map(g => [g.displayName, g]));

  const added: BimElementGroup[] = [];
  const removed: BimElementGroup[] = [];
  const changed: BimElementGroupChange[] = [];
  const unchanged: BimElementGroup[] = [];

  for (const [name, group] of currMap) {
    const prev = prevMap.get(name);
    if (!prev) {
      added.push(group);
    } else {
      const countDiff = group.count - prev.count;
      const areaDiff = (group.totalArea || 0) - (prev.totalArea || 0);
      const volumeDiff = (group.totalVolume || 0) - (prev.totalVolume || 0);
      const lengthDiff = (group.totalLength || 0) - (prev.totalLength || 0);

      if (countDiff !== 0 || Math.abs(areaDiff) > 0.01 || Math.abs(volumeDiff) > 0.01 || Math.abs(lengthDiff) > 0.01) {
        changed.push({
          group,
          previousGroup: prev,
          countDiff,
          areaDiff: Math.round(areaDiff * 100) / 100,
          volumeDiff: Math.round(volumeDiff * 100) / 100,
          lengthDiff: Math.round(lengthDiff * 100) / 100,
        });
      } else {
        unchanged.push(group);
      }
    }
  }

  for (const [name, group] of prevMap) {
    if (!currMap.has(name)) {
      removed.push(group);
    }
  }

  return { added, removed, changed, unchanged };
}

export interface BimElementGroupChange {
  group: BimElementGroup;
  previousGroup: BimElementGroup;
  countDiff: number;
  areaDiff: number;
  volumeDiff: number;
  lengthDiff: number;
}

export interface BimExtractionDiff {
  added: BimElementGroup[];
  removed: BimElementGroup[];
  changed: BimElementGroupChange[];
  unchanged: BimElementGroup[];
}
