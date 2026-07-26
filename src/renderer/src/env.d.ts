import type { AniStreamBridge } from "../../shared/contracts";

declare global {
  interface Window {
    anistream: AniStreamBridge;
  }
}

export {};

