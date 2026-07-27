# Update Check & Startup Crash Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the user in-app when a newer AniStream release exists on GitHub, and — if a
freshly-installed version fails to reach a stable startup three times in a row — point them back to
the last version that worked, without any silent download or install.

**Architecture:** A small main-process module (`src/main/update-check/`) computes one `UpdateStatus`
value per app launch: `up-to-date`, `update-available`, or `crash-detected`. It's exposed to the
renderer over one new IPC channel and rendered by a single self-contained `UpdateBanner` component.
Crash-loop bookkeeping lives in two new keys in the existing `app_meta` SQLite table (via two new
methods added to `AppDatabase`); the "is there a newer release" check is a single unauthenticated
call to GitHub's REST API.

**Tech Stack:** TypeScript, Electron main/preload/renderer, `better-sqlite3` (existing), native
`fetch` (existing pattern, no new dependency), Vitest.

**Full design reference:** `docs/superpowers/specs/2026-07-28-update-check-design.md`

## Global Constraints

- No code signing, no silent download, no silent install — ever. The user always does the actual
  re-install by hand. (spec: Non-goals)
- GitHub repo is hardcoded as `Athen2045/AniStream` — this is a single-user personal app, not a
  multi-tenant config. (spec: Data flow)
- Any failure in the GitHub release check (network, non-2xx, malformed JSON) is swallowed and
  treated as `up-to-date`. Never show an error state for this background convenience check.
  (spec: Error handling)
- `crash-detected` and `update-available` are mutually exclusive in a given launch; `crash-detected`
  always wins when both would otherwise apply. (spec: Data flow, step 4)
- A version must fail to reach "stable" on **three consecutive launches** (not two) before
  `crash-detected` fires — see the worked example and its exact `attempts > 2` threshold in the spec.
- "Stable" is marked ~8 seconds after `createWindow()` if the process is still running. This is a
  known, accepted limitation: only startup crashes are caught, not mid-session crashes.
  (spec: Known limitation)
- Banner dismissal is in-memory only (component `useState`), never persisted — reappears next
  launch. (spec: Data flow, Renderer)
- No live network calls in the permanent Vitest suite — inject `fetch` for tests.
  (spec: Testing; matches existing `test/main/` convention)

---

### Task 1: Add key-value meta storage to `AppDatabase`

**Files:**

- Modify: `src/main/database.ts`
- Test: `test/main/database.test.ts` (new)

**Interfaces:**

- Produces: `AppDatabase.getMeta(key: string): string | undefined`,
  `AppDatabase.setMeta(key: string, value: string): void`,
  `AppDatabase.deleteMeta(key: string): void` — used by Task 4 (`store.ts`). Uses the `app_meta`
  table that already exists in the schema (`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY
KEY, value TEXT NOT NULL)`); no schema change needed.
- `openAppDatabase(":memory:")` is a valid in-memory database for tests — verified working under
  plain Node (not just inside Electron) before writing this plan.

- [ ] **Step 1: Write the failing test**

Create `test/main/database.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/database";

describe("AppDatabase meta storage", () => {
  it("returns undefined for a key that was never set", () => {
    const db = openAppDatabase(":memory:");
    expect(db.getMeta("missing")).toBeUndefined();
    db.close();
  });

  it("stores and retrieves a value", () => {
    const db = openAppDatabase(":memory:");
    db.setMeta("greeting", "hello");
    expect(db.getMeta("greeting")).toBe("hello");
    db.close();
  });

  it("overwrites an existing value for the same key", () => {
    const db = openAppDatabase(":memory:");
    db.setMeta("greeting", "hello");
    db.setMeta("greeting", "goodbye");
    expect(db.getMeta("greeting")).toBe("goodbye");
    db.close();
  });

  it("removes a value on delete, and delete of a missing key is a no-op", () => {
    const db = openAppDatabase(":memory:");
    db.setMeta("greeting", "hello");
    db.deleteMeta("greeting");
    expect(db.getMeta("greeting")).toBeUndefined();
    expect(() => db.deleteMeta("never-existed")).not.toThrow();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/main/database.test.ts`
