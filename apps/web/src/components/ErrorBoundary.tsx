import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  name?: string;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Enterprise React Error Boundary.
 * Prevents single component or malformed conversation record errors from crashing
 * the entire clinic dashboard into a blank screen.
 *
 * Logs sanitized error telemetry without exposing PII or credentials.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Structured console error without logging user inputs or sensitive payloads
    console.error(`[ErrorBoundary] Caught error in ${this.props.name || 'Component'}:`, {
      name: error.name,
      message: error.message,
      componentStack: errorInfo.componentStack?.slice(0, 500),
    });
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          style={{
            padding: '24px',
            margin: '16px',
            borderRadius: '12px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f87171',
            }}
          >
            <AlertTriangle size={24} />
          </div>

          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
            Unable to display {this.props.name || 'this section'}
          </h3>

          <p style={{ fontSize: '13px', color: '#94a3b8', maxWidth: '480px', margin: 0, lineHeight: 1.5 }}>
            An unexpected display error occurred while rendering this data. Other clinic dashboard operations
            remain fully operational.
          </p>

          <button
            onClick={this.handleReset}
            style={{
              marginTop: '8px',
              padding: '8px 16px',
              borderRadius: '8px',
              backgroundColor: '#0284c7',
              border: 'none',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={14} /> Retry View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
