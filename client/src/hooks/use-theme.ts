import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    return stored || "system";
  });

  const { data: settings } = useQuery<{ themePreference?: string }>({
    queryKey: ["/api/user-settings"],
    staleTime: 60000,
  });

  useEffect(() => {
    if (settings?.themePreference) {
      const pref = settings.themePreference as Theme;
      setThemeState(pref);
      localStorage.setItem("theme", pref);
    }
  }, [settings?.themePreference]);

  useEffect(() => {
    applyTheme(theme);
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") applyTheme("system");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("theme", newTheme);
    applyTheme(newTheme);
  }, []);

  return { theme, setTheme };
}
