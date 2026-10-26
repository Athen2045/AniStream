/**
 * Gives a player keyboard focus when it appears, so Space and the arrows reach it at once. The
 * watch pages first focus Back, where Space would leave the episode (issue 38). For an embedded
 * player this focuses its frame: its keys are then the provider's own. Skipped while the viewer is
 * typing or a dialog is open.
 */
export function takePlayerFocus(player: HTMLElement | null): void {
  if (!player) return;
  if (document.activeElement?.closest("input, textarea, select, [contenteditable], dialog[open]"))
    return;
  player.focus({ preventScroll: true });
}
