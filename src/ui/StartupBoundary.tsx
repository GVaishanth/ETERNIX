import { Component, type ErrorInfo, type ReactNode } from 'react';

/*
 * Catches a failure while the game starts (for example, no WebGL context). Without it React unmounts the whole tree and
 * the page is blank with no explanation. The fallback names the requirement and offers a reload. The raw error is shown
 * only in development builds. This is a start-up guard, not a gameplay error handler: it never retries or changes state.
 */

interface StartupBoundaryProps {
  children: ReactNode;
}

interface StartupBoundaryState {
  error: Error | null;
}

export class StartupBoundary extends Component<StartupBoundaryProps, StartupBoundaryState> {
  override state: StartupBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StartupBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged once, when the game fails to start. Never per frame.
    console.error('[eternix] the game failed to start', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="startup-error" role="alert">
        <h1>ETERNIX could not start</h1>
        <p>
          The game needs WebGL, the browser's 3D graphics interface. Turn on hardware acceleration in your browser
          settings, or try another current browser, then reload this page.
        </p>
        {import.meta.env.DEV ? <pre className="startup-error-detail">{error.message}</pre> : null}
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
        <a className="startup-error-door" href="./index.html" aria-label="Back to the front page" title="Back to the front page">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18" />
            <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V21" />
            <circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        </a>
      </div>
    );
  }
}
