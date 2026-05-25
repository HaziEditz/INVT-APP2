import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDriver } from '@/context/DriverContext';

const REASONS: { id: string; label: string }[] = [
  { id: 'no_show',  label: 'No-show' },
  { id: 'rude',     label: 'Rude / abusive' },
  { id: 'damage',   label: 'Damage / mess' },
  { id: 'dispute',  label: 'Fare dispute' },
  { id: 'unsafe',   label: 'Unsafe' },
  { id: 'other',    label: 'Other' },
];

const AUTO_SKIP_SECS = 20;

const colors = {
  card: '#18181f', border: '#2a2a35', foreground: '#f1f5f9',
  muted: '#94a3b8', primary: '#facc15', success: '#22c55e',
  danger: '#ef4444', chip: '#1f1f29', chipActive: '#facc1522',
};

/**
 * Global trip-rating modal. Mounted once in _layout.tsx.
 * Driven entirely by `pendingRating` from DriverContext — no local triggers.
 */
export function TripRatingModal() {
  const { pendingRating, submitTripRating, clearPendingRating } = useDriver();

  const [stars, setStars]       = useState(0);
  const [reasons, setReasons]   = useState<string[]>([]);
  const [comment, setComment]   = useState('');
  const [secondsLeft, setSecs]  = useState(AUTO_SKIP_SECS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset + start auto-skip whenever a new rating is requested
  useEffect(() => {
    if (!pendingRating) return;
    setStars(0); setReasons([]); setComment('');
    setSecs(AUTO_SKIP_SECS);
    tickRef.current = setInterval(() => {
      setSecs(s => {
        if (s <= 1) {
          if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
          clearPendingRating();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [pendingRating?.bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pendingRating) return null;

  const showReasons = stars > 0 && stars <= 3;

  const toggleReason = (id: string) => {
    setReasons(r => r.includes(id) ? r.filter(x => x !== id) : [...r, id]);
  };

  const handleSubmit = () => {
    if (stars === 0) return;
    submitTripRating(
      pendingRating.bookingId,
      stars,
      pendingRating.source,
      {
        reasons,
        comment: comment.trim() || undefined,
        passengerPhone: pendingRating.passengerPhone,
        passengerName:  pendingRating.passengerName,
      },
    );
    clearPendingRating();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={clearPendingRating}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Ionicons name="star" size={28} color={colors.primary} />
            <Text style={styles.title}>Rate this trip</Text>
            <View style={styles.timerPill}>
              <Text style={styles.timerText}>{secondsLeft}s</Text>
            </View>
          </View>

          {!!pendingRating.passengerName && (
            <Text style={styles.sub} numberOfLines={1}>
              {pendingRating.passengerName}
            </Text>
          )}

          <View style={styles.starsRow}>
            {[1,2,3,4,5].map(s => (
              <TouchableOpacity key={s} onPress={() => setStars(s)} hitSlop={{top:6,bottom:6,left:6,right:6}}>
                <Ionicons
                  name={s <= stars ? 'star' : 'star-outline'}
                  size={38}
                  color={colors.primary}
                />
              </TouchableOpacity>
            ))}
          </View>

          {showReasons && (
            <>
              <Text style={styles.label}>What went wrong? (optional)</Text>
              <View style={styles.chipsRow}>
                {REASONS.map(r => {
                  const on = reasons.includes(r.id);
                  return (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => toggleReason(r.id)}
                      style={[styles.chip, on && styles.chipOn]}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Add a quick note (optional)"
                placeholderTextColor={colors.muted}
                value={comment}
                onChangeText={setComment}
                maxLength={140}
                multiline
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: stars === 0 ? colors.border : colors.success }]}
            disabled={stars === 0}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            <Text style={[styles.submitText, { color: stars === 0 ? colors.muted : '#fff' }]}>
              {stars === 0 ? 'Tap a star to rate' : 'Submit'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={clearPendingRating} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Text style={styles.skip}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.card, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 22, width: '100%', maxWidth: 420 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.foreground, flex: 1 },
  timerPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.chip, borderWidth: 1, borderColor: colors.border },
  timerText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.muted },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted, marginBottom: 14 },
  starsRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginVertical: 14 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.chip, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.chipActive, borderColor: colors.primary },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.muted },
  chipTextOn: { color: colors.primary },
  input: { backgroundColor: colors.chip, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.foreground, fontFamily: 'Inter_400Regular', fontSize: 14, minHeight: 44, marginBottom: 6 },
  submitBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  submitText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  skip: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.muted, textAlign: 'center', paddingVertical: 12, marginTop: 2 },
});
