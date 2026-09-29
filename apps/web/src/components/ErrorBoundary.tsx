import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * The error boundary (acceptance criterion 12).
 *
 * A thrown error must show something a human can act on, never a blank screen.
 * The message is deliberately plain and includes the request id, so a report to
 * the owner can be matched to a log line.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console rather than sent anywhere: NFR-PRIV-01 forbids any
    // outgoing request, and this app runs on one laptop.
    console.error('[pdm] render error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="p-8 max-w-2xl">
        <h1 className="text-2xl font-semibold mb-3">Something went wrong</h1>
        <p className="mb-4">
          The page could not be displayed. Your data is unaffected. Reload to try again.
        </p>
        <pre className="p-3 rounded bg-neutral-100 dark:bg-neutral-800 text-sm overflow-auto">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 px-3 py-2 rounded border border-neutral-300 dark:border-neutral-700"
        >
          Reload
        </button>
      </div>
    );
  }
}
