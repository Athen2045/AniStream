export interface AppInfo {
  version: string;
  platform: string;
  databaseReady: boolean;
  videoSourceStatus: "approved-not-implemented" | "configured";
}

export type AniListMediaType = "ANIME" | "MANGA";

export type AniListEntryStatus =
  "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";

export interface AniListProfile {
  id: number;
  name: string;
  about?: string;
  avatarUrl: string;
  bannerUrl?: string;
  siteUrl: string;
  animeCount: number;
  episodesWatched: number;
  minutesWatched: number;
  mangaCount: number;
  chaptersRead: number;
  volumesRead: number;
}

export interface AniListMedia {
  id: number;
  type: AniListMediaType;
  title: string;
  coverUrl: string;
  format?: string;
  status?: string;
  totalProgress?: number;
  totalVolumes?: number;
  siteUrl: string;
}

export interface AniListCatalogMedia extends AniListMedia {
  bannerUrl?: string;
  description?: string;
  genres: string[];
  averageScore?: number;
  popularity?: number;
  season?: string;
  seasonYear?: number;
  nextAiringEpisode?: {
    episode: number;
    airingAt: number;
  };
}

export interface AniListPageInfo {
  currentPage: number;
  perPage: number;
  lastPage: number;
  hasNextPage: boolean;
}

export interface AniListCatalogPage {
  pageInfo: AniListPageInfo;
  items: AniListCatalogMedia[];
}

export interface BrowseAniListInput {
  type: AniListMediaType;
  page: number;
  perPage?: number;
  query?: string;
  sort?: "TRENDING_DESC" | "POPULARITY_DESC" | "SCORE_DESC" | "START_DATE_DESC";
}

export interface AniListNamedPerson {
  id: number;
  name: string;
  imageUrl?: string;
  role?: string;
}

export interface AniListRelation {
  relationType: string;
  media: AniListCatalogMedia;
}

export interface AniListExternalLink {
  site: string;
  url: string;
  type?: string;
}

export interface AniListMediaDetail extends AniListCatalogMedia {
  titleRomaji?: string;
  titleEnglish?: string;
  titleNative?: string;
  synonyms: string[];
  source?: string;
  countryOfOrigin?: string;
  duration?: number;
  startDate?: string;
  endDate?: string;
  studios: string[];
  producers: string[];
  characters: AniListNamedPerson[];
  staff: AniListNamedPerson[];
  relations: AniListRelation[];
  recommendations: AniListCatalogMedia[];
  externalLinks: AniListExternalLink[];
  trailerUrl?: string;
  listEntry?: {
    id: number;
    status: AniListEntryStatus;
    score: number;
    progress: number;
  };
}

export interface AniListEntry {
  id: number;
  status: AniListEntryStatus;
  score: number;
  progress: number;
  progressVolumes?: number;
  repeat: number;
  notes?: string;
  updatedAt: number;
  media: AniListMedia;
}

export interface AniListGroup {
  name: string;
  isCustomList: boolean;
  entries: AniListEntry[];
}

export interface AniListDashboard {
  profile: AniListProfile;
  animeLists: AniListGroup[];
  mangaLists: AniListGroup[];
  fetchedAt: string;
}

export type AniListAuthState =
  | { status: "signed-out" }
  | { status: "authorizing" }
  | { status: "signed-in"; profile: AniListProfile }
  | { status: "error"; message: string };

export interface UpdateAniListEntryInput {
  id: number;
  status?: AniListEntryStatus;
  score?: number;
  progress?: number;
  progressVolumes?: number;
  repeat?: number;
  notes?: string;
}

export interface AniStreamBridge {
  getAppInfo(): Promise<AppInfo>;
  getAniListAuthState(): Promise<AniListAuthState>;
  startAniListLogin(): Promise<void>;
  logoutAniList(): Promise<void>;
  getAniListDashboard(): Promise<AniListDashboard>;
  searchAniList(query: string, type: AniListMediaType): Promise<AniListMedia[]>;
  browseAniList(input: BrowseAniListInput): Promise<AniListCatalogPage>;
  getAniListMediaDetail(id: number, type: AniListMediaType): Promise<AniListMediaDetail>;
  addAniListEntry(mediaId: number): Promise<void>;
  updateAniListEntry(input: UpdateAniListEntryInput): Promise<void>;
  deleteAniListEntry(id: number): Promise<void>;
  onAniListAuthChanged(callback: (state: AniListAuthState) => void): () => void;
}
