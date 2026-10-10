import {
  BookOpen,
  Database,
  Download,
  MonitorPlay,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { PersonalizationSettings, SimklStatus } from "../../shared/contracts";
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

const SECTIONS = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "customize", label: "Customize", icon: SlidersHorizontal },
  { id: "playback", label: "Playback", icon: MonitorPlay },
  { id: "reading", label: "Reading", icon: BookOpen },
  { id: "backup", label: "Backup", icon: Database },
  { id: "updates", label: "Updates", icon: Download },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsView({
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
  const [active, setActive] = useState<SectionId>("account");
  const preferences = useAppPreferences();
  const binge = useOptionalBinge();

  // A clicked section stays highlighted until the reader scrolls by hand.
  const pinned = useRef<SectionId | undefined>(undefined);

  // The side list follows the section under the navbar while scrolling.
  useEffect(() => {
    const update = (): void => {
      if (pinned.current) return setActive(pinned.current);
      let current: SectionId = SECTIONS[0].id;
      for (const { id } of SECTIONS) {
        const top = document.getElementById(`settings-${id}`)?.getBoundingClientRect().top;
        if (top !== undefined && top < 160) current = id;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      setActive(atBottom ? SECTIONS[SECTIONS.length - 1].id : current);
    };
    const release = (): void => {
      pinned.current = undefined;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("keydown", release);
    window.addEventListener("pointerdown", release);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("wheel", release);
      window.removeEventListener("keydown", release);
      window.removeEventListener("pointerdown", release);
    };
  }, []);

  return (
    <section className="set-page" aria-labelledby="settings-title">
      <header className="set-head">
        <h1 id="settings-title" data-settings-heading tabIndex={-1}>
          Settings
        </h1>
        <p>A few choices, all kept on this device.</p>
      </header>
      <div className="set-body">
        <nav className="set-side" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={active === id ? "active" : undefined}
              aria-current={active === id ? "true" : undefined}
              onClick={() => {
                pinned.current = id;
                setActive(id);
                document
                  .getElementById(`settings-${id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>

        <div className="set-groups">
          <Group id="account" title="Account">
            <AccountsCard
              access={access}
              onSignIn={onSignIn}
              onOpenProfile={onOpenProfile}
              onLogout={onLogout}
            />
            <ProfileLookCard access={access} />
          </Group>

          <Group id="customize" title="Customize app">
            <div className="set-card">
              <Row
                title="Up Next & Playlists"
                hint="Queue titles to watch in order and keep playlists. Off hides the Up Next button and title-page menu; your queue and playlists are kept."
              >
                <Toggle
                  label="Up Next & Playlists"
                  checked={preferences.upNext}
                  onChange={(on) => setAppPreference("upNext", on)}
                />
              </Row>
              <Row
                title="Airing schedule"
                hint="A calendar of upcoming episodes. Off hides the calendar button in the navbar."
              >
                <Toggle
                  label="Airing schedule"
                  checked={preferences.schedule}
                  onChange={(on) => setAppPreference("schedule", on)}
                />
              </Row>
              <Row
                title="For You"
                hint="Suggestions on Anime, Manga, and More, based on what you rate and finish."
              >
                <Toggle
                  label="For You"
                  checked={preferences.forYou}
                  onChange={(on) => setAppPreference("forYou", on)}
                />
              </Row>
              <Row
                title="Latest Updates"
                hint="The newest episodes and chapters at the bottom of Anime and Manga. Off hides the grid and stops loading it."
              >
                <Toggle
                  label="Latest Updates"
                  checked={preferences.latestUpdates}
                  onChange={(on) => setAppPreference("latestUpdates", on)}
                />
              </Row>
              <ActivitySignalsRow />
              <HiddenTagsRow />
              <Row
                title="Rotating highlights"
                hint="The featured title at the top of Anime, Manga, and More changes on its own."
              >
                <Toggle
                  label="Rotating highlights"
                  checked={preferences.heroRotate}
                  onChange={(on) => setAppPreference("heroRotate", on)}
                />
              </Row>
              <Row title="Reduce motion" hint="Fewer animations and transitions across the app.">
                <Toggle
                  label="Reduce motion"
                  checked={preferences.reduceMotion}
                  onChange={(on) => setAppPreference("reduceMotion", on)}
                />
              </Row>
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
          </Group>

          <Group id="playback" title="Playback">
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
                  <Toggle
                    label="Autoplay next"
                    checked={binge.autoplay}
                    onChange={binge.setAutoplay}
                  />
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
          </Group>

          <Group id="reading" title="Reading">
            <ReadingCard />
          </Group>

          <Group id="backup" title="Backup">
            <LocalDataSettings />
          </Group>

          <Group id="updates" title="Updates">
            <AppUpdates />
          </Group>
        </div>
      </div>
    </section>
  );
}

function Group({ id, title, children }: { id: SectionId; title: string; children: ReactNode }) {
  return (
    <section className="set-group" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
      <h2 id={`settings-${id}-title`}>{title}</h2>
      {children}
    </section>
  );
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

export function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="set-toggle"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Pills<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <div className="set-pills" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
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
          <span>Sync your lists, scores and reading progress.</span>
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
          <span>
            Import what you watched and rated, keep your watch list in step, and teach More For You
            your taste. Kept on this device.
          </span>
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
      <h3 className="set-subhead">Profile look</h3>
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
  const timing = (settings?.timeToPlay ?? [])
    .map((row) => `${names[row.section]} ${formatSeconds(row.medianSeconds)}`)
    .join(" · ");
  return (
    <Row
      title="Learn from my activity"
      hint={`Uses how you watch on this device (what you start, finish, abandon, mark Interested or Not interested, and how long it takes to find something to play) to improve For You. It stays on this device; only title lookups go to TMDB and Simkl. Turning it off stops this and deletes the measurements.${
        timing ? ` Typical time to play: ${timing}.` : ""
      }${error ? ` ${error}` : ""}`}
    >
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
    </Row>
  );
}

/**
 * Genres and tags the viewer never wants recommended (X's muted keywords): kept out of For You,
 * the hero and trending in every section. Search still finds them.
 */
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
    <div className="set-row set-row--stack">
      <div className="set-text">
        <strong>Hidden genres &amp; tags</strong>
        <span>
          Titles with these genres or tags stay out of For You, the hero and trending in every
          section. Search still finds them.{error ? ` ${error}` : ""}
        </span>
        {hidden.length ? (
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
          </div>
        ) : null}
      </div>
      <Select
        ariaLabel="Hide a genre or tag"
        className="filter-pill"
        value=""
        disabled={!vocabulary.length}
        options={[
          { value: "", label: "Add genre or tag" },
          ...vocabulary
            .filter((name) => !taken.has(name.toLocaleLowerCase()))
            .map((name) => ({ value: name, label: name })),
        ]}
        onChange={(name) => {
          if (name) save([...hidden, name]);
        }}
      />
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
    <div className="set-card">
      <Row title="Page width" hint="How wide pages appear in the reader.">
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
      <Row title="Image quality" hint="Data saver loads smaller MangaDex images.">
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
      {error ? (
        <p className="error-banner set-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
