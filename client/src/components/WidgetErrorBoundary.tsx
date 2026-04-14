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
}

export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
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
    this.setState({ hasError: false, error: null });
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

    return this.props.children;
  }
}
