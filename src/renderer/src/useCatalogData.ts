import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { AniListMediaType, MangaDexAvailabilityInput } from "../../shared/contracts";
import {
  createCatalogDataModule,
  type CatalogDataModule,
  type CatalogDataSnapshot,
} from "./catalog-data";

export interface UseCatalogDataInput {
  type: AniListMediaType;
  searchQuery: string;
  availabilityMedia: MangaDexAvailabilityInput[];
  trackAvailabilityNow: boolean;
}

export interface CatalogData extends CatalogDataSnapshot {
  setSearchPage(page: number): void;
  setLatestPage(page: number): void;
}

export function useCatalogData(input: UseCatalogDataInput): CatalogData {
  const [controller] = useState<CatalogDataModule>(() => createCatalogDataModule(window.anistream));
  const { availabilityMedia, searchQuery, trackAvailabilityNow, type } = input;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => () => controller.deactivate(), [controller]);
  useLayoutEffect(() => {
    controller.activate({ availabilityMedia, searchQuery, trackAvailabilityNow, type });
  }, [availabilityMedia, controller, searchQuery, trackAvailabilityNow, type]);

  return {
    ...snapshot,
    setSearchPage: controller.setSearchPage,
    setLatestPage: controller.setLatestPage,
  };
}
