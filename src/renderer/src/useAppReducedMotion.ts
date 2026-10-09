import { useReducedMotion } from "framer-motion";
import { useAppPreferences } from "./app-preferences";
import { resolveReducedMotion } from "./motion";

export function useAppReducedMotion(): boolean {
  const { reduceMotion } = useAppPreferences();
  const system = resolveReducedMotion(
    typeof document === "undefined" ? undefined : document.documentElement.dataset.platform,
    useReducedMotion(),
  );
  // The Settings choice applies on every platform, including Windows.
  return reduceMotion || system;
}
