import type { ComponentProps, ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleProp, ViewStyle } from 'react-native';

type Props = {
  href: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
} & Omit<ComponentProps<typeof Pressable>, 'onPress' | 'children' | 'style'>;

export function ExternalLink({ href, children, style, ...rest }: Props) {
  const open = () => {
    if (Platform.OS === 'web') {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    void Linking.openURL(href);
  };

  return (
    <Pressable style={style} onPress={open} accessibilityRole="link" {...rest}>
      {children}
    </Pressable>
  );
}
