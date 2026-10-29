import {
  BookOpen,
  Bug,
  CalendarDays,
  Download,
  Film,
  ListVideo,
  RefreshCw,
  Search,
  Settings,
  Tv,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useAppPreferences } from "./app-preferences";
import { useBinge } from "./BingeProvider";
import { useDownloads } from "./DownloadsProvider";
import { SideRail } from "./SideRail";

/** Bug reports go to the project's GitHub issues for now (user request 2026-10-09). */
const BUG_REPORT_URL = "https://github.com/Athen2045/AniStream/issues";

export type AppView =
  | "ANIME"
  | "MANGA"
  | "MORE"
  | "PROFILE"
  | "SEARCH"
  | "SETTINGS"
  | "SCHEDULE"
  | "UPNEXT"
  | "DOWNLOADS";

/**
 * The app's side rail: the sections, the Schedule / Up Next / Downloads tools (with their badge
 * counts) and the account rows. Schedule and Up Next follow Settings → Customize.
 */
export function AppRail({
  view,
  reducedMotion,
  account,
  libraryRefresh,
  onHome,
  onSearch,
  onCatalog,
  onMore,
  onSchedule,
  onUpNext,
  onDownloads,
  onProfile,
  onSettings,
}: {
  view: AppView;
  reducedMotion: boolean;
  /** The profile row: the signed-in name and picture, or "Sign in". */
  account: { label: string; imageUrl?: string; signedIn: boolean };
  /** An AniList member's Refresh library row; absent for guests. */
  libraryRefresh?: { busy: boolean; onRefresh: () => void };
  onHome: () => void;
  onSearch: () => void;
  onCatalog: (type: "ANIME" | "MANGA") => void;
  onMore: () => void;
  onSchedule: () => void;
  onUpNext: () => void;
  onDownloads: () => void;
  onProfile: () => void;
  onSettings: () => void;
}): React.JSX.Element {
  const preferences = useAppPreferences();
  const { state: binge } = useBinge();
  const { state: downloads } = useDownloads();
  const upNextCount = binge.queue.length;
  const downloadsPending =
    downloads?.items.filter((item) => item.status === "downloading" || item.status === "queued")
      .length ?? 0;
  const [refreshSpinning, setRefreshSpinning] = useState(false);
  return (
    <SideRail
      reducedMotion={reducedMotion}
      onHome={onHome}
      sections={[
        {
          key: "search",
          label: "Search",
          icon: Search,
          active: view === "SEARCH",
          ariaLabel: view === "SEARCH" ? "Close search" : "Search",
          title: "Search (Ctrl+K)",
          onSelect: onSearch,
        },
        {
          key: "anime",
          label: "Anime",
          icon: Tv,
          active: view === "ANIME",
          onSelect: () => onCatalog("ANIME"),
        },
        {
          key: "manga",
          label: "Manga",
          icon: BookOpen,
          active: view === "MANGA",
          onSelect: () => onCatalog("MANGA"),
        },
        {
          key: "more",
          label: "More",
          icon: Film,
          active: view === "MORE",
          onSelect: onMore,
        },
      ]}
      tools={[
        ...(preferences.schedule
          ? [
              {
                key: "schedule",
                label: "Schedule",
                icon: CalendarDays,
                active: view === "SCHEDULE",
                title: "Airing schedule",
                onSelect: onSchedule,
              },
            ]
          : []),
        ...(preferences.upNext
          ? [
              {
                key: "upnext",
                label: "Up Next",
                icon: ListVideo,
                active: view === "UPNEXT",
                badge: upNextCount,
                ariaLabel: upNextCount ? `Up Next, ${upNextCount} queued` : "Up Next",
                title: "Up Next and playlists",
                onSelect: onUpNext,
              },
            ]
          : []),
        {
          key: "downloads",
          label: "Downloads",
          icon: Download,
          active: view === "DOWNLOADS",
          badge: downloadsPending,
          ariaLabel: downloadsPending ? `Downloads, ${downloadsPending} in progress` : "Downloads",
          onSelect: onDownloads,
        },
      ]}
      footer={[
        ...(libraryRefresh
          ? [
              {
                key: "refresh",
                label: "Refresh library",
                icon: RefreshCw,
                disabled: libraryRefresh.busy || refreshSpinning,
                iconClassName: refreshSpinning ? "refresh-spin-once" : undefined,
                onIconAnimationEnd: () => setRefreshSpinning(false),
                onSelect: () => {
                  if (!reducedMotion) setRefreshSpinning(true);
                  libraryRefresh.onRefresh();
                },
              },
            ]
          : []),
        {
          key: "report-bug",
          label: "Report a bug",
          icon: Bug,
          title: "Report a bug on GitHub",
          onSelect: () => void window.anistream.openLink(BUG_REPORT_URL),
        },
        {
          key: "profile",
          label: account.label,
          icon: UserRound,
          imageUrl: account.imageUrl,
          active: view === "PROFILE",
          ariaLabel: account.signedIn ? "Your profile" : "Sign in",
          onSelect: onProfile,
        },
        {
          key: "settings",
          label: "Settings",
          icon: Settings,
          active: view === "SETTINGS",
          onSelect: onSettings,
        },
      ]}
    />
  );
}
