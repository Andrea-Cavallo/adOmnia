import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-surface-0 p-8 font-mono text-error">
          <h2 className="mb-3 text-base font-semibold">Something went wrong</h2>
          <p className="max-w-xl text-xs leading-5 text-text-2">
            adOmnia hit a recoverable UI error. Your local data was not sent anywhere.
            Try recovering this view, or reload the app if the problem keeps happening.
          </p>
          <pre className="mt-3 whitespace-pre-wrap text-xs text-error/80">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-5 h-8 rounded-md bg-accent px-4 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Try to recover
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
