import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { submitReport } from '../services/syncService';
import type { PendingReport, ReportStatus, Disaster } from '../api/apiClient';
import { userStorage } from '../db/userStorage';
import {
  C, R, SHADOW, statusColor, statusDim, STATUS_LABEL, STATUS_ICON, DISASTER_ICON,
} from '../theme';

const DEFAULT_LOCATION = { lat: 22.3, lng: 114.1 };
const USER_KEY = 'rs_user';

/** The three first-person statuses a person can self-report to clear the gate. */
const SAFETY_OPTIONS: { value: ReportStatus; sub: string }[] = [
  { value: 'safe',      sub: 'I am unharmed and out of danger' },
  { value: 'injured',   sub: 'I am hurt and need medical attention' },
  { value: 'need_help', sub: 'Send rescuers to my location now' },
];

function severityLabel(s: number | null | undefined): string {
  if (!s || s < 3) return 'Minor';
  if (s < 4) return 'Moderate';
  if (s < 5) return 'Severe';
  return 'Extreme';
}

function readProfile(): { name: string; phone: string | null } {
  try {
    const raw = userStorage.get(USER_KEY);
    if (!raw) return { name: '', phone: null };
    const p = JSON.parse(raw) as { name?: string | null; phone?: string | null };
    return { name: p.name || '', phone: p.phone || null };
  } catch {
    return { name: '', phone: null };
  }
}

async function resolveLocation(): Promise<{ lat: number; lng: number }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return DEFAULT_LOCATION;
    const pos = await Location.getCurrentPositionAsync({});
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return DEFAULT_LOCATION;
  }
}

interface Props {
  disaster: Disaster;
  /** Called once the user has reported their safety for this disaster. */
  onReported: () => void;
}

/**
 * Full-screen, non-dismissable gate shown when the device is inside an active
 * disaster zone. Replaces the entire tab navigator until the user confirms
 * their safety — enforcing "report your safety before using any other feature".
 */
