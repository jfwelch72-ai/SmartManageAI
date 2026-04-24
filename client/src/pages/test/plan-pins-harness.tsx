import { useEffect, useRef, useState } from "react";
import { PlanPinLayer, type PinFilter } from "@/components/PlanPinLayer";

export default function PlanPinsHarnessPage() {
  const [params, setParams] = useState<{
    projectCode: string;
    projectId: string;
    documentId: string;
    pageNumber: number;
    width: number;
    height: number;
    /**
     * Task #1670 — When `?clusterZoom=mock` is set the harness wires a
     * mock `onZoomToCluster` callback into PlanPinLayer so the e2e
     * tests can verify the new "click-cluster-to-zoom" behavior end to
     * end. The mock records each call into a hidden DOM element so
     * tests can assert on cluster centroids and click coordinates.
     */
    clusterZoom: "mock" | "off";
    clusterZoomReturns: boolean;
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
      clusterZoom: q.get("clusterZoom") === "mock" ? "mock" : "off",
      clusterZoomReturns: q.get("clusterZoomReturns") !== "false",
    });
  }, []);

  const callsRef = useRef<HTMLDivElement | null>(null);

  if (!params || !params.projectCode || !params.documentId) {
    return (
      <div className="p-8" data-testid="harness-missing-params">
        Missing required query params: projectCode, projectId, documentId
      </div>
    );
  }

  const filter: PinFilter = { type: "ALL", openOnly: false };

  const onZoomToCluster =
    params.clusterZoom === "mock"
      ? (xFrac: number, yFrac: number, anchorX?: number, anchorY?: number) => {
          if (callsRef.current) {
            const prev = callsRef.current.dataset.calls
              ? JSON.parse(callsRef.current.dataset.calls)
              : [];
            prev.push({ xFrac, yFrac, anchorX, anchorY });
            callsRef.current.dataset.calls = JSON.stringify(prev);
            callsRef.current.dataset.lastXfrac = String(xFrac);
            callsRef.current.dataset.lastYfrac = String(yFrac);
            callsRef.current.dataset.callCount = String(prev.length);
          }
          return params.clusterZoomReturns;
        }
      : undefined;

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
          onZoomToCluster={onZoomToCluster}
        />
      </div>
      <div
        ref={callsRef}
        data-testid="harness-zoom-calls"
        data-call-count="0"
        style={{ display: "none" }}
      />
    </div>
  );
}
