import { MeterOverlay } from '@/components/home/MeterOverlay';
import { TariffPicker } from '@/components/home/TariffPicker';
import { Colors } from '@/constants/theme';
import { MeterState, Tariff } from '@/types';
import { StyleSheet, View } from 'react-native';

type Props = {
  meter: MeterState | null;
  onPause: () => void;
  tariffs: Tariff[];
  selected: Tariff;
  tariffOpen: boolean;
  tariffLocked?: boolean;
  onTariffOpen: () => void;
  onTariffClose: () => void;
  onTariffSelect: (t: Tariff) => void;
};

/** Tariff selector + live fare meter during an active trip — content-sized, never hidden. */
export function TripToolsBar({
  meter,
  onPause,
  tariffs,
  selected,
  tariffOpen,
  tariffLocked,
  onTariffOpen,
  onTariffClose,
  onTariffSelect,
}: Props) {
  return (
    <View style={styles.bar}>
      {meter ? (
        <View style={styles.meterWrap}>
          <MeterOverlay meter={meter} onPause={onPause} layout="trip" />
        </View>
      ) : null}
      <TariffPicker
        tariffs={tariffs}
        selected={selected}
        open={tariffOpen}
        locked={tariffLocked}
        compact
        strip
        onOpen={onTariffOpen}
        onClose={onTariffClose}
        onSelect={onTariffSelect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexShrink: 0,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  meterWrap: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
});
