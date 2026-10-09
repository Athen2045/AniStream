/**
 * Shown while an embedded player starts (approved 2026-10-07): a green ring around the play mark,
 * what is starting, and, when players are tried in order, which one is being tried.
 */
export function PlayerStarting({
  title,
  detail,
  backdropUrl,
  players,
}: {
  title: string;
  detail?: string;
  backdropUrl?: string;
  /** Fallback order: `tried` players already had nothing; `current` is being tried now. */
  players?: { total: number; current: number; tried: readonly number[] };
}): React.JSX.Element {
  return (
    <div className="player-starting" role="status" aria-live="polite">
      <div
        className="player-starting-backdrop"
        aria-hidden="true"
        style={backdropUrl ? { backgroundImage: `url("${backdropUrl}")` } : undefined}
      />
      <span className="player-starting-ring" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"
          />
        </svg>
      </span>
      <strong className="player-starting-title">{title}</strong>
      {detail ? <p className="player-starting-detail">{detail}</p> : null}
      {players && players.total > 1 ? (
        <span
          className="player-starting-steps"
          aria-label={`Player ${players.current + 1} of ${players.total}`}
        >
          {Array.from({ length: players.total }, (_, index) => (
            <i
              key={index}
              className={
                index === players.current
                  ? "is-now"
                  : players.tried.includes(index)
                    ? "is-tried"
                    : undefined
              }
            />
          ))}
        </span>
      ) : null}
    </div>
  );
}