export default function DisasterModeScreen({ disaster, onReported }: Props): React.JSX.Element {
  const profile = readProfile();
  const [name,       setName]       = useState(profile.name);
  const [submitting, setSubmitting] = useState<ReportStatus | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const disasterType = (disaster.type || 'Disaster').replace(/^\w/, (c) => c.toUpperCase());

  async function report(status: ReportStatus): Promise<void> {
    if (!name.trim()) {
      setError('Please enter your name so rescue teams and family can identify you.');
      return;
    }
    setError(null);
    setSubmitting(status);
    try {
      const loc = await resolveLocation();
      const report: PendingReport = {
        id:            randomUUID(),
        name:          name.trim(),
        status,
        lat:           loc.lat,
        lng:           loc.lng,
        medical_notes: null,
        phone:         profile.phone,
        personal_id:   null,
        created_at:    Date.now(),
        disaster_id:   disaster.id,
        reported_by:   'self',
        reporter_name: null,
        user_type:     'mobile',
      };
      // submitReport always persists to the durable outbox first, so even if
      // delivery is queued offline the user has reported — clear the gate.
      await submitReport(report);
      onReported();
    } catch {
      // Report is durable in the outbox; let the user through rather than trap them.
      onReported();
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <SafeAreaView style={S.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={S.container} keyboardShouldPersistTaps="handled">
        {/* Alert banner */}
        <View style={S.alertBadge}>
          <Ionicons name="warning" size={16} color={C.textInv} />
          <Text style={S.alertBadgeText}>EMERGENCY · ACTION REQUIRED</Text>
        </View>

        {/* Disaster summary */}
        <View style={S.hero}>
          <View style={S.heroIcon}>
            <Ionicons
              name={(DISASTER_ICON[disaster.type?.toLowerCase()] ?? 'alert-circle') as any}
              size={34}
              color={C.critical}
            />
          </View>
          <Text style={S.heroTitle}>{disasterType} in your area</Text>
          <View style={S.heroMetaRow}>
            <View style={S.heroChip}>
              <Text style={S.heroChipText}>{severityLabel(disaster.severity)}</Text>
            </View>
            <View style={S.heroChip}>
              <Ionicons name="resize" size={12} color={C.textLo} />
              <Text style={S.heroChipText}>{disaster.radius_km} km radius</Text>
            </View>
          </View>
          {disaster.description ? (
            <Text style={S.heroDesc}>{disaster.description}</Text>
          ) : null}
        </View>

        {/* Prompt */}
        <Text style={S.prompt}>You appear to be inside the affected zone.</Text>
        <Text style={S.promptSub}>
          Confirm your safety to continue. This is shared with rescue teams and your family —
          you can't use other features until you respond.
        </Text>

        {/* Name */}
        <Text style={S.fieldLabel}>YOUR NAME</Text>
        <TextInput
          style={S.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Mei Wong"
          placeholderTextColor={C.textLo}
          autoComplete="name"
          editable={submitting === null}
        />

        {error ? (
          <View style={S.errorBox}>
            <Ionicons name="alert-circle" size={15} color={C.critical} />
            <Text style={S.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Safety actions */}
        <Text style={[S.fieldLabel, { marginTop: 20 }]}>I AM CURRENTLY</Text>
        {SAFETY_OPTIONS.map((opt) => {
          const col = statusColor(opt.value);
          const dim = statusDim(opt.value);
          const busy = submitting === opt.value;
          const disabled = submitting !== null;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[S.action, { backgroundColor: dim, borderColor: col }, disabled && !busy && S.actionDimmed]}
              onPress={() => report(opt.value)}
              disabled={disabled}
              activeOpacity={0.85}
            >
              <View style={[S.actionIcon, { backgroundColor: C.bgPanel }]}>
                {busy ? (
                  <ActivityIndicator color={col} />
                ) : (
                  <Ionicons name={(STATUS_ICON[opt.value] ?? 'ellipse') as any} size={26} color={col} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.actionLabel, { color: col }]}>{STATUS_LABEL[opt.value] || opt.value}</Text>
                <Text style={S.actionSub}>{opt.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={col} />
            </TouchableOpacity>
          );
        })}

        <View style={S.reassure}>
          <Ionicons name="lock-closed" size={13} color={C.textLo} />
          <Text style={S.reassureText}>
            Exact location and medical details are visible to authorized rescue teams only.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bgCanvas },
  container: { padding: 20, paddingBottom: 36 },

  alertBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6,
    backgroundColor: C.critical, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: R.pill, marginBottom: 20,
  },
  alertBadgeText: { color: C.textInv, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },

  hero: {
    alignItems: 'center', padding: 20, borderRadius: R.md,
    backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.criticalBorder,
    marginBottom: 24, ...SHADOW.card,
  },
  heroIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: C.criticalDim,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    borderWidth: 2, borderColor: C.criticalBorder,
  },
  heroTitle:   { fontSize: 22, fontWeight: '800', color: C.textHi, textAlign: 'center' },
  heroMetaRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: C.bgRaised, borderWidth: 1, borderColor: C.border,
  },
  heroChipText: { fontSize: 12, fontWeight: '700', color: C.textMd },
  heroDesc:     { fontSize: 14, color: C.textMd, textAlign: 'center', lineHeight: 20, marginTop: 14 },

  prompt:    { fontSize: 17, fontWeight: '700', color: C.textHi, textAlign: 'center' },
  promptSub: { fontSize: 13, color: C.textLo, textAlign: 'center', lineHeight: 19, marginTop: 6, marginBottom: 20 },

  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: C.textMd, marginBottom: 7 },
  input: {
    backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.borderStrong,
    borderRadius: R.sm, padding: 14, fontSize: 16, color: C.textHi,
  },

  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 10,
    padding: 11, borderRadius: R.sm, backgroundColor: C.criticalDim,
    borderWidth: 1, borderColor: C.criticalBorder,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: '600', color: C.critical, lineHeight: 18 },

  action: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, borderRadius: R.md, borderWidth: 1.5, marginBottom: 12,
    ...SHADOW.card,
  },
  actionDimmed: { opacity: 0.45 },
  actionIcon: {
    width: 52, height: 52, borderRadius: R.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  actionLabel: { fontSize: 18, fontWeight: '800' },
  actionSub:   { fontSize: 13, color: C.textLo, marginTop: 2 },

  reassure: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    marginTop: 12, paddingHorizontal: 4,
  },
  reassureText: { flex: 1, fontSize: 12, color: C.textLo, lineHeight: 17 },
});
