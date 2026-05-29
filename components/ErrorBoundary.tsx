import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reloadAppAsync } from 'expo';
import { useColors } from '@/hooks/useColors';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({ error }: { error: Error | null }) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}
    >
      <Text style={[styles.icon, { color: colors.error }]}>!</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Something went wrong</Text>
      {!!error && (
        <View style={[styles.errorBox, { backgroundColor: colors.surface, borderColor: colors.error }]}>
          <Text style={[styles.errorName, { color: colors.error }]}>{error.name}: {error.message}</Text>
          {!!error.stack && (
            <Text style={[styles.errorStack, { color: colors.mutedForeground }]} numberOfLines={12}>
              {error.stack}
            </Text>
          )}
        </View>
      )}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={() => reloadAppAsync()}
      >
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Restart App</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error.message, '\nStack:', error.stack, '\nComponent:', info.componentStack);
    try {
      const Sentry = require('@sentry/react-native');
      Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    } catch {}
  }

  render() {
    if (this.state.hasError) return <ErrorFallback error={this.state.error} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { fontSize: 48, fontWeight: '700', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  errorBox: { width: '100%', padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 24 },
  errorName: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  errorStack: { fontSize: 11, lineHeight: 16 },
  button: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
  buttonText: { fontSize: 16, fontWeight: '700' },
});
