import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  const toggleTheme = () => {
    const newTheme = resolved === "light" ? "dark" : "light";
    setTheme(newTheme);
    apiRequest("PATCH", "/api/user-settings", { themePreference: newTheme })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] }))
      .catch(() => {});
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      data-testid="button-theme-toggle"
    >
      {resolved === "light" ? (
        <Moon className="w-5 h-5" />
      ) : (
        <Sun className="w-5 h-5" />
      )}
    </Button>
  );
}
