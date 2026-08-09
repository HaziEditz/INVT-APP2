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
 * Deferred load of PaymentModal so camera/OCR/Terminal stay off the critical
 * AuthProvider mount path.
 *
 * IMPORTANT: use a relative require(). Metro does not reliably resolve `@/`
 * aliases inside require(), which produced:
 *   Cannot read property 'PaymentModal' of undefined
 */
export class LazyPaymentModalHost extends Component<object, State> {
  state: State = { Comp: null, loadError: null };

  private load = () => {
    try {
      // Relative path — do not use `@/…` here.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./PaymentModal') as {
        PaymentModal?: React.ComponentType;
        default?: React.ComponentType;
      };
      const Comp = mod?.PaymentModal ?? mod?.default ?? null;
      if (!Comp) {
        throw new Error(
          'PaymentModal module loaded but export is missing (expected named PaymentModal).',
        );
      }
      this.setState({ Comp, loadError: null });
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
