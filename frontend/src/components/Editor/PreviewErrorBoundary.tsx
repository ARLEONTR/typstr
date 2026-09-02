import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  resetKey: string
  message?: string
  retryLabel?: string
}

type State = {
  hasError: boolean
}

export default class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Preview rendering failed', error, info)
  }

  override componentDidUpdate(prevProps: Props): void {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  private readonly handleRetry = () => {
    this.setState({ hasError: false })
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          minHeight: 0,
          height: '100%',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          background: 'var(--editor-bg)',
          color: 'var(--text-soft)',
          textAlign: 'center',
        }}
        >
          <div>
            <p style={{ margin: '0 0 0.75rem' }}>{this.props.message ?? 'The preview hit a rendering error.'}</p>
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                border: '1px solid var(--action-border)',
                background: 'var(--action-bg)',
                color: 'var(--text-bright)',
                borderRadius: '999px',
                padding: '0.45rem 0.9rem',
                cursor: 'pointer',
              }}
            >
              {this.props.retryLabel ?? 'Reload preview'}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
