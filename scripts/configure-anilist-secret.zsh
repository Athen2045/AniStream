#!/bin/zsh

set -euo pipefail

keychain_service="dev.anistream.desktop.anilist-client"
keychain_account="AniStream"

read -r -s "client_secret?AniList client secret (input hidden): "
print

if [[ -z "$client_secret" ]]; then
  print -u2 "No secret entered. Nothing was changed."
  exit 1
fi

/usr/bin/security add-generic-password \
  -U \
  -a "$keychain_account" \
  -s "$keychain_service" \
  -w "$client_secret"

unset client_secret
print "AniList client secret saved in macOS Keychain for AniStream."
