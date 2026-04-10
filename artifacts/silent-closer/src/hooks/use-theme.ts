import { useState, useEffect } from "react";

const THEME_KEY = "cw_theme";
type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: Theme) {
  if (theme === "light") {
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      applyTheme(next);
      return next;
    });
  };

  return { theme, toggleTheme };
}
