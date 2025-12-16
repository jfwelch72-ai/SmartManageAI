import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SelectUser } from "@shared/schema";

interface AuthContextType {
  user: SelectUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<SelectUser | null>;
  logout: () => Promise<void>;
  organizationName: string | null;
  organizationOnboardingStatus: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Fetch current user
  const { data: userData, isLoading } = useQuery<{ user: SelectUser; organizationName: string | null; organizationOnboardingStatus: string | null }>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  const user = userData?.user || null;
  const organizationName = userData?.organizationName || null;
  const organizationOnboardingStatus = userData?.organizationOnboardingStatus || null;

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      return apiRequest("POST", "/api/auth/login", credentials);
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      // Clear welcome modal dismissal keys so new users see the welcome modal
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("smartmanage-welcome-dismissed-")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      
      queryClient.clear();
      window.location.href = "/login";
    },
  });

  const login = async (email: string, password: string): Promise<SelectUser | null> => {
    const response = await loginMutation.mutateAsync({ email, password });
    const data = await response.json();
    // Invalidate and refetch to get fresh user data
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    return data?.user || null;
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, organizationName, organizationOnboardingStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
