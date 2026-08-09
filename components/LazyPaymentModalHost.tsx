import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PaymentModalFallback } from '@/components/PaymentModalFallback';
import { Colors } from '@/constants/theme';
import React, { Component } from 'react';
import { ActivityIndicator, View } from 'react-native';

type State = {
  Comp: React.ComponentType | null;
  loadError: Error | null;
};

/**
 * Dynamic require keeps expo-camera / stripe-terminal / OCR off the critical
 * path for app/_layout.tsx so AuthProvider always mounts.
 */
export class LazyPaymentModalHost extends Component<object, State> {
  state: State = { Comp: null, loadError: null };

  private load = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@/components/PaymentModal') as {
        PaymentModal: React.ComponentType;
      };
      this.setState({ Comp: mod.PaymentModal, loadError: null });
    } catch (err: unknown) {
      console.error('[LazyPaymentModalHost] failed to load PaymentModal:', err);
      const message =
        err instanceof Error ? err.message : String((err as { message?: string })?.message || err);
      this.setState({ Comp: null, loadError: new Error(message) });
    }
  };

  componentDidMount() {
    this.load();
  }

  render() {
    const { Comp, loadError } = this.state;
    if (loadError) {
      return (
        <PaymentModalFallback
          errorMessage={loadError.message}
          onRetry={() => {
            this.setState({ Comp: null, loadError: null });
            this.load();
          }}
        />
      );
    }
    if (!Comp) {
      return (
        <View style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      );
    }
    return (
      <ErrorBoundary
        name="PaymentModal"
        renderFallback={(error, reset) => (
          <PaymentModalFallback errorMessage={error.message} onRetry={reset} />
        )}
      >
        <Comp />
      </ErrorBoundary>
    );
  }
}
