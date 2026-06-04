import { Colors } from '@/constants/theme';
import { MainPanelTab } from '@/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  active: MainPanelTab;
  offersCount: number;
  hasCurrent: boolean;
  queueCount: number;
  onChange: (tab: MainPanelTab) => void;
};

export function HomeMainTabs({ active, offersCount, hasCurrent, queueCount, onChange }: Props) {
  const tabs: { id: MainPanelTab; label: string; badge?: number }[] = [
    { id: 'offers', label: 'Offers', badge: offersCount },
    { id: 'current', label: 'Current' },
    { id: 'queue', label: 'Queue', badge: queueCount },
  ];

  return (
    <View style={styles.row}>
      {tabs.map((t) => {
        const isActive = active === t.id;
        const showDot = t.id === 'current' && hasCurrent;
        return (
          <Pressable
            key={t.id}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => onChange(t.id)}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{t.label}</Text>
            {t.badge != null && t.badge > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{t.badge > 99 ? '99+' : t.badge}</Text>
              </View>
            ) : null}
            {showDot && !t.badge ? <View style={styles.dot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.accent },
  label: { color: Colors.textMuted, fontSize: 14, fontWeight: '700' },
  labelActive: { color: Colors.text },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
});