Expected: FAIL — `db.getMeta is not a function` (method doesn't exist yet).

- [ ] **Step 3: Implement `getMeta`/`setMeta`/`deleteMeta`**

Replace the full contents of `src/main/database.ts` with:

```ts
import Database from "better-sqlite3";

export interface AppDatabase {
  readonly ready: boolean;
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  deleteMeta(key: string): void;
  close(): void;
}

export function openAppDatabase(path: string): AppDatabase {
  const database = new Database(path);

  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_entries (
      media_key TEXT PRIMARY KEY,
      media_kind TEXT NOT NULL CHECK (media_kind IN ('anime', 'manga')),
      status TEXT NOT NULL,
      score REAL,
      progress INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
  `);

  const getMetaStatement = database.prepare("SELECT value FROM app_meta WHERE key = ?");
  const setMetaStatement = database.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const deleteMetaStatement = database.prepare("DELETE FROM app_meta WHERE key = ?");

  return {
    ready: true,
    getMeta: (key) => {
      const row = getMetaStatement.get(key) as { value: string } | undefined;
      return row?.value;
    },
    setMeta: (key, value) => {
      setMetaStatement.run(key, value);
    },
    deleteMeta: (key) => {
      deleteMetaStatement.run(key);
    },
    close: () => database.close(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/main/database.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (`src/main/index.ts` still only uses `database.ready` and `database.close()`,
both unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/main/database.ts test/main/database.test.ts
git commit -m "feat: add key-value meta storage to AppDatabase"
```

---

### Task 2: Crash-loop state machine (`launch-state.ts`)

**Files:**

- Create: `src/main/update-check/launch-state.ts`
- Test: `test/main/update-check/launch-state.test.ts`

**Interfaces:**

- Produces (used by Task 4's `store.ts` and Task 7's `main/index.ts`):
  ```ts
  export interface PendingAttempts {
    version: string;
    attempts: number;
  }
  export interface LaunchState {
    lastCleanVersion?: string;
    pendingAttempts?: PendingAttempts;
  }
  export interface LaunchDecision {
    report: "normal" | "crash-detected";
    nextState: LaunchState;
  }
  export function nextLaunchState(persisted: LaunchState, currentVersion: string): LaunchDecision;
  export function markStable(currentVersion: string): LaunchState;
  ```
- Consumes: nothing (pure, no I/O, no Electron/Node imports).

- [ ] **Step 1: Write the failing tests**

Create `test/main/update-check/launch-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { markStable, nextLaunchState } from "../../../src/main/update-check/launch-state";

describe("nextLaunchState", () => {
  it("treats a fresh install as a normal first launch", () => {
    const decision = nextLaunchState({}, "0.1.0");
    expect(decision.report).toBe("normal");
    expect(decision.nextState).toEqual({
      lastCleanVersion: undefined,
      pendingAttempts: { version: "0.1.0", attempts: 1 },
    });
  });

  it("reports normal for continued use of an already-stable version", () => {
    const persisted = { lastCleanVersion: "0.1.0" };
    const decision = nextLaunchState(persisted, "0.1.0");
    expect(decision.report).toBe("normal");
    expect(decision.nextState).toEqual(persisted);
  });

  it("starts a fresh attempt count on the first launch of a new version", () => {
    const decision = nextLaunchState({ lastCleanVersion: "0.1.0" }, "0.2.0");
    expect(decision.report).toBe("normal");
    expect(decision.nextState).toEqual({
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 1 },
    });
  });

  it("gives a new version one retry before flagging it", () => {
    const persisted = {
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 1 },
    };
    const decision = nextLaunchState(persisted, "0.2.0");
    expect(decision.report).toBe("normal");
    expect(decision.nextState).toEqual({
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 2 },
    });
  });

  it("reports crash-detected on the third consecutive failed launch of a version", () => {
    const persisted = {
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 2 },
    };
    const decision = nextLaunchState(persisted, "0.2.0");
    expect(decision.report).toBe("crash-detected");
    expect(decision.nextState).toEqual({
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 3 },
    });
  });

  it("keeps reporting crash-detected on further launches of the same stuck version", () => {
    const persisted = {
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 5 },
    };
    const decision = nextLaunchState(persisted, "0.2.0");
    expect(decision.report).toBe("crash-detected");
  });

  it("never reports crash-detected when there is no known-good version to roll back to", () => {
    // A version that crashes repeatedly on the very first install ever -- there is
    // nothing to roll back to, so this must never claim crash-detected.
    const persisted = { pendingAttempts: { version: "0.1.0", attempts: 5 } };
    const decision = nextLaunchState(persisted, "0.1.0");
    expect(decision.report).toBe("normal");
  });

  it("self-heals once the user rolls back to the last-known-good version", () => {
    const persisted = {
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 3 },
    };
    const decision = nextLaunchState(persisted, "0.1.0");
    expect(decision.report).toBe("normal");
    expect(decision.nextState).toEqual(persisted);
  });
});

