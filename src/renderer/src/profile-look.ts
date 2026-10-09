import { useEffect, useState, useSyncExternalStore } from "react";
import type { PicturePalette, SimklProfile, SimklStatus } from "../../shared/contracts";

/** Which connected account's picture the navbar and profile show. */
export type PictureSource = "anilist" | "simkl";
/**
 * The profile hero: `auto` is the AniList banner when there is one, otherwise colours from the
 * picture; `mix` always uses those colours; `custom` is the viewer's own image.
 */
export type HeroMode = "auto" | "mix" | "custom";

export interface ProfileLook {
  picture: PictureSource;
  hero: HeroMode;
}

export const DEFAULT_PROFILE_LOOK: Readonly<ProfileLook> = { picture: "anilist", hero: "auto" };

/** Uploaded hero rules (user decision 2026-10-06), shown in Edit look. */
export const HERO_RULES = {
  types: ["image/jpeg", "image/png", "image/webp"],
  maxBytes: 10 * 1024 * 1024,
  minWidth: 1600,
  minHeight: 340,
  maxSide: 8000,
  /** The profile band's shape (1900 × 400). */
  aspect: 1900 / 400,
  outputWidth: 2560,
} as const;

const STORAGE_KEY = "anistream.profile-look";

export function parseProfileLook(value: unknown): ProfileLook {
  const row =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    picture: row.picture === "simkl" ? "simkl" : "anilist",
    hero: row.hero === "mix" || row.hero === "custom" ? row.hero : "auto",
  };
}

let look: ProfileLook | undefined;
const lookListeners = new Set<() => void>();

export function getProfileLook(): ProfileLook {
  if (!look) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      look = parseProfileLook(raw ? JSON.parse(raw) : undefined);
    } catch {
      look = { ...DEFAULT_PROFILE_LOOK };
    }
  }
  return look;
}

export function setProfileLook(next: ProfileLook): void {
  look = parseProfileLook(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // Private storage can refuse writes; the choice still applies for this session.
  }
  for (const listener of lookListeners) listener();
}

export function useProfileLook(): ProfileLook {
  return useSyncExternalStore(
    (listener) => {
      lookListeners.add(listener);
      return () => lookListeners.delete(listener);
    },
    getProfileLook,
    getProfileLook,
  );
}

/** The picture to show: the chosen account's when it has one, else whichever exists. */
export function choosePicture(
  picture: PictureSource,
  anilist: string | undefined,
  simkl: string | undefined,
): { url?: string; source?: PictureSource } {
  if (picture === "simkl" && simkl) return { url: simkl, source: "simkl" };
  if (anilist) return { url: anilist, source: "anilist" };
  if (simkl) return { url: simkl, source: "simkl" };
  return {};
}

export type ProfileHero =
  { kind: "image"; url: string; custom: boolean } | { kind: "mix"; pictureUrl?: string };

export function chooseHero(
  mode: HeroMode,
  custom: string | undefined,
  banner: string | undefined,
  pictureUrl: string | undefined,
): ProfileHero {
  if (mode === "custom" && custom) return { kind: "image", url: custom, custom: true };
  if (mode !== "mix" && banner) return { kind: "image", url: banner, custom: false };
  return { kind: "mix", pictureUrl };
}

// ---- The viewer's own hero image (kept by the main process in app data) ----

let heroImage: string | undefined;
let heroLoaded = false;
let heroLoading: Promise<void> | undefined;
const heroListeners = new Set<() => void>();
const emitHero = (): void => {
  for (const listener of heroListeners) listener();
};

function loadHero(): void {
  if (heroLoaded || heroLoading) return;
  heroLoading = window.anistream
    .getProfileHero()
    .then((value) => {
      heroImage = value;
    })
    .catch(() => undefined)
    .finally(() => {
      heroLoaded = true;
      heroLoading = undefined;
      emitHero();
    });
}

