import { useColorScheme } from 'react-native';
import { colors, ColorTheme } from '@/constants/colors';

export function useColors(): ColorTheme {
  const scheme = useColorScheme();
  return scheme === 'light' ? colors.light : colors.dark;
}
