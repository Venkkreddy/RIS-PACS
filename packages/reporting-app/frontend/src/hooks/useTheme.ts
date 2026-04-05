import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

export function useTheme() {
  const [theme] = useState<ThemeMode>("light");
  const isDark = false;

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  const toggleTheme = () => {};
  const setTheme = (_t: ThemeMode) => {};

  return { theme, isDark, setTheme, toggleTheme };
}
