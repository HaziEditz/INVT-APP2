import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

const MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '';

interface Suggestion {
  place_id: string;
  description: string;
}

interface AddressInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  iconName?: string;
  iconColor?: string;
  onSelect?: (address: string) => void;
}

export function AddressInput({
  value, onChangeText, placeholder = 'Address', iconName = 'location', iconColor,
  onSelect,
}: AddressInputProps) {
  const colors = useColors();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = async (text: string) => {
    if (!text || text.length < 3 || !MAPS_KEY || !apiAvailable) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const url =
        `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
        `?input=${encodeURIComponent(text)}&key=${MAPS_KEY}&language=en&types=address`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.status === 'REQUEST_DENIED' || json.status === 'INVALID_REQUEST') {
        setApiAvailable(false);
        setSuggestions([]);
        return;
      }
      if (json.status === 'OK') {
        setSuggestions(json.predictions as Suggestion[]);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (text: string) => {
    onChangeText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length >= 3 && apiAvailable && MAPS_KEY) {
      debounceRef.current = setTimeout(() => fetchSuggestions(text), 400);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSelect = (s: Suggestion) => {
    onChangeText(s.description);
    onSelect?.(s.description);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const ic = iconColor ?? colors.mutedForeground;

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <Ionicons name={iconName as any} size={18} color={ic} style={styles.icon} />
        <TextInput
          style={[styles.input, { color: colors.foreground }]}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={value}
          onChangeText={handleChange}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          multiline={false}
          returnKeyType="done"
        />
        {loading && <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginRight: 4 }} />}
        {value.length > 0 && (
          <TouchableOpacity onPress={() => { onChangeText(''); setSuggestions([]); setShowSuggestions(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {showSuggestions && suggestions.length > 0 && (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {suggestions.map(s => (
            <TouchableOpacity
              key={s.place_id}
              style={[styles.suggestionRow, { borderBottomColor: colors.border }]}
              onPress={() => handleSelect(s)}
              activeOpacity={0.7}
            >
              <Ionicons name="location-outline" size={14} color={colors.mutedForeground} style={{ marginTop: 1 }} />
              <Text style={[styles.suggestionText, { color: colors.foreground }]} numberOfLines={2}>
                {s.description}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative', zIndex: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 14, gap: 10,
  },
  icon: {},
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', minHeight: 22 },
  dropdown: {
    position: Platform.OS === 'web' ? 'absolute' : 'relative',
    top: Platform.OS === 'web' ? '100%' : 0,
    left: 0, right: 0,
    borderWidth: 1,
    borderRadius: 14,
    marginTop: Platform.OS === 'web' ? 4 : 0,
    overflow: 'hidden',
    zIndex: 100,
    maxHeight: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    boxShadow: '0px 4px 8px rgba(0,0,0,0.12)',
    elevation: 8,
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
});
