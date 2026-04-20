import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

export type TableDensity = "COMPACT" | "COZY" | "COMFORTABLE";

const STORAGE_KEY = "tableDensity";
const DEFAULT_DENSITY: TableDensity = "COZY";

function readStored(): TableDensity {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "COMPACT" || stored === "COZY" || stored === "COMFORTABLE") return stored;
  } catch {}
  return DEFAULT_DENSITY;
}

interface TableDensityContextValue {
  density: TableDensity;
  setDensity: (d: TableDensity) => void;
  isUpdating: boolean;
}

const TableDensityContext = createContext<TableDensityContextValue>({
  density: DEFAULT_DENSITY,
  setDensity: () => {},
  isUpdating: false,
});

export function TableDensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<TableDensity>(() => readStored());
  const { user: authUser } = useAuth();

  const { data: settings } = useQuery<{ tableDensity?: TableDensity }>({
    queryKey: ["/api/user-settings"],
    staleTime: 60000,
    enabled: !!authUser,
  });

  useEffect(() => {
    const serverDensity = settings?.tableDensity;
    if (serverDensity && (serverDensity === "COMPACT" || serverDensity === "COZY" || serverDensity === "COMFORTABLE")) {
      setDensityState(serverDensity);
      try { localStorage.setItem(STORAGE_KEY, serverDensity); } catch {}
    }
  }, [settings?.tableDensity]);

  const mutation = useMutation({
    mutationFn: async (d: TableDensity) => {
      return await apiRequest("PATCH", "/api/user-settings", { tableDensity: d });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
    },
  });

  const setDensity = useCallback((d: TableDensity) => {
    setDensityState(d);
    try { localStorage.setItem(STORAGE_KEY, d); } catch {}
    if (authUser) {
      mutation.mutate(d);
    }
  }, [authUser, mutation]);

  return (
    <TableDensityContext.Provider value={{ density, setDensity, isUpdating: mutation.isPending }}>
      {children}
    </TableDensityContext.Provider>
  );
}

export function useTableDensity(): TableDensityContextValue {
  return useContext(TableDensityContext);
}

export const TABLE_DENSITY_OPTIONS: { value: TableDensity; label: string; description: string }[] = [
  { value: "COMPACT", label: "Compact", description: "Tightest spacing — fit the most rows on screen" },
  { value: "COZY", label: "Cozy", description: "Balanced spacing (default)" },
  { value: "COMFORTABLE", label: "Comfortable", description: "Generous spacing — easiest to scan" },
];

export const TABLE_DENSITY_ROW_CLASSES: Record<TableDensity, { cell: string; head: string }> = {
  COMPACT: { cell: "px-2 py-1", head: "h-8 px-2" },
  COZY: { cell: "px-3 py-2", head: "h-10 px-3" },
  COMFORTABLE: { cell: "p-4", head: "h-12 px-4" },
};
