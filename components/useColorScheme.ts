import { useColorScheme as useColorSchemeCore } from 'react-native';

export type AppColorScheme = 'light' | 'dark';

export const useColorScheme = (): AppColorScheme => {
  const coreScheme = useColorSchemeCore();
  return coreScheme === 'dark' ? 'dark' : 'light';
};
