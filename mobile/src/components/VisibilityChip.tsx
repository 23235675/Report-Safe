import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { R, VISIBILITY, type VisibilityTier } from '../theme';

/**
 * VisibilityChip — makes a report's data-exposure tier legible at a glance.
 * One consistent icon + colour per privacy tier, matching the web VisibilityChip
 * so both surfaces read as one system.
 */
export default function VisibilityChip({
  tier,
  short = false,
}: {
  tier: VisibilityTier;
  short?: boolean;
}): React.JSX.Element {
  const v = VISIBILITY[tier];
  return (
    <View style={[S.chip, { backgroundColor: v.dim, borderColor: v.border }]}>
      <Ionicons name={v.icon as any} size={12} color={v.color} />
      <Text style={[S.text, { color: v.color }]}>{short ? v.short : v.label}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: R.pill, borderWidth: 1, alignSelf: 'flex-start',
  },
  text: { fontSize: 11, fontWeight: '600' },
});
