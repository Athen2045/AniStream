import {
  BookOpen,
  Database,
  FolderOpen,
  Heart,
  MonitorPlay,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { PersonalizationSettings, SimklStatus } from "../../shared/contracts";
import type { TasteMap } from "../../shared/taste-map";
import { cachedArtworkUrl } from "../../shared/artwork";
import { SourceLogo } from "./SourceLogo";
import { ProfileLookDialog } from "./ProfileLookDialog";
import { pictureGradient } from "./ProfileHeroBand";
import {
  chooseHero,
  choosePicture,
  setProfileLook,
  useProfileHeroImage,
  useProfileLook,
  usePicturePalette,
  useSimklStatus,
} from "./profile-look";
import type { ReaderSettings } from "../../shared/reader-settings";
import { AppUpdates } from "./AppUpdates";
import { LocalDataSettings } from "./LocalDataSettings";
import { Select } from "./Select";
import { saveHiddenTags, useHiddenTagNames } from "./hidden-tags";
import { MORE_GENRES } from "../../shared/more-filters";
import { setAppPreference, useAppPreferences } from "./app-preferences";
import { useOptionalBinge } from "./BingeProvider";
import { createReaderSettingsSession } from "./reader-settings-session";
import type { ViewerAccess } from "./viewer-access";
import { TasteMapDialog } from "./TasteMapDialog";
import { ForceLayout } from "./taste-map-layout";
import { Pills, Toggle } from "./SettingsControls";
import { useOptionalDownloads } from "./DownloadsProvider";
import {
  DOWNLOAD_LIMIT_CHOICES,
  DOWNLOAD_QUALITIES,
  estimateDownloadBytes,
  formatBytes,
} from "../../shared/downloads";

/**
 * One pane per tab, each with its own groups (redesign approved 2026-10-12; mockups in
 * prototypes/mockups/settings-tabs-redesign/).
 */
const TABS = [
  {
    id: "account",
    label: "Account",
    icon: UserRound,
    lede: "Your trackers and how your profile looks.",
  },
  {
    id: "general",
    label: "General",
    icon: Settings2,
    lede: "What AniStream shows and where it starts.",
  },
  {
    id: "for-you",
    label: "For You",
    icon: Heart,
    lede: "Suggestions from what you rate, finish and watch. Built on this device; only title lookups go to TMDB and Simkl.",
  },
  {
    id: "playback",
    label: "Playback",
    icon: MonitorPlay,
    lede: "How episodes and movies play, and where downloads go.",
  },
  { id: "reading", label: "Reading", icon: BookOpen, lede: "How manga pages look in the reader." },
  {
    id: "data",
    label: "Backup & updates",
    icon: Database,
    lede: "Your data on this device, and new versions.",
  },
] as const;
export type SettingsTab = (typeof TABS)[number]["id"];

export function SettingsView({
  access,
  onSignIn,
  onOpenProfile,
  onLogout,
  initialTab = "account",
}: {
  access: ViewerAccess;
  onSignIn: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  initialTab?: SettingsTab;
}): React.JSX.Element {
  const [active, setActive] = useState<SettingsTab>(initialTab);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const tab = TABS.find((entry) => entry.id === active) ?? TABS[0];
  const simkl = useSimklStatus();
  const signedOut = access.kind !== "member" && simkl?.auth.status !== "connected";

  const choose = (id: SettingsTab, focus = false): void => {
    setActive(id);
    if (focus) tabs.current[TABS.findIndex((entry) => entry.id === id)]?.focus();
    // Each tab starts at the top, even if the last one was scrolled.
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  };
  // Up/Down (and Home/End) move between tabs, as in a vertical tab list.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = TABS.findIndex((entry) => entry.id === active);
    const next =
      event.key === "ArrowDown"
        ? (at + 1) % TABS.length
        : event.key === "ArrowUp"
          ? (at - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    choose(TABS[next].id, true);
  };

  return (
    <section className="set-page" aria-labelledby="settings-title">
      <header className="set-head">
        <h1 id="settings-title" data-settings-heading tabIndex={-1}>
          Settings
        </h1>
        <p>A few choices, all kept on this device.</p>
      </header>
      <div className="set-body">
        <div
          className="set-side"
          role="tablist"
          aria-label="Settings"
          aria-orientation="vertical"
          onKeyDown={onKeyDown}
        >
          {TABS.map(({ id, label, icon: Icon }, at) => (
            <button
              key={id}
              ref={(element) => {
                tabs.current[at] = element;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={active === id}
              aria-controls="settings-pane"
              tabIndex={active === id ? 0 : -1}
              className={active === id ? "active" : undefined}
              onClick={() => choose(id)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <section
          className="set-pane"
          id="settings-pane"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab.id}`}
        >
          <header className="set-pane-head">
            <h2>{tab.label}</h2>
            <p>
              {tab.id === "account" && signedOut
                ? "Connect a tracker to sync your lists. Both are optional."
                : tab.lede}
            </p>
          </header>
          {tab.id === "account" ? (
            <>
              <Label>Trackers</Label>
              <AccountsCard
                access={access}
                onSignIn={onSignIn}
                onOpenProfile={onOpenProfile}
                onLogout={onLogout}
              />
              {signedOut ? (
                <Note>
                  Sign-in happens in your browser. AniStream keeps the session on this device.
                </Note>
              ) : null}
              <ProfileLookCard access={access} />
            </>
          ) : tab.id === "general" ? (
            <GeneralPane />
          ) : tab.id === "for-you" ? (
            <ForYouPane />
          ) : tab.id === "playback" ? (
            <PlaybackPane />
          ) : tab.id === "reading" ? (
            <ReadingCard />
          ) : (
            <>
              <Label>Updates</Label>
              <AppUpdates />
              <Label>Backup</Label>
              <LocalDataSettings />
              <Note>
                The backup file is not encrypted. Your AniList lists are already kept on AniList.
              </Note>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }): React.JSX.Element {
  return <h3 className="set-label">{children}</h3>;
}

function Note({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <p className="set-note">
      <ShieldCheck size={14} aria-hidden="true" />
      {children}
    </p>
  );
}

function GeneralPane(): React.JSX.Element {
  const preferences = useAppPreferences();
  return (
    <>
      <Label>Start</Label>
      <div className="set-card">
        <Row title="Open on" hint="The section AniStream shows when it starts.">
          <Pills
            label="Open on"
            value={preferences.startSection}
            onChange={(value) => setAppPreference("startSection", value)}
            options={[
              { value: "ANIME", label: "Anime" },
              { value: "MANGA", label: "Manga" },
              { value: "MORE", label: "More" },
            ]}
          />
        </Row>
      </div>
      <Label>Show in the app</Label>
      <div className="set-card">
        <Row
          title="Up Next & Playlists"
          hint="Queue titles in order. Off hides the button; your queue is kept."
        >
          <Toggle
            label="Up Next & Playlists"
            checked={preferences.upNext}
            onChange={(on) => setAppPreference("upNext", on)}
          />
        </Row>
        <Row title="Airing schedule" hint="A calendar of upcoming episodes in the navbar.">
          <Toggle
            label="Airing schedule"
            checked={preferences.schedule}
            onChange={(on) => setAppPreference("schedule", on)}
          />
        </Row>
        <Row
          title="Latest Updates"
          hint="Newest episodes and chapters at the bottom of Anime and Manga."
        >
          <Toggle
            label="Latest Updates"
            checked={preferences.latestUpdates}
            onChange={(on) => setAppPreference("latestUpdates", on)}
          />
        </Row>
        <Row title="Rotating highlights" hint="The featured title at the top changes on its own.">
          <Toggle
            label="Rotating highlights"
            checked={preferences.heroRotate}
            onChange={(on) => setAppPreference("heroRotate", on)}
          />
        </Row>
      </div>
      <Label>Titles</Label>
      <div className="set-card">
        <EnglishTitlesRow />
      </div>
      <Label>Motion</Label>
      <div className="set-card">
        <Row title="Reduce motion" hint="Fewer animations and transitions.">
          <Toggle
            label="Reduce motion"
            checked={preferences.reduceMotion}
            onChange={(on) => setAppPreference("reduceMotion", on)}
          />
        </Row>
      </div>
    </>
  );
}

function ForYouPane(): React.JSX.Element {
  const preferences = useAppPreferences();
  return (
    <>
      <div className="set-card">
        <Row title="For You" hint="Suggestions on Anime, Manga and More.">
          <Toggle
            label="For You"
            checked={preferences.forYou}
            onChange={(on) => setAppPreference("forYou", on)}
          />
        </Row>
        <ActivitySignalsRow />
        <HiddenTagsRow />
      </div>
      <Label>Your Taste Graph</Label>
      <TasteMapCard />
    </>
  );
}

function PlaybackPane(): React.JSX.Element {
  const preferences = useAppPreferences();
  const binge = useOptionalBinge();
  return (
    <>
      <Label>Watching</Label>
      <div className="set-card">
        {binge ? (
          <Row
            title="Autoplay next"
            hint={
              preferences.upNext
                ? "Start the next episode or Up Next title a few seconds after one ends."
                : "Start the next episode a few seconds after one ends."
            }
          >
            <Toggle label="Autoplay next" checked={binge.autoplay} onChange={binge.setAutoplay} />
          </Row>
        ) : null}
        <Row title="Audio" hint="Used first when an anime episode offers both.">
          <Pills
            label="Audio"
            value={preferences.audio}
            onChange={(value) => setAppPreference("audio", value)}
            options={[
              { value: "sub", label: "Sub" },
              { value: "dub", label: "Dub" },
            ]}
          />
        </Row>
      </div>
      <DownloadSettingsCard />
    </>
  );
}

/** Offline downloads: storage limit, quality and folder (moved here from Downloads 2026-10-19). */
function DownloadSettingsCard(): React.JSX.Element | null {
  const downloads = useOptionalDownloads();
  const state = downloads?.state;
  if (!downloads || !state) return null;
  const { settings } = state;
  return (
    <>
      <Label>Downloads</Label>
      <div className="set-card">
        <Row title="Storage limit" hint="New downloads stop here; nothing is deleted for you.">
          <Select
            ariaLabel="Storage limit"
            value={String(settings.limitBytes)}
            onChange={(next) => void downloads.apply({ op: "settings", limitBytes: Number(next) })}
            options={[...new Set([...DOWNLOAD_LIMIT_CHOICES, settings.limitBytes])]
              .sort((a, b) => a - b)
              .map((bytes) => ({ value: String(bytes), label: formatBytes(bytes) }))}
          />
        </Row>
        <Row
          title="Quality"
          hint={`Up to ${formatBytes(estimateDownloadBytes(24, settings.quality))} for a 24-minute episode.`}
        >
          <Select
            ariaLabel="Download quality"
            value={settings.quality}
            onChange={(next) => void downloads.apply({ op: "settings", quality: next })}
            options={DOWNLOAD_QUALITIES.map((quality) => ({ value: quality, label: quality }))}
          />
        </Row>
        <Row title="Folder" hint="Applies to new downloads; existing ones stay put.">
          <code className="set-path" title={settings.folder}>
            {shortFolder(settings.folder)}
          </code>
          <button
            type="button"
            className="set-button"
            onClick={() => void downloads.chooseFolder()}
          >
            <FolderOpen size={15} aria-hidden="true" />
            Change
          </button>
        </Row>
      </div>
    </>
  );
}

/** The last three parts of a folder path, enough to recognise it. */
function shortFolder(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter(Boolean);
  return parts.length > 3 ? `…\\${parts.slice(-3).join("\\")}` : folder;
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <strong>{title}</strong>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** AniList (anime, manga) and Simkl (movies, TV) side by side; tokens stay in the main process. */
function AccountsCard({
  access,
  onSignIn,
  onOpenProfile,
  onLogout,
}: {
  access: ViewerAccess;
  onSignIn: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}): React.JSX.Element {
  return (
    <div className="set-card">
      <AniListRow
        access={access}
        onSignIn={onSignIn}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
      <SimklRow />
    </div>
  );
}

function AniListRow({
  access,
  onSignIn,
  onOpenProfile,
  onLogout,
}: {
  access: ViewerAccess;
  onSignIn: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
}): React.JSX.Element {
  const [pending, setPending] = useState(0);
  const member = access.kind === "member";
  useEffect(() => {
    if (!member) return;
    let alive = true;
    window.anistream
      .getPendingAniListChanges()
      .then((count) => alive && setPending(count))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [member]);

  if (access.kind !== "member")
    return (
      <div className="set-row set-account">
        <span className="set-avatar set-avatar--logo set-avatar--anilist" aria-hidden="true">
          <SourceLogo source="anilist" />
        </span>
        <div className="set-text">
          <span className="set-provider">AniList</span>
          <strong>Anime and manga</strong>
          <span>Lists, scores and reading progress.</span>
        </div>
        <button type="button" className="set-button set-button--primary" onClick={onSignIn}>
          Connect AniList
        </button>
      </div>
    );

  const { profile, fetchedAt } = access.dashboard;
  return (
    <div className="set-row set-account">
      <span className="set-avatar" aria-hidden="true">
        {profile.avatarUrl ? (
          <img src={cachedArtworkUrl(profile.avatarUrl)} alt="" />
        ) : (
          <UserRound size={24} />
        )}
      </span>
      <div className="set-text">
        <span className="set-provider">
          <SourceLogo source="anilist" />
          AniList · Anime &amp; manga
        </span>
        <strong>{profile.name}</strong>
        <span className="set-meta">
          {pending ? (
            <span className="set-warn">
              {pending} {pending === 1 ? "change" : "changes"} waiting to sync
            </span>
          ) : (
            <span className="set-ok">Synced {syncedAgo(fetchedAt)}</span>
          )}
          <span>
            {profile.animeCount.toLocaleString()} anime · {profile.mangaCount.toLocaleString()}{" "}
            manga
          </span>
        </span>
      </div>
      <button type="button" className="set-button" onClick={onOpenProfile}>
        View profile
      </button>
      <button type="button" className="set-button set-button--quiet" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}

/** Simkl import (movies and shows) that also feeds More For You; tokens stay in the main process. */
function SimklRow(): React.JSX.Element {
  const status = useSimklStatus();
  const [actionError, setActionError] = useState<string>();
  const run = (action: () => Promise<void>, failure: string): void => {
    setActionError(undefined);
    void action().catch(() => setActionError(failure));
  };

  const auth = status?.auth;
  const library = status?.library;
  if (auth?.status === "connected")
    return (
      <div className="set-row set-account">
        <span className="set-avatar" aria-hidden="true">
          {auth.avatarUrl ? <img src={auth.avatarUrl} alt="" /> : <SourceLogo source="simkl" />}
        </span>
        <div className="set-text">
          <span className="set-provider">
            <SourceLogo source="simkl" />
            Simkl · Movies &amp; TV
          </span>
          <strong>{auth.userName ?? "Simkl"}</strong>
          <span className="set-meta">
            {library?.syncing ? (
              <span>Importing your movies and shows…</span>
            ) : library?.error ? (
              <span className="set-warn">{library.error}</span>
            ) : !auth.canWrite ? (
              <span className="set-warn">Reconnect to let + update your Simkl lists.</span>
            ) : (
              <span className="set-ok">
                {library?.syncedAt ? `Synced ${syncedAgo(library.syncedAt)}` : "Connected"}
              </span>
            )}
            <span>
              {library?.movies ?? 0} movies · {library?.shows ?? 0} shows
            </span>
          </span>
          {actionError ? <span className="set-warn">{actionError}</span> : null}
        </div>
        {!auth.canWrite ? (
          <button
            type="button"
            className="set-button set-button--primary"
            onClick={() =>
              run(() => window.anistream.connectSimkl(), "Simkl sign-in could not be started.")
            }
          >
            Reconnect
          </button>
        ) : null}
        <button
          type="button"
          className="set-button"
          disabled={library?.syncing}
          onClick={() =>
            run(() => window.anistream.syncSimkl(), "Simkl could not sync. Try again.")
          }
        >
          Sync now
        </button>
        <button
          type="button"
          className="set-button set-button--quiet"
          onClick={() =>
            run(() => window.anistream.disconnectSimkl(), "Simkl could not be disconnected.")
          }
        >
          Disconnect
        </button>
      </div>
    );

  return (
    <div className="set-row set-account">
      <span className="set-avatar set-avatar--logo" aria-hidden="true">
        <SourceLogo source="simkl" />
      </span>
      <div className="set-text">
        <span className="set-provider">Simkl</span>
        <strong>Movies and TV</strong>
        {auth?.status === "authorizing" ? (
          <span>Approve AniStream on simkl.com in your browser to finish.</span>
        ) : auth?.status === "error" ? (
          <span className="set-warn">{auth.message}</span>
        ) : (
          <span>Movies and shows you watched and rated. Kept on this device.</span>
        )}
        {actionError ? <span className="set-warn">{actionError}</span> : null}
      </div>
      {auth?.status === "authorizing" ? (
        <button
          type="button"
          className="set-button set-button--quiet"
          onClick={() => run(() => window.anistream.cancelSimklConnect(), "Could not cancel.")}
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          className="set-button set-button--primary"
          disabled={!status}
          onClick={() =>
            run(() => window.anistream.connectSimkl(), "Simkl sign-in could not be started.")
          }
        >
          Connect Simkl
        </button>
      )}
    </div>
  );
}

/** Which picture to show and the profile hero (opens Edit look). */
function ProfileLookCard({ access }: { access: ViewerAccess }): React.JSX.Element | null {
  const status: SimklStatus | undefined = useSimklStatus();
  const look = useProfileLook();
  const custom = useProfileHeroImage();
  const [editing, setEditing] = useState(false);
  const profile = access.kind === "member" ? access.dashboard.profile : undefined;
  const simkl = status?.auth.status === "connected" ? status.auth : undefined;
  const picture = choosePicture(look.picture, profile?.avatarUrl, simkl?.avatarUrl);
  const hero = chooseHero(look.hero, custom, profile?.bannerUrl, picture.url);
  const palette = usePicturePalette(hero.kind === "mix" ? picture.url : undefined);
  if (!profile && !simkl) return null;

  return (
    <>
      <Label>Profile look</Label>
      <div className="set-card">
        <Row
          title="Profile picture"
          hint={
            profile?.avatarUrl && simkl?.avatarUrl
              ? "Shown in the navbar and on your profile."
              : `From your ${picture.source === "simkl" ? "Simkl" : "AniList"} account. Connect ${picture.source === "simkl" ? "AniList" : "Simkl"} to choose between the two.`
          }
        >
          <div className="set-pictures" role="radiogroup" aria-label="Profile picture">
            {(
              [
                ["anilist", "AniList", profile?.avatarUrl],
                ["simkl", "Simkl", simkl?.avatarUrl],
              ] as const
            ).map(([value, label, url]) =>
              url ? (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={picture.source === value}
                  onClick={() => setProfileLook({ ...look, picture: value })}
                >
                  <img src={cachedArtworkUrl(url)} alt="" />
                  {label}
                </button>
              ) : null,
            )}
          </div>
        </Row>
        <Row
          title="Profile hero"
          hint={
            hero.kind === "image" && hero.custom
              ? "Your own image, kept on this device."
              : hero.kind === "image"
                ? "Your AniList banner. Swap it for colours from your picture or your own image."
                : "Colours mixed from your picture. Upload your own wide image any time."
          }
        >
          <span
            className="set-hero-thumb"
            aria-hidden="true"
            style={hero.kind === "mix" ? { background: pictureGradient(palette) } : undefined}
          >
            {hero.kind === "image" ? (
              <img src={hero.custom ? hero.url : cachedArtworkUrl(hero.url)} alt="" />
            ) : null}
          </span>
          <button type="button" className="set-button" onClick={() => setEditing(true)}>
            Edit
          </button>
        </Row>
      </div>
      {editing ? (
        <ProfileLookDialog
          anilistPicture={profile?.avatarUrl}
          anilistName={profile?.name}
          simklPicture={simkl?.avatarUrl}
          simklName={simkl?.userName}
          banner={profile?.bannerUrl}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}

/**
 * "Learn from my activity": the viewer's switch for using how they watch (not only what they rate
 * or list) to personalize For You. Off stops collecting and deletes the measurements.
 */
function ActivitySignalsRow(): React.JSX.Element {
  const [settings, setSettings] = useState<PersonalizationSettings>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    window.anistream
      .getPersonalizationSettings()
      .then((next) => alive && setSettings(next))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const names = { ANIME: "Anime", MANGA: "Manga", MORE: "More" } as const;
  const timing = settings?.timeToPlay ?? [];
  return (
    <div className="set-row">
      <div className="set-text">
        <strong>Learn from my activity</strong>
        <span>
          Uses what you start, finish, skip and mark here to improve For You. Off deletes what was
          measured.{error ? ` ${error}` : ""}
        </span>
        {timing.length ? (
          <ul className="set-stats" aria-label="Typical time to play">
            {timing.map((row, at) => (
              <li key={row.section}>
                {at === 0 ? "Time to play · " : ""}
                {names[row.section]} {formatSeconds(row.medianSeconds)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Toggle
        label="Learn from my activity"
        checked={settings?.activitySignals ?? true}
        disabled={!settings}
        onChange={(on) => {
          setError(undefined);
          void window.anistream
            .setActivitySignals(on)
            .then(setSettings)
            .catch(() => setError("The setting could not be saved."));
        }}
      />
    </div>
  );
}

/** Settings > For You: the Taste Graph's summary, a small preview of it, and Open graph. */
function TasteMapCard(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [map, setMap] = useState<TasteMap>();
  useEffect(() => {
    let alive = true;
    window.anistream
      .getTasteMap()
      .then((value) => alive && setMap(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);
  return (
    <div className="set-card set-taste">
      <TasteMapPreview map={map} />
      <div className="set-text">
        <strong>
          {map?.titles
            ? `${map.titles} liked titles in ${map.clusters.length} ${map.clusters.length === 1 ? "taste" : "tastes"}`
            : map
              ? "Your graph starts with a few titles"
              : "Your Taste Graph"}
        </strong>
        <span>What AniStream has learned you like, as linked titles and tastes.</span>
        <button type="button" className="set-button" onClick={() => setOpen(true)}>
          Open graph
        </button>
      </div>
      {open ? <TasteMapDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

const PREVIEW_COLOR = { ANIME: "#4fd19a", MANGA: "#e3a75c", MORE: "#7fa9f2" } as const;

/** The viewer's own map, laid out once and drawn small; decorative (the summary says it). */
function TasteMapPreview({ map }: { map?: TasteMap }): React.JSX.Element {
  const drawing = useMemo(() => {
    if (!map?.nodes.length) return undefined;
    const layout = new ForceLayout(map);
    layout.tick(300);
    const index = new Map(map.nodes.map((node, at) => [node.id, at]));
    const xs = layout.nodes.map((node) => node.x);
    const ys = layout.nodes.map((node) => node.y);
    const pad = 30;
    const box = [
      Math.min(...xs) - pad,
      Math.min(...ys) - pad,
      Math.max(...xs) + pad,
      Math.max(...ys) + pad,
    ];
    return {
      viewBox: `${box[0]} ${box[1]} ${box[2] - box[0]} ${box[3] - box[1]}`,
      links: map.links.flatMap((link) => {
        const a = index.get(link.source);
        const b = index.get(link.target);
        return a === undefined || b === undefined
          ? []
          : [[layout.nodes[a], layout.nodes[b]] as const];
      }),
      nodes: map.nodes.map((node, at) => ({ node, x: layout.nodes[at].x, y: layout.nodes[at].y })),
    };
  }, [map]);
  return (
    <div className="set-taste-preview" aria-hidden="true">
      {drawing ? (
        <svg viewBox={drawing.viewBox} preserveAspectRatio="xMidYMid meet">
          {drawing.links.map(([a, b], at) => (
            <line key={at} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          ))}
          {drawing.nodes.map(({ node, x, y }) => (
            <circle
              key={node.id}
              cx={x}
              cy={y}
              r={node.kind === "cluster" ? 11 : 4}
              fill={PREVIEW_COLOR[node.section]}
              fillOpacity={node.kind === "cluster" ? 0.3 : 0.8}
              stroke={node.kind === "cluster" ? PREVIEW_COLOR[node.section] : "none"}
              strokeWidth={2}
            />
          ))}
        </svg>
      ) : (
        <svg viewBox="-60 -30 120 60">
          <circle r="22" className="set-taste-ghost" />
          <circle r="4" className="set-taste-ghost-core" />
        </svg>
      )}
    </div>
  );
}

function HiddenTagsRow(): React.JSX.Element {
  const hidden = useHiddenTagNames();
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    void window.anistream
      .getAniListFilterOptions()
      .then((options) => options)
      .catch(() => undefined)
      .then((options) => {
        if (!alive) return;
        const names = new Set<string>([
          ...(options?.genres ?? []),
          ...MORE_GENRES.map((genre) => genre.name),
          ...(options?.tags ?? []).map((tag) => tag.name),
        ]);
        setVocabulary([...names].sort((a, b) => a.localeCompare(b)));
      });
    return () => {
      alive = false;
    };
  }, []);
  const taken = new Set(hidden.map((name) => name.toLocaleLowerCase()));
  const save = (next: string[]): void => {
    setError(undefined);
    void saveHiddenTags(next).catch(() => setError("The list could not be saved."));
  };
  return (
    <div className="set-row">
      <div className="set-text">
        <strong>Hidden genres &amp; tags</strong>
        <span>
          Kept out of For You, the hero and trending. Search still finds them.
          {error ? ` ${error}` : ""}
        </span>
        <div className="hidden-tag-chips" aria-label="Hidden genres and tags">
          {hidden.map((name) => (
            <button
              key={name}
              type="button"
              className="hidden-tag-chip"
              aria-label={`Show ${name} again`}
              onClick={() => save(hidden.filter((entry) => entry !== name))}
            >
              {name}
              <X size={13} aria-hidden="true" />
            </button>
          ))}
          <Select
            ariaLabel="Hide a genre or tag"
            className="hidden-tag-add"
            value=""
            disabled={!vocabulary.length}
            options={[
              { value: "", label: "+ Add" },
              ...vocabulary
                .filter((name) => !taken.has(name.toLocaleLowerCase()))
                .map((name) => ({ value: name, label: name })),
            ]}
            onChange={(name) => {
              if (name) save([...hidden, name]);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function formatSeconds(seconds: number): string {
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function syncedAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Reader defaults; the same saved settings the reader's own panel changes. */
function ReadingCard(): React.JSX.Element {
  const [session] = useState(() => createReaderSettingsSession());
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    session.activate();
    void session.load();
    return () => session.dispose();
  }, [session]);
  const { settings, saving, error } = snapshot;
  const change = (next: Partial<ReaderSettings>): void =>
    void session.save({ ...settings, ...next });
  const disabled = saving || !snapshot.loaded;

  return (
    <>
      <Label>Pages</Label>
      <div className="set-card">
        <Row title="Page width" hint="How wide pages appear.">
          <Select
            ariaLabel="Page width"
            value={String(settings.width)}
            disabled={disabled}
            onChange={(next) => change({ width: Number(next) as ReaderSettings["width"] })}
            options={[
              { value: "720", label: "Narrow · 720px" },
              { value: "960", label: "Medium · 960px" },
              { value: "1120", label: "Wide · 1120px" },
              { value: "1400", label: "Extra wide · 1400px" },
            ]}
          />
        </Row>
        <Row title="Image fit" hint="Original size never enlarges small pages.">
          <Pills
            label="Image fit"
            value={settings.fit}
            disabled={disabled}
            onChange={(fit) => change({ fit })}
            options={[
              { value: "width", label: "Fit width" },
              { value: "original", label: "Original size" },
            ]}
          />
        </Row>
        <Row title="Image quality" hint="Data saver loads smaller images.">
          <Pills
            label="Image quality"
            value={settings.quality}
            disabled={disabled}
            onChange={(quality) => change({ quality })}
            options={[
              { value: "data", label: "Original" },
              { value: "data-saver", label: "Data saver" },
            ]}
          />
        </Row>
      </div>
      <Label>Network</Label>
      <div className="set-card">
        <Row
          title="Standard image port only"
          hint="Turn on if pages never load on a school or office network."
        >
          <Toggle
            label="Standard image port only"
            checked={settings.standardPortOnly}
            disabled={disabled}
            onChange={(standardPortOnly) => change({ standardPortOnly })}
          />
        </Row>
      </div>
      {error ? (
        <p className="error-banner set-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * English titles (default on, user decision 2026-10-14). Stored by the main process, which picks
 * titles as AniList data arrives, so a change reloads the window to refetch every list.
 */
function EnglishTitlesRow(): React.JSX.Element {
  const [english, setEnglish] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    window.anistream
      .getTitlePreferences()
      .then((preferences) => {
        if (active) setEnglish(preferences.english);
      })
      .catch(() => {
        if (active) setEnglish(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <Row
      title="English titles"
      hint="Show titles in English when AniList has one. Off follows your AniList account (romaji when signed out)."
    >
      <Toggle
        label="English titles"
        checked={english ?? true}
        disabled={english === undefined || saving}
        onChange={(on) => {
          setSaving(true);
          setEnglish(on);
          window.anistream
            .setTitlePreferences({ english: on })
            .then(() => window.location.reload())
            .catch(() => {
              setEnglish(!on);
              setSaving(false);
            });
        }}
      />
    </Row>
  );
}
