export interface LibraryItemApplyEvent {
  type: "APPLY_LIBRARY_ITEM";
  item: {
    name: string;
    itemNumber?: string;
    unitOfMeasure: string;
    unitCost?: number;
    costCodeId?: string;
    costTypes?: string[];
  };
}

export interface LibraryAssemblyApplyEvent {
  type: "APPLY_LIBRARY_ASSEMBLY";
  assembly: {
    id: string;
    name: string;
    assemblyNumber?: string;
    unitOfMeasure: string;
    items: Array<{
      name: string;
      formula: string;
      wasteFactor?: number;
      unitCost?: string;
      unit?: string;
      itemId?: string | null;
    }>;
  };
}

export interface SavedTakeoffLoadEvent {
  type: "LOAD_SAVED_TAKEOFF";
  takeoff: {
    id: string;
    name: string;
    measurementData: any;
  };
}

export type LibraryEvent = LibraryItemApplyEvent | LibraryAssemblyApplyEvent | SavedTakeoffLoadEvent;

const LIBRARY_EVENT_NAME = "library-takeoff-event";

export function dispatchLibraryEvent(event: LibraryEvent) {
  window.dispatchEvent(new CustomEvent(LIBRARY_EVENT_NAME, { detail: event }));
}

export function onLibraryEvent(handler: (event: LibraryEvent) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<LibraryEvent>).detail);
  };
  window.addEventListener(LIBRARY_EVENT_NAME, listener);
  return () => window.removeEventListener(LIBRARY_EVENT_NAME, listener);
}
