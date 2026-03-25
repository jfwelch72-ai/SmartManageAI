import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function handleGlobal401(url: string) {
  if (url.includes("/api/auth/me")) return;
  queryClient.setQueryData(["/api/auth/me"], null);
  if (!window.location.pathname.startsWith("/login") &&
      !window.location.pathname.startsWith("/register") &&
      !window.location.pathname.startsWith("/forgot-password") &&
      !window.location.pathname.startsWith("/reset-password") &&
      !window.location.pathname.startsWith("/portal/") &&
      !window.location.pathname.startsWith("/sub-portal")) {
    window.location.href = "/login";
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 401) {
    handleGlobal401(url);
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
function buildUrlFromQueryKey(queryKey: readonly unknown[]): string {
  const pathParts: string[] = [];
  const params = new URLSearchParams();

  for (const part of queryKey) {
    if (typeof part === "string" || typeof part === "number") {
      pathParts.push(String(part));
    } else if (part && typeof part === "object" && !Array.isArray(part)) {
      for (const [key, value] of Object.entries(part as Record<string, unknown>)) {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      }
    }
  }

  const url = pathParts.join("/");
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = buildUrlFromQueryKey(queryKey);
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.status === 401) {
      handleGlobal401(url);
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const bidEstimateKey = (bidId?: string) => 
  bidId ? ["/api/bids", bidId, "estimate"] : ["/api/bids"];

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const url = buildUrlFromQueryKey(queryKey);
        const res = await fetch(url, {
          credentials: "include",
        });

        if (res.status === 401 && url.includes("/api/auth/me")) {
          return null;
        }

        if (res.status === 401) {
          handleGlobal401(url);
        }

        await throwIfResNotOk(res);
        return await res.json();
      },
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
