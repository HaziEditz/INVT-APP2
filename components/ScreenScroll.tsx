import { sharedStyles } from '@/constants/styles';
import { ReactNode } from 'react';
import { ScrollView, ScrollViewProps, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = ScrollViewProps & {
  children: ReactNode;
  /** Include bottom safe inset (default true). Set false when a tab bar handles bottom inset. */
  padBottom?: boolean;
};

export function ScreenScroll({ children, contentContainerStyle, padBottom = true, ...rest }: Props) {
  const insets = useSafeAreaInsets();
  const bottomPad = padBottom ? Math.max(insets.bottom, 16) + 12 : 16;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        {...rest}
        style={[sharedStyles.screen, rest.style]}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
});
