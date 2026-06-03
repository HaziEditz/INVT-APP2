import { Redirect } from 'expo-router';

/** Active job UI lives on the Main tab map screen. */
export default function ActiveJobScreen() {
  return <Redirect href="/(tabs)" />;
}
