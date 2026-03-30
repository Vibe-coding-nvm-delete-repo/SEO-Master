import React from 'react';

type Props = { children: React.ReactNode; fallbackLabel?: string };
type State = { hasError: boolean; error: Error | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ErrorBoundary: any = (() => {
  const Comp = class extends React.Component<Props, State> {
    constructor(p: Props) { super(p); (this as any).state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error: Error): State { return { hasError: true, error }; }
    componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('ErrorBoundary caught:', error, info.componentStack); }
    render() {
      const s = (this as any).state as State;
      const p = (this as any).props as Props;
      if (s.hasError) {
        return (
          <div className="max-w-4xl mx-auto mt-8 p-6 bg-white border border-red-200 rounded-xl shadow-sm text-center">
            <div className="text-red-500 text-lg font-semibold mb-2">Something went wrong</div>
            <p className="text-sm text-zinc-500 mb-1">{p.fallbackLabel || 'An unexpected error occurred.'}</p>
            <p className="text-xs text-zinc-400 mb-4 font-mono">{s.error?.message}</p>
            <button
              onClick={() => (this as any).setState({ hasError: false, error: null })}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              Try Again
            </button>
          </div>
        );
      }
      return p.children;
    }
  };
  return Comp as React.ComponentType<Props>;
})();

export default ErrorBoundary;
