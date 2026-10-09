# Security Policy

## Supported versions

Only the latest release receives security fixes. AniStream checks for new releases at startup, and
you can also check from **Settings → Updates**.

| Version | Supported |
| ------- | --------- |
| 2.0.x   | ✅        |
| < 2.0   | ❌        |

## Reporting a vulnerability

Please report security problems privately. **Do not open a public issue.**

1. Open [Report a vulnerability](https://github.com/Athen2045/AniStream/security/advisories/new).
2. Describe the problem, the affected version and platform, and the steps to reproduce it.
3. Attach a proof of concept to the private advisory if you have one.

This is a one-person project, so please allow up to **7 days** for a first response. Once a fix is
released, the advisory is published with credit to you, unless you prefer to stay anonymous.

Never include real tokens, `.env` files, database or backup files, or other people's data in a
report. Redacted or test values are enough.

## Scope

**In scope**

- Escaping the renderer sandbox, or reaching Node, the filesystem, or credentials from the app's UI
  or an embedded player
- IPC handlers that accept unvalidated input or can be called from an untrusted origin
- Leaks of stored sign-in sessions or other credentials
- Embedded players running ads, trackers, or popups despite the app's blocking
- Backup files that can corrupt or overwrite data outside AniStream's own storage
- Tampered release assets or checksum mismatches

**Out of scope**

- Problems in third-party services. Please report those to the service itself.
- Unsigned installers. This is known; verify downloads with the `SHA256SUMS.txt` file attached to
  each release.
- Attacks that require an already compromised machine or administrator access

## How AniStream protects you

- **Isolated UI**: The interface runs sandboxed, with no Node access, and talks to the app only
  through a narrow API that validates every message.
- **Encrypted sessions**: Sign-in sessions are encrypted with your operating system's credential
  store and never leave the app's trusted process.
- **Locked-down players**: Embedded players can only load approved scripts, popups are blocked, and
  player messages are checked against the exact player origin.
- **No telemetry**: Your library, progress, and settings stay on your device.
