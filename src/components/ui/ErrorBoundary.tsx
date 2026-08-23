import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './Feedback';

/**
 * Last line of defence: a render error anywhere below shows a readable message
 * instead of a white page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md px-4 py-20">
          <ErrorState
            title="Something went wrong on this page"
            description={this.state.error.message}
            action={
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                Reload the app
              </button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
