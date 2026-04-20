import { useEffect, useState } from "react";
import { PlanPinLayer, type PinFilter } from "@/components/PlanPinLayer";

export default function PlanPinsHarnessPage() {
  const [params, setParams] = useState<{
    projectCode: string;
    projectId: string;
    documentId: string;
    pageNumber: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setParams({
      projectCode: q.get("projectCode") || "",
      projectId: q.get("projectId") || "",
      documentId: q.get("documentId") || "",
      pageNumber: parseInt(q.get("pageNumber") || "1", 10),
      width: parseInt(q.get("width") || "800", 10),
      height: parseInt(q.get("height") || "600", 10),
    });
  }, []);

  if (!params || !params.projectCode || !params.documentId) {
    return (
      <div className="p-8" data-testid="harness-missing-params">
        Missing required query params: projectCode, projectId, documentId
      </div>
    );
  }

  const filter: PinFilter = { type: "ALL", openOnly: false };

  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold mb-2">Plan Pin Harness (DEV)</h1>
      <div
        id="harness-page"
        data-testid="harness-page"
        style={{
          position: "relative",
          width: `${params.width}px`,
          height: `${params.height}px`,
          background: "#f3f4f6",
          border: "1px solid #d1d5db",
          overflow: "hidden",
        }}
      >
        <PlanPinLayer
          projectCode={params.projectCode}
          projectId={params.projectId}
          documentId={params.documentId}
          pageNumber={params.pageNumber}
          filter={filter}
        />
      </div>
    </div>
  );
}