describe("markStable", () => {
  it("records the current version as last-clean and clears pending attempts", () => {
    expect(markStable("0.2.0")).toEqual({ lastCleanVersion: "0.2.0" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/main/update-check/launch-state.test.ts`
Expected: FAIL — cannot find module `src/main/update-check/launch-state`.

- [ ] **Step 3: Implement `launch-state.ts`**

Create `src/main/update-check/launch-state.ts`:

```ts
export interface PendingAttempts {
  version: string;
  attempts: number;
}

export interface LaunchState {
  lastCleanVersion?: string;
  pendingAttempts?: PendingAttempts;
}

export interface LaunchDecision {
  report: "normal" | "crash-detected";
  nextState: LaunchState;
}

// A version must fail to reach "stable" on this many consecutive launches before
// AniStream reports crash-detected. See docs/superpowers/specs/2026-07-28-update-check-design.md
// for the worked example this threshold is derived from.
const ATTEMPTS_BEFORE_CRASH_DETECTED = 2;

export function nextLaunchState(persisted: LaunchState, currentVersion: string): LaunchDecision {
  if (persisted.lastCleanVersion === currentVersion) {
    return { report: "normal", nextState: persisted };
  }

  const priorAttempts =
    persisted.pendingAttempts?.version === currentVersion ? persisted.pendingAttempts.attempts : 0;
  const attempts = priorAttempts + 1;
  const nextState: LaunchState = {
    lastCleanVersion: persisted.lastCleanVersion,
    pendingAttempts: { version: currentVersion, attempts },
  };

  const hasRollbackTarget = Boolean(persisted.lastCleanVersion);
  if (attempts > ATTEMPTS_BEFORE_CRASH_DETECTED && hasRollbackTarget) {
    return { report: "crash-detected", nextState };
  }
  return { report: "normal", nextState };
}

export function markStable(currentVersion: string): LaunchState {
  return { lastCleanVersion: currentVersion };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/main/update-check/launch-state.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/update-check/launch-state.ts test/main/update-check/launch-state.test.ts
git commit -m "feat: add crash-loop launch-state state machine"
```

---

### Task 3: GitHub release check (`check-release.ts`)

**Files:**

- Create: `src/main/update-check/check-release.ts`
- Test: `test/main/update-check/check-release.test.ts`

**Interfaces:**

- Produces (used by Task 7's `main/index.ts`):
  ```ts
  export type ReleaseCheckResult =
    { status: "up-to-date" } | { status: "update-available"; version: string; releaseUrl: string };
  export function checkLatestRelease(
    currentVersion: string,
    fetcher?: typeof fetch,
  ): Promise<ReleaseCheckResult>;
  export function compareVersions(a: string, b: string): -1 | 0 | 1;
  ```
- Consumes: nothing beyond the global `fetch` (injectable for tests, same pattern as
  `src/main/anilist/client.ts`).

- [ ] **Step 1: Write the failing tests**

Create `test/main/update-check/check-release.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { checkLatestRelease, compareVersions } from "../../../src/main/update-check/check-release";

describe("compareVersions", () => {
  it("treats equal versions as equal", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("orders a lower patch version before a higher one", () => {
    expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(compareVersions("0.1.1", "0.1.0")).toBe(1);
  });

  it("orders a lower minor/major version before a higher one", () => {
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
  });

  it("ignores a leading v and any pre-release/build suffix", () => {
    expect(compareVersions("v0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBe(0);
    expect(compareVersions("0.2.0+build5", "0.2.0")).toBe(0);
  });

  it("treats a missing segment as zero", () => {
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    expect(compareVersions("0.2", "0.2.1")).toBe(-1);
  });
});

function fakeFetch(response: Partial<Response> & { jsonBody?: unknown }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonBody,
  }) as unknown as typeof fetch;
}

describe("checkLatestRelease", () => {
  it("reports update-available when the release tag is newer", async () => {
    const fetcher = fakeFetch({
      jsonBody: {
        tag_name: "v0.2.0",
        html_url: "https://github.com/Athen2045/AniStream/releases/tag/v0.2.0",
      },
    });
    const result = await checkLatestRelease("0.1.0", fetcher);
    expect(result).toEqual({
      status: "update-available",
      version: "0.2.0",
      releaseUrl: "https://github.com/Athen2045/AniStream/releases/tag/v0.2.0",
    });
  });

  it("reports up-to-date when the release tag matches the current version", async () => {
    const fetcher = fakeFetch({
      jsonBody: {
        tag_name: "v0.1.0",
        html_url: "https://github.com/Athen2045/AniStream/releases/tag/v0.1.0",
      },
    });
    const result = await checkLatestRelease("0.1.0", fetcher);
    expect(result).toEqual({ status: "up-to-date" });
  });

  it("reports up-to-date when the release tag is older (never claims a downgrade)", async () => {
    const fetcher = fakeFetch({
      jsonBody: { tag_name: "v0.1.0", html_url: "https://example.com" },
    });
    const result = await checkLatestRelease("0.5.0", fetcher);
    expect(result).toEqual({ status: "up-to-date" });
  });

  it("fails silently to up-to-date on a network error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;
    const result = await checkLatestRelease("0.1.0", fetcher);
    expect(result).toEqual({ status: "up-to-date" });
  });

  it("fails silently to up-to-date on a non-2xx response", async () => {
    const fetcher = fakeFetch({ ok: false, status: 404, jsonBody: {} });
    const result = await checkLatestRelease("0.1.0", fetcher);
    expect(result).toEqual({ status: "up-to-date" });
  });

  it("fails silently to up-to-date on a malformed JSON body", async () => {
    const fetcher = fakeFetch({ jsonBody: { unexpected: "shape" } });
    const result = await checkLatestRelease("0.1.0", fetcher);
    expect(result).toEqual({ status: "up-to-date" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/main/update-check/check-release.test.ts`
Expected: FAIL — cannot find module `src/main/update-check/check-release`.

- [ ] **Step 3: Implement `check-release.ts`**

Create `src/main/update-check/check-release.ts`:

```ts
const GITHUB_REPO = "Athen2045/AniStream";
const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const REQUEST_TIMEOUT_MS = 10_000;

export type ReleaseCheckResult =
  { status: "up-to-date" } | { status: "update-available"; version: string; releaseUrl: string };

/**
 * Checks GitHub's public releases API for a newer tagged version than `currentVersion`.
 * Every failure mode (network, non-2xx, malformed body) resolves to "up-to-date" --
 * this is a background convenience check and must never surface as an error.
 */
export async function checkLatestRelease(
  currentVersion: string,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseCheckResult> {
  try {
    const response = await fetcher(RELEASES_LATEST_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "up-to-date" };

    const payload = (await response.json()) as unknown;
    if (!isRecord(payload)) return { status: "up-to-date" };

    const tagName = payload.tag_name;
    const htmlUrl = payload.html_url;
    if (typeof tagName !== "string" || typeof htmlUrl !== "string") {
      return { status: "up-to-date" };
    }

    const latestVersion = tagName.replace(/^v/i, "");
    if (compareVersions(latestVersion, currentVersion) <= 0) return { status: "up-to-date" };

    return { status: "update-available", version: latestVersion, releaseUrl: htmlUrl };
  } catch {
    return { status: "up-to-date" };
  }
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = normalizeVersionParts(a);
  const partsB = normalizeVersionParts(b);
  const length = Math.max(partsA.length, partsB.length);
  for (let index = 0; index < length; index += 1) {
    const segmentA = partsA[index] ?? 0;
    const segmentB = partsB[index] ?? 0;
    if (segmentA > segmentB) return 1;
    if (segmentA < segmentB) return -1;
  }
  return 0;
}

function normalizeVersionParts(version: string): number[] {
  const withoutPrefix = version.trim().replace(/^v/i, "");
  const withoutSuffix = withoutPrefix.split("-")[0].split("+")[0];
  return withoutSuffix.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/main/update-check/check-release.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/update-check/check-release.ts test/main/update-check/check-release.test.ts
git commit -m "feat: add GitHub release version check"
```

---

### Task 4: Persist launch state (`store.ts`)

**Files:**

- Create: `src/main/update-check/store.ts`
- Test: `test/main/update-check/store.test.ts`

**Interfaces:**

- Consumes: `AppDatabase.getMeta/setMeta/deleteMeta` (Task 1), `LaunchState`/`PendingAttempts`
  (Task 2).
- Produces (used by Task 7's `main/index.ts`):

  ```ts
  export function readLaunchState(db: AppDatabase): LaunchState;
  export function writeLaunchState(db: AppDatabase, state: LaunchState): void;
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/main/update-check/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { openAppDatabase } from "../../../src/main/database";
import { readLaunchState, writeLaunchState } from "../../../src/main/update-check/store";

describe("readLaunchState / writeLaunchState", () => {
  it("returns an empty state when nothing has been written yet", () => {
    const db = openAppDatabase(":memory:");
    expect(readLaunchState(db)).toEqual({});
    db.close();
  });

  it("round-trips a state with both fields set", () => {
    const db = openAppDatabase(":memory:");
    writeLaunchState(db, {
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 2 },
    });
    expect(readLaunchState(db)).toEqual({
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 2 },
    });
    db.close();
  });

  it("round-trips a state with pendingAttempts cleared", () => {
    const db = openAppDatabase(":memory:");
    writeLaunchState(db, {
      lastCleanVersion: "0.1.0",
      pendingAttempts: { version: "0.2.0", attempts: 2 },
    });
    writeLaunchState(db, { lastCleanVersion: "0.2.0" });
    expect(readLaunchState(db)).toEqual({ lastCleanVersion: "0.2.0" });
    db.close();
  });

  it("treats a corrupted pendingAttempts value as absent rather than throwing", () => {
    const db = openAppDatabase(":memory:");
    db.setMeta("update_check_pending_attempts", "{not valid json");
    expect(readLaunchState(db)).toEqual({});
    db.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/main/update-check/store.test.ts`
Expected: FAIL — cannot find module `src/main/update-check/store`.

- [ ] **Step 3: Implement `store.ts`**

Create `src/main/update-check/store.ts`:

```ts
import type { AppDatabase } from "../database";
import type { LaunchState, PendingAttempts } from "./launch-state";

const LAST_CLEAN_VERSION_KEY = "update_check_last_clean_version";
const PENDING_ATTEMPTS_KEY = "update_check_pending_attempts";

export function readLaunchState(db: AppDatabase): LaunchState {
  return {
    lastCleanVersion: db.getMeta(LAST_CLEAN_VERSION_KEY),
    pendingAttempts: parsePendingAttempts(db.getMeta(PENDING_ATTEMPTS_KEY)),
  };
}

export function writeLaunchState(db: AppDatabase, state: LaunchState): void {
  if (state.lastCleanVersion) db.setMeta(LAST_CLEAN_VERSION_KEY, state.lastCleanVersion);
  else db.deleteMeta(LAST_CLEAN_VERSION_KEY);

  if (state.pendingAttempts) {
    db.setMeta(PENDING_ATTEMPTS_KEY, JSON.stringify(state.pendingAttempts));
  } else {
    db.deleteMeta(PENDING_ATTEMPTS_KEY);
  }
}

function parsePendingAttempts(raw: string | undefined): PendingAttempts | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as PendingAttempts).version === "string" &&
      typeof (parsed as PendingAttempts).attempts === "number"
    ) {
      return parsed as PendingAttempts;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/main/update-check/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/update-check/store.ts test/main/update-check/store.test.ts
git commit -m "feat: persist crash-loop launch state in app_meta"
```

---

### Task 5: Barrel export + shared `UpdateStatus` contract

**Files:**

- Create: `src/main/update-check/index.ts`
- Modify: `src/shared/contracts.ts`

**Interfaces:**

- Produces: `UpdateStatus` type and `AniStreamBridge.getUpdateStatus()` — consumed by Task 6
  (preload), Task 7 (main), Task 8 (renderer).

No test for this task — it's type/re-export only, verified by typecheck in Step 3.

- [ ] **Step 1: Create the barrel file**

Create `src/main/update-check/index.ts`:

```ts
export { checkLatestRelease, compareVersions } from "./check-release";
export { markStable, nextLaunchState } from "./launch-state";
export type { LaunchDecision, LaunchState, PendingAttempts } from "./launch-state";
export { readLaunchState, writeLaunchState } from "./store";
```

- [ ] **Step 2: Add `UpdateStatus` and the bridge method to `src/shared/contracts.ts`**

Add this new type anywhere after `AppInfo` (e.g. directly below it):

```ts
export type UpdateStatus =
  | { kind: "up-to-date" }
  | { kind: "update-available"; version: string; releaseUrl: string }
  | {
      kind: "crash-detected";
      currentVersion: string;
      lastGoodVersion: string;
      lastGoodReleaseUrl: string;
    };
```

Add one line to the `AniStreamBridge` interface, immediately after `getAppInfo(): Promise<AppInfo>;`:

```ts
  getUpdateStatus(): Promise<UpdateStatus>;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL at this point — `preload/index.ts`'s `bridge` object no longer satisfies
`AniStreamBridge` (missing `getUpdateStatus`). This is expected; Task 6 fixes it. If any other
unrelated error appears, stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/main/update-check/index.ts src/shared/contracts.ts
git commit -m "feat: add UpdateStatus contract and update-check barrel export"
```

---

### Task 6: Preload bridge method

**Files:**

- Modify: `src/preload/index.ts`

**Interfaces:**

- Consumes: `UpdateStatus` (Task 5).
- Produces: `window.anistream.getUpdateStatus()` for the renderer (Task 8).

No test — this file has no existing unit tests in this codebase (verified by preload IPC contract
checks in `scripts/verify-product-slice.mjs` instead, extended in Task 7).

- [ ] **Step 1: Add the import and bridge method**

In `src/preload/index.ts`, add `UpdateStatus` to the existing type-only import block:

```ts
import type {
  AniListAuthState,
  AniListCatalogPage,
  AniListDashboard,
  AniListMedia,
  AniListMediaDetail,
  AniListMediaType,
  AniStreamBridge,
  AppInfo,
  AnimeEpisodeGuide,
  BrowseAniListInput,
  MangaDexAvailabilityInput,
  MangaDexChapterAvailability,
  UpdateAniListEntryInput,
  UpdateStatus,
} from "../shared/contracts";
```

Add this line to the `bridge` object, immediately after `getAppInfo: () =>
ipcRenderer.invoke("app:get-info") as Promise<AppInfo>,`:

```ts
  getUpdateStatus: () => ipcRenderer.invoke("app:update-status") as Promise<UpdateStatus>,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: still FAIL — `src/main/index.ts` doesn't register the `"app:update-status"` handler yet.
This is expected; Task 7 fixes it.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose getUpdateStatus over the preload bridge"
```

---

### Task 7: Wire the startup sequence in `src/main/index.ts`

**Files:**

- Modify: `src/main/index.ts`
- Modify: `scripts/verify-product-slice.mjs`

**Interfaces:**

- Consumes: everything from Tasks 1-5 (`checkLatestRelease`, `nextLaunchState`, `markStable`,
  `readLaunchState`, `writeLaunchState`, `UpdateStatus`).

No new unit test — `src/main/index.ts` has no existing unit tests in this codebase (it's an Electron
entry point that composes everything else); verified by typecheck, `npm run build`, and the extended
`verify-product-slice.mjs` regression script instead, matching the existing convention for this file.

- [ ] **Step 1: Add imports and the stable-mark delay constant**

In `src/main/index.ts`, add to the existing import block (after the `openAppDatabase` import):

```ts
import {
  checkLatestRelease,
  markStable,
  nextLaunchState,
  readLaunchState,
  writeLaunchState,
} from "./update-check";
```

Add `UpdateStatus` to the existing `import type { ... } from "../shared/contracts";` block.

Add this constant near the top of the file, after the existing `let` declarations:

```ts
const STABLE_MARK_DELAY_MS = 8_000;
```

- [ ] **Step 2: Compute and persist launch state before `createWindow()`, register the IPC handler**

Inside the `app.whenReady().then(async () => { ... })` block, immediately after the existing
`await aniList.restore();` line and before the first `ipcMain.handle(...)` call, insert:

```ts
const currentVersion = app.getVersion();
const priorLaunchState = readLaunchState(database);
const { report, nextState } = nextLaunchState(priorLaunchState, currentVersion);
writeLaunchState(database, nextState);

const updateStatusPromise: Promise<UpdateStatus> =
  report === "crash-detected" && nextState.lastCleanVersion
    ? Promise.resolve({
        kind: "crash-detected",
        currentVersion,
        lastGoodVersion: nextState.lastCleanVersion,
        lastGoodReleaseUrl: `https://github.com/Athen2045/AniStream/releases/tag/v${nextState.lastCleanVersion}`,
      } as const)
    : checkLatestRelease(currentVersion).then((result): UpdateStatus =>
        result.status === "update-available"
          ? { kind: "update-available", version: result.version, releaseUrl: result.releaseUrl }
          : { kind: "up-to-date" },
      );
```

Add the IPC handler in the existing `ipcMain.handle(...)` block, immediately after the existing
`ipcMain.handle("app:get-info", ...)` registration:

```ts
ipcMain.handle("app:update-status", () => updateStatusPromise);
```

- [ ] **Step 3: Schedule the stable-mark timer after `createWindow()`**

Immediately after the existing `createWindow();` call (before the `if (pendingProtocolUrl)` block),
insert:

```ts
setTimeout(() => {
  if (database) writeLaunchState(database, markStable(currentVersion));
}, STABLE_MARK_DELAY_MS);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no errors anywhere now.

- [ ] **Step 5: Extend the product-slice regression script**

In `scripts/verify-product-slice.mjs`, add two fragments to the existing `"main process"` entry's
fragment array (the array currently reading
`["await aniList.restore()", '"anilist:browse"', '"anilist:media-detail"']`):

```js
  ["main process", main, [
    "await aniList.restore()",
    '"anilist:browse"',
    '"anilist:media-detail"',
    "nextLaunchState(priorLaunchState",
    '"app:update-status"',
  ]],
```

Add a new ordering assertion immediately after the existing one
(`if (main.indexOf("await aniList.restore()") > main.indexOf("\n  createWindow();")) { ... }`):

```js
if (main.indexOf("nextLaunchState(priorLaunchState") > main.indexOf("\n  createWindow();")) {
  throw new Error("Crash-loop launch state must be computed before the renderer is created.");
}
```

- [ ] **Step 6: Run the regression script**

Run: `npm run check:product-slice`
Expected: PASS (prints the existing success message unchanged).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/index.ts scripts/verify-product-slice.mjs
git commit -m "feat: wire update-check and crash-loop detection into app startup"
```

---

### Task 8: `UpdateBanner` renderer component + styles

**Files:**

- Create: `src/renderer/src/UpdateBanner.tsx`
- Modify: `src/renderer/src/styles.css`

**Interfaces:**

- Consumes: `window.anistream.getUpdateStatus()` (Task 6), `UpdateStatus` (Task 5).
- Produces: `<UpdateBanner />` — a self-contained component taking no props, consumed by Task 9.

No test — this codebase has no renderer-component tests anywhere (`test/main/` only); verified by
typecheck, `npm run build`, and manual verification in Task 10.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/UpdateBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../shared/contracts";

export function UpdateBanner(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    void window.anistream.getUpdateStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!status || status.kind === "up-to-date" || dismissed) return null;

  const copy =
    status.kind === "update-available"
      ? {
          message: `AniStream v${status.version} is available.`,
          linkLabel: "View release",
          href: status.releaseUrl,
        }
      : {
          message: `AniStream crashed after updating to v${status.currentVersion} — v${status.lastGoodVersion} is available here.`,
          linkLabel: `View v${status.lastGoodVersion}`,
          href: status.lastGoodReleaseUrl,
        };

  return (
    <div className="update-banner" role="status">
      <span>{copy.message}</span>
      <div className="update-banner-actions">
        <a href={copy.href} target="_blank" rel="noreferrer">
          {copy.linkLabel}
        </a>
        <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}>
          ×
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

In `src/renderer/src/styles.css`, add this block immediately after the existing `.error-banner`
rule (search for `.error-banner {`):

```css
.update-banner {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  height: 40px;
  padding: 0 20px;
  background: rgba(193, 17, 25, 0.94);
  color: white;
  font-size: 0.78rem;
  -webkit-app-region: drag;
}

.update-banner a,
.update-banner button {
  -webkit-app-region: no-drag;
}

.update-banner-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 14px;
}

.update-banner a {
  color: white;
  font-weight: 700;
  text-decoration: underline;
}

.update-banner button {
  padding: 0;
  background: transparent;
  color: white;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  opacity: 0.8;
}

.update-banner button:hover {
  opacity: 1;
}

/* Push the fixed navbar down when the banner is showing, without either component
   needing to know about the other. */
.app-shell:has(.update-banner) .app-navbar {
  top: 40px;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/UpdateBanner.tsx src/renderer/src/styles.css
git commit -m "feat: add UpdateBanner component and styles"
```

---

### Task 9: Wire `UpdateBanner` into `App.tsx`

**Files:**

- Modify: `src/renderer/src/App.tsx`

**Interfaces:**

- Consumes: `<UpdateBanner />` (Task 8).

No test — matches Task 8.

- [ ] **Step 1: Import and render the banner in both return branches**

Add the import in `src/renderer/src/App.tsx`, alongside the existing sibling-component imports
(near `import { CatalogView } from "./CatalogView";`):

```ts
import { UpdateBanner } from "./UpdateBanner";
```

In the signed-out branch, add `<UpdateBanner />` as the first child of `<main
className="login-shell">`:

```tsx
  if (auth.status !== "signed-in" || !dashboard) {
    return (
      <main className="login-shell">
        <UpdateBanner />
        <section className="login-card">
```

In the signed-in branch, add `<UpdateBanner />` as the first child of `<main
className="app-shell">` (before `<nav className="app-navbar">`):

```tsx
  return (
    <main className="app-shell">
      <UpdateBanner />
      <nav className="app-navbar">
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors (the two pre-existing `react-hooks/set-state-in-effect` warnings are unaffected
and expected).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: render UpdateBanner in the app shell"
```

---

### Task 10: Full verification pass and CONTEXT.md update

**Files:**

- Modify: `CONTEXT.md`

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run check:product-slice
npm run check:anilist-oauth
```

Expected: every command exits 0. `npm test` should show the test count increased by 28 (9 in
`launch-state.test.ts` + 11 in `check-release.test.ts` + 4 in `store.test.ts` + 4 in
`database.test.ts`) over whatever the baseline was before this plan started.

- [ ] **Step 2: Run `npm run format` if `format:check` failed**

```bash
npm run format
git add -A
git commit -m "chore: format update-check files"
```

(Only needed if Step 1's `format:check` reported diffs.)

- [ ] **Step 3: Manually verify in the running app**

```bash
npm run dev
```

With the dev app open: confirm no console errors on launch, confirm the app still reaches the
signed-in catalog view as before (or the sign-in screen if no session), and confirm
`window.anistream.getUpdateStatus()` resolves (check via the app's DevTools console, or trust the
typecheck/build/lint signal if DevTools access isn't convenient in this environment). A real
`update-available` or `crash-detected` banner won't naturally appear during local dev unless a
newer tag actually exists on GitHub or the crash-loop conditions are deliberately reproduced — that
level of manual reproduction is optional, not required to consider this task done.

- [ ] **Step 4: Update `CONTEXT.md`**

Add a bullet to the "What's working right now" section describing the new feature (in-app update
notification via GitHub Releases; startup crash-loop detection pointing back to the last known-good
version), and a dated entry to the "Key architectural decisions log" section referencing this plan
and its spec, per `AGENTS.md`'s session-end requirement. Follow the exact prose style already used
throughout `CONTEXT.md` (see any recent entry for the pattern) rather than inventing a new format.

- [ ] **Step 5: Final commit**

```bash
git add CONTEXT.md
git commit -m "docs: log update-check feature in CONTEXT.md"
```

---

## Self-Review Notes

_(Recorded here per the writing-plans skill's self-review step; not part of the engineer-facing plan.)_

- **Spec coverage:** Architecture (Task 1-5, 7), IPC contract (Task 5-7), data flow both flows
  (Task 7), banner UX/copy (Task 8-9), error handling (Task 3 tests), testing (all pure-logic tasks
  have real Vitest coverage) — all covered.
- **Refinement beyond the spec doc, both consistent with its intent:** (1) `checkLatestRelease` uses
  GitHub's own `html_url` from the live API response for `update-available` rather than constructing
  the URL by hand, since it's already available and more robust; the crash-detected path still
  constructs the URL manually since there's no live API call for a past release. (2) `UpdateStatus`'s
  `crash-detected` variant carries `currentVersion` (not in the design doc's contract sketch),
  because the doc's own exact banner copy for that state ("...updating to v{current}...") needs it
  and the alternative — a second IPC round-trip to `getAppInfo()` — is worse.
- **Type consistency check:** `LaunchState`/`PendingAttempts` (Task 2) match exactly across Task 4
  (`store.ts`), Task 7 (`main/index.ts`); `UpdateStatus` (Task 5) matches exactly across Task 6
  (preload), Task 7 (main), Task 8 (renderer). `ReleaseCheckResult` (Task 3) is mapped to
  `UpdateStatus` only inside Task 7, deliberately not reused as the same type — they represent
  different things (a release-check outcome vs. the full three-way status the renderer sees).
- **better-sqlite3 under plain Node verified working** before committing to the `openAppDatabase(":memory:")`
  testing strategy in Tasks 1 and 4 — confirmed empirically, not assumed.
