import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { AniListMediaType, MangaDexAvailabilityInput } from "../../shared/contracts";
import {
  createCatalogDataModule,
  type CatalogDataModule,
  type CatalogDataSnapshot,
} from "./catalog-data";

export interface UseCatalogDataInput {
  type: AniListMediaType;
  availabilityMedia: MangaDexAvailabilityInput[];
  trackAvailabilityNow: boolean;
  /** Load the Latest Updates grid (default true). */
  latest?: boolean;
}

export interface CatalogData extends CatalogDataSnapshot {
  setLatestPage(page: number): void;
}

export function useCatalogData(input: UseCatalogDataInput): CatalogData {
  const [controller] = useState<CatalogDataModule>(() => createCatalogDataModule(window.anistream));
  const { availabilityMedia, trackAvailabilityNow, type, latest = true } = input;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => () => controller.deactivate(), [controller]);
  useLayoutEffect(() => {
    controller.activate({ availabilityMedia, trackAvailabilityNow, type, latest });
  }, [availabilityMedia, controller, trackAvailabilityNow, type, latest]);

  return {
    ...snapshot,
    setLatestPage: controller.setLatestPage,
  };
}
