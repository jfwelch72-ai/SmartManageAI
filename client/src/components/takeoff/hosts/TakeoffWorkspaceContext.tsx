import {
  createContext,
  useContext,
  type ComponentProps,
  type Context,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { TakeoffToolbarProps } from "../TakeoffToolbar";
import type { TakeoffSidebar } from "../TakeoffSidebar";
import type { TakeoffDialogs } from "../TakeoffDialogs";
import type { TakeoffVersionHistory } from "../TakeoffVersionHistory";
import type { TakeoffSheetCompareDialog } from "../TakeoffSheetCompareDialog";
import type { PlanScaleModal } from "../PlanScaleModal";
import type TakeoffCrossModulePanel from "../TakeoffCrossModulePanel";
import type { PageThumbnailStrip } from "../PageThumbnailStrip";
import type { IssueDetailPanel } from "../IssueDetailPanel";
import type { TakeoffPropertiesPanel } from "../TakeoffPropertiesPanel";
import type AiTakeoffPanel from "@/components/AiTakeoffPanel";
import type { ToolChestPanel } from "../ToolChestPanel";
import type { CanvasStageProps } from "./CanvasStage";
import type { SheetSelectorBarProps } from "./SheetSelectorBar";
import type { CanvasViewportProps } from "./CanvasViewport";
import type { WorkspaceBottomBarProps } from "./WorkspaceBottomBar";
import type { MeasurementTablePanelProps } from "./MeasurementTablePanel";
import type { MarkupStylingPanelProps } from "./MarkupStylingPanel";

export interface RibbonContextSlice {
  activeTool: TakeoffToolbarProps["activeTool"];
  handleToolSelect: TakeoffToolbarProps["onToolSelect"];
  stageScale: number;
  setStageScale: Dispatch<SetStateAction<number>>;
  selectedMeasurementId: string | null;
  measurements: TakeoffToolbarProps["measurements"];
  deleteMeasurementMutation: {
    mutate: (m: TakeoffToolbarProps["measurements"][number]) => void;
    isPending: boolean;
  };
  takeoffHistory: TakeoffToolbarProps["takeoffHistory"];
  snapEnabled: boolean;
  setSnapEnabled: Dispatch<SetStateAction<boolean>>;
  orthoLock: boolean;
  setOrthoLock: Dispatch<SetStateAction<boolean>>;
  onUpload: () => void;
  aiPanelOpen: boolean;
  setAiPanelOpen: Dispatch<SetStateAction<boolean>>;
  mobileMeasurementsOpen: boolean;
  setMobileMeasurementsOpen: Dispatch<SetStateAction<boolean>>;
  isDrawing: boolean;
  drawingPoints: { x: number; y: number }[];
  isMobile: boolean;
  markupColor: string;
  setMarkupColor: Dispatch<SetStateAction<string>>;
  markupThickness: number;
  setMarkupThickness: Dispatch<SetStateAction<number>>;
  handleExportCurrentSheet: () => void;
  handleExportAllSheets: () => void;
  handleExportQuantityDelta: () => void;
  handleExportBidPackage: () => void;
  handlePrintSheet: () => void;
  isOffline: boolean;
  onShowShortcuts: () => void;
  sheetRotation: number;
  onRotateCW: () => void;
  onRotateCCW: () => void;
  onRotate180: () => void;
  gridEnabled: boolean;
  handleToggleGrid: (v: boolean) => void;
  isCalibrated: boolean;
  onFitToPage: () => void;
  showMeasurementLabels: boolean;
  onToggleMeasurementLabels: (v: boolean) => void;
  showStructuralGridlines: boolean;
  setShowStructuralGridlines: Dispatch<SetStateAction<boolean>>;
  labeled: boolean;
  /** Tool Chest panel toggle (Task #2139). Surfaced in the View ribbon
   *  group so the chest can mount alongside the other panel hosts. */
  toolChestOpen: boolean;
  onToggleToolChest: () => void;
  /** Right-click → "Pin to Tool Chest" affordance for tool buttons in
   *  the Measure / Annotate ribbon groups. */
  onPinToolToChest: (input: { toolId: string; label: string }) => void;
}

export interface SheetContextSlice {
  isViewingLockedVersion: boolean;
  onReturnToDraft: () => void;
  detectedScale: { label: string; pxPerFoot: number; units: string } | null;
  hasCurrentSheetScale: boolean;
  onAcceptDetectedScale: () => void;
  onDismissDetectedScale: () => void;
  showStaleBanner: boolean;
  staleCanvasItemCount: number;
  onRepinStaleCanvas: () => void;
  isRepinPending: boolean;
  onDismissStaleBanner: () => void;
  currentSheetIsSuperseded: boolean;
  hasCompareNewSheet: boolean;
  onOpenCompareDialog: () => void;
  /** Sheet header toolbar (selector, sheet-actions menu, calibration badge,
   *  auto-import / version / properties / scale / shortcuts / cross-module
   *  / fullscreen). Always present; SheetHost mounts CollabHost inside it
   *  via the bar's `collabSlot` prop. */
  selectorBar: SheetSelectorBarProps;
  /** Optional horizontal page-thumbnail strip directly below the bar. */
  thumbnailStrip: ComponentProps<typeof PageThumbnailStrip> | null;
  /** Compare-revisions dialog — moved here from PanelContextSlice so the
   *  sheet host owns its full sheet-management UI. */
  compareDialog: ComponentProps<typeof TakeoffSheetCompareDialog> | null;
}
/**
 * CanvasContextSlice — `stage` holds every input the Konva Stage tree
 * needs (aliased to CanvasStageProps); `viewport` holds the props for
 * the canvas surface (container div + DOM overlays: calibration banner,
 * mobile drawing bar, gesture guide, sheet tabs, status bar, drawing
 * guide, condition quick bar, markup text input, create-link panel,
 * context menus, live cost panel, overlay opacity slider, empty state).
 * Lives in its own React context so canvas re-renders don't touch
 * ribbon/sheet/panel/collab consumers (real render isolation).
 */
export interface CanvasContextSlice {
  stage: CanvasStageProps;
  viewport: Omit<CanvasViewportProps, "stageSlot">;
}

/**
 * PanelContextSlice — pre-built props for every component PanelHost
 * renders. We type each field with `ComponentProps<typeof X>` so the
 * slice stays in lock-step with the wrapped component's contract;
 * adding a prop to (e.g.) TakeoffSidebar is a compile error here until
 * the orchestrator supplies it.
 */
export interface PanelContextSlice {
  versionHistory: ComponentProps<typeof TakeoffVersionHistory>;
  sidebar: ComponentProps<typeof TakeoffSidebar>;
  dialogs: ComponentProps<typeof TakeoffDialogs>;
  scaleModal: ComponentProps<typeof PlanScaleModal>;
  /** Right-edge cross-module overlay; the visibility / overlay-styling
   *  flags live here so the host can reproduce the original conditional
   *  mount without reaching into ribbon/canvas state. */
  crossModulePanel: {
    visible: boolean;
    isDrawing: boolean;
    isMobile: boolean;
    props: ComponentProps<typeof TakeoffCrossModulePanel>;
  };
  bidPackage: {
    open: boolean;
    setOpen: (v: boolean) => void;
    tradeScope: string;
    setTradeScope: (s: string) => void;
    onConfirm: () => void;
  };
  /** Bottom batch-action bar + workspace status bar. */
  bottomBar: WorkspaceBottomBarProps;
  /** Bottom measurement table panel (visibility + table data). */
  measurementTable: MeasurementTablePanelProps;
  /** Right-side issue detail panel (null when no issue is selected). */
  issueDetail: ComponentProps<typeof IssueDetailPanel> | null;
  /** AI takeoff right-side panel container. `visible` controls the
   *  outer container; the AI panel itself renders inside it. */
  aiPanel: {
    visible: boolean;
    isDrawing: boolean;
    isMobile: boolean;
    props: ComponentProps<typeof AiTakeoffPanel>;
  } | null;
  /** Markup styling popover (color/thickness/text + delete + save). */
  markupStylingPanel: MarkupStylingPanelProps;
  /** Right-side measurement properties panel (null when no measurement
   *  is selected or the panel is closed). */
  propertiesPanel: ComponentProps<typeof TakeoffPropertiesPanel> | null;
  /** Tool Chest left-side panel (Task #2139). Always present so the
   *  panel can mount on demand; the component reads `open` to decide
   *  whether to render. */
  toolChest: ComponentProps<typeof ToolChestPanel>;
}

export interface CollabCollaborator {
  userId: string;
  userName: string;
  userColor: string;
  currentSheetId?: string | null;
}

export interface CollabSheetLock {
  userId: string;
  userName: string;
}

export interface CollabSheetLockToggle {
  /** Whether the toggle button should mount at all (matches the original
   *  `selectedSheet && collab.collaborators.length > 0` guard). */
  visible: boolean;
  /** True when the current user already holds the lock — flips the
   *  variant + label between "Lock" and "Unlock". */
  ownedByMe: boolean;
  onToggle: () => void;
}

export interface CollabContextSlice {
  collaborators: CollabCollaborator[];
  currentSheetLock: CollabSheetLock | null;
  connected: boolean;
  hasRoom: boolean;
  sheetNameById: (sheetId: string) => string | null;
  /** "I'm working here" sheet-lock toggle button — lives in the sheet
   *  selector bar's right-side cluster between the properties button
   *  and the hide-resolved switch. */
  sheetLockToggle: CollabSheetLockToggle;
}

export interface TakeoffWorkspaceContextValue {
  ribbon: RibbonContextSlice;
  sheet: SheetContextSlice;
  canvas: CanvasContextSlice;
  panel: PanelContextSlice;
  collab: CollabContextSlice;
}

const RibbonContext = createContext<RibbonContextSlice | null>(null);
const SheetContext = createContext<SheetContextSlice | null>(null);
const CanvasContext = createContext<CanvasContextSlice | null>(null);
const PanelContext = createContext<PanelContextSlice | null>(null);
const CollabContext = createContext<CollabContextSlice | null>(null);

export interface TakeoffWorkspaceProviderProps {
  value: TakeoffWorkspaceContextValue;
  children: ReactNode;
}

/**
 * Per-slice providers. The orchestrator memoizes each slice
 * independently so a state change in one slice does NOT change the
 * `Provider value` of another slice — that gives real render
 * isolation: a canvas re-render does not rerender ribbon/panel
 * consumers.
 */
export function TakeoffWorkspaceProvider({ value, children }: TakeoffWorkspaceProviderProps) {
  return (
    <RibbonContext.Provider value={value.ribbon}>
      <SheetContext.Provider value={value.sheet}>
        <CanvasContext.Provider value={value.canvas}>
          <PanelContext.Provider value={value.panel}>
            <CollabContext.Provider value={value.collab}>{children}</CollabContext.Provider>
          </PanelContext.Provider>
        </CanvasContext.Provider>
      </SheetContext.Provider>
    </RibbonContext.Provider>
  );
}

function useSlice<T>(ctx: Context<T | null>, hostName: string): T {
  const v = useContext(ctx);
  if (v === null) {
    throw new Error(`${hostName} must be rendered inside <TakeoffWorkspaceProvider>.`);
  }
  return v;
}

export function useRibbonContext(): RibbonContextSlice {
  return useSlice(RibbonContext, "RibbonHost");
}
export function useSheetContext(): SheetContextSlice {
  return useSlice(SheetContext, "SheetHost");
}
export function useCanvasContext(): CanvasContextSlice {
  return useSlice(CanvasContext, "CanvasHost");
}
export function usePanelContext(): PanelContextSlice {
  return useSlice(PanelContext, "PanelHost");
}
export function useCollabContext(): CollabContextSlice {
  return useSlice(CollabContext, "CollabHost");
}
