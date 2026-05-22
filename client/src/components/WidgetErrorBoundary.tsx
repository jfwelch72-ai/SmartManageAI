import { Component, type ReactNode, type ErrorInfo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface WidgetErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
}

interface WidgetErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /**
   * Incremented each time the user (or auto-retry logic) clicks Retry.
   * Passing this as the `key` on the Fragment wrapper forces React to
   * fully unmount and remount the children instead of patching the
   * existing fiber in-place. Without this, a retry after a mid-render
   * crash re-uses the stale fiber (which has fewer hook slots recorded
   * from the partial failed render) and immediately re-throws
   * "Rendered more hooks than during the previous render" or
   * "Should have a queue. This is likely a bug in React." — both of
   * which are downstream symptoms of a corrupted hook-list, not the
   * true root cause.
   */
  retryKey: number;
}

export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<WidgetErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[WidgetErrorBoundary] ${this.props.fallbackTitle || "Widget"} crashed:`,
      error,
      errorInfo
    );
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryKey: prev.retryKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card data-testid="widget-error-boundary">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <AlertCircle className="w-7 h-7 text-destructive opacity-70" />
            <p className="text-sm font-medium text-foreground">
              {this.props.fallbackTitle || "Something went wrong"}
            </p>
            <p className="text-xs text-muted-foreground max-w-[200px]">
              This section encountered an error and couldn't render.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={this.handleRetry}
              data-testid="button-retry-widget"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div key={this.state.retryKey} style={{ display: "contents" }}>
        {this.props.children}
      </div>
    );
  }
}
