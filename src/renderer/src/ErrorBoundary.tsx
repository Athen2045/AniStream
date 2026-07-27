import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
}

/**
 * Keeps an uncaught render error from blanking the whole window. Matches the
 * "truthful degraded state" philosophy in API.md: report what broke and offer a
 * reload, rather than a silent white screen with no signal for the user.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {};

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error("AniStream hit an unknown error.") };
  }

  public componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("AniStream renderer crashed:", error, info.componentStack);
  }

  public render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark">A</div>
          <p className="eyebrow">Something went wrong</p>
          <h1>AniStream hit a snag</h1>
          <p className="login-copy">
            The window ran into an unexpected error and stopped rendering. Your saved AniList
            session and local library are untouched.
          </p>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Reload AniStream
          </button>
          <p className="error-banner">{this.state.error.message}</p>
        </section>
      </main>
    );
  }
}