export function useProfileHeroImage(): string | undefined {
  const value = useSyncExternalStore(
    (listener) => {
      heroListeners.add(listener);
      return () => heroListeners.delete(listener);
    },
    () => heroImage,
    () => heroImage,
  );
  useEffect(loadHero, []);
  return value;
}

export async function saveProfileHeroImage(jpeg: Uint8Array): Promise<void> {
  heroImage = await window.anistream.setProfileHero(jpeg);
  heroLoaded = true;
  emitHero();
}

export async function clearProfileHeroImage(): Promise<void> {
  await window.anistream.clearProfileHero();
  heroImage = undefined;
  emitHero();
}

// ---- Colours from a picture ----

const palettes = new Map<string, PicturePalette | null>();

export function usePicturePalette(url: string | undefined): PicturePalette | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!url || palettes.has(url)) return;
    let alive = true;
    window.anistream
      .getPicturePalette(url)
      .catch(() => undefined)
      .then((palette) => {
        palettes.set(url, palette ?? null);
        if (alive) bump((n) => n + 1);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return (url && palettes.get(url)) || undefined;
}

// ---- Simkl connection and profile ----

let simklStatus: SimklStatus | undefined;
let simklStarted = false;
const simklListeners = new Set<() => void>();

function startSimkl(): void {
  if (simklStarted || typeof window === "undefined" || !window.anistream) return;
  simklStarted = true;
  const set = (next: SimklStatus): void => {
    simklStatus = next;
    for (const listener of simklListeners) listener();
  };
  window.anistream.onSimklStatusChanged(set);
  window.anistream
    .getSimklStatus()
    .then(set)
    .catch(() => undefined);
}

/** The Simkl connection, shared by the navbar, Settings and Profile. Undefined while loading. */
export function useSimklStatus(): SimklStatus | undefined {
  const value = useSyncExternalStore(
    (listener) => {
      simklListeners.add(listener);
      return () => simklListeners.delete(listener);
    },
    () => simklStatus,
    () => simklStatus,
  );
  useEffect(startSimkl, []);
  return value;
}

export interface SimklProfileState {
  /** The last profile read this run (kept while a newer one loads, so counts never flash 0). */
  profile?: SimklProfile;
  /** The library read is in flight. */
  loading: boolean;
  /** Watch-time stats are being read from Simkl (computed live there). */
  statsLoading: boolean;
}

// Survives route changes so reopening Profile shows the last copy at once.
let lastSimklProfile: SimklProfile | undefined;

/** The imported Simkl profile while connected; re-read after each sync, stats read separately. */
export function useSimklProfile(status: SimklStatus | undefined): SimklProfileState {
  const connected = status?.auth.status === "connected";
  const [profile, setProfile] = useState<SimklProfile | undefined>(() => lastSimklProfile);
  const [loaded, setLoaded] = useState<string>();
  const [statsFor, setStatsFor] = useState<string>();
  const version = connected
    ? `${status.library?.syncedAt ?? ""}:${status.library?.movies ?? 0}:${status.library?.shows ?? 0}:${status.auth.status === "connected" ? (status.auth.avatarUrl ?? "") : ""}`
    : "";
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    window.anistream
      .getSimklProfile()
      .then((next) => {
        if (!alive) return;
        lastSimklProfile = next ? { ...next, stats: next.stats ?? lastSimklProfile?.stats } : next;
        setProfile(lastSimklProfile);
      })
      .catch(() => undefined)
      .finally(() => alive && setLoaded(version));
    window.anistream
      .getSimklStats()
      .then((stats) => {
        if (!alive || !stats || !lastSimklProfile) return;
        lastSimklProfile = { ...lastSimklProfile, stats };
        setProfile(lastSimklProfile);
      })
      .catch(() => undefined)
      .finally(() => alive && setStatsFor(version));
    return () => {
      alive = false;
    };
  }, [connected, version]);
  if (!connected) return { loading: false, statsLoading: false };
  return { profile, loading: loaded !== version, statsLoading: statsFor !== version };
}
