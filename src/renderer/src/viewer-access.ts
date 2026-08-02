import type { AniListCatalogMedia, AniListDashboard, AniListEntry } from "../../shared/contracts";

export type ViewerAccess =
  | { kind: "guest" }
  | {
      kind: "member";
      dashboard: AniListDashboard;
      libraryEntries: ReadonlyMap<number, AniListEntry>;
      addToLibrary(media: AniListCatalogMedia): Promise<void>;
      removeFromLibrary(entry: AniListEntry): Promise<void>;
      refreshLibrary(): Promise<void>;
    };

export function hasPersonalizedAccess(
  access: ViewerAccess,
): access is Extract<ViewerAccess, { kind: "member" }> {
  return access.kind === "member";
}

export function mediaDetailInstanceKey(
  media: Pick<AniListCatalogMedia, "id" | "type">,
  access: ViewerAccess,
): string {
  const viewerIdentity =
    access.kind === "member" ? `member-${access.dashboard.profile.id}` : "guest";
  return `${media.type}:${media.id}:${viewerIdentity}`;
}
