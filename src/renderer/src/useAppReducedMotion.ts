import { useReducedMotion } from "framer-motion";
import { resolveReducedMotion } from "./motion";

export function useAppReducedMotion(): boolean {
  return resolveReducedMotion(
    typeof document === "undefined" ? undefined : document.documentElement.dataset.platform,
    useReducedMotion(),
  );
}
