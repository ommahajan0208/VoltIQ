"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
const Preferences = createContext({
  reduce: false,
  light: false,
  toggleMotion: () => {},
  toggleTheme: () => {},
});
export const usePreferences = () => useContext(Preferences);
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 30000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [reduce, setReduce] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () =>
      setReduce(
        localStorage.getItem("voltiq-motion") === "reduce" || media.matches,
      );
    sync();
    setLight(localStorage.getItem("voltiq-theme") === "light");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    document.documentElement.dataset.motion = reduce ? "reduce" : "full";
  }, [reduce, light]);
  return (
    <QueryClientProvider client={client}>
      <Preferences.Provider
        value={{
          reduce,
          light,
          toggleMotion: () => {
            localStorage.setItem("voltiq-motion", reduce ? "full" : "reduce");
            setReduce(!reduce);
          },
          toggleTheme: () => {
            localStorage.setItem("voltiq-theme", light ? "dark" : "light");
            setLight(!light);
          },
        }}
      >
        <MotionConfig reducedMotion={reduce ? "always" : "user"}>
          {children}
        </MotionConfig>
      </Preferences.Provider>
    </QueryClientProvider>
  );
}
