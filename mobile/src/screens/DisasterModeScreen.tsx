import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { submitReport } from '../services/syncService';
import type { PendingReport, ReportStatus, Disaster } from '../api/apiClient';
import { userStorage } from '../db/userStorage';
import { useTranslation } from '../i18n';
import { resolveLocation } from '../utils/location';
import {
  C, R, SHADOW, STATUS_ICON, DISASTER_ICON,
} from '../theme';

const USER_KEY = 'rs_user';

/** The three first-person statuses a person can self-report to clear the gate. */
const SAFETY_OPTIONS: { value: ReportStatus; subKey: string }[] = [
  { value: 'safe',      subKey: 'disasterMode.subSafe' },
  { value: 'injured',   subKey: 'disasterMode.subInjured' },
  { value: 'need_help', subKey: 'disasterMode.subNeedHelp' },
];

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
  const { t, statusLabel, severityLabel, disasterTypeLabel } = useTranslation();
  const profile = readProfile();
  const [name,       setName]       = useState(profile.name);
  const [submitting, setSubmitting] = useState<ReportStatus | null>(null);
  const [error,      setError]      = useState<string | null>(null);

  const disasterType = disasterTypeLabel(disaster.type) || 'Disaster';

  async function report(status: ReportStatus): Promise<void> {
    if (!name.trim()) {
      setError(t('disasterMode.errName'));
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
          <Text style={S.alertBadgeText}>{t('disasterMode.emergencyBadge')}</Text>
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
          <Text style={S.heroTitle}>{t('disasterMode.inYourArea', { type: disasterType })}</Text>
          <View style={S.heroMetaRow}>
            <View style={S.heroChip}>
              <Text style={S.heroChipText}>{severityLabel(disaster.severity)}</Text>
            </View>
            <View style={S.heroChip}>
              <Ionicons name="resize" size={12} color={C.textLo} />
              <Text style={S.heroChipText}>{t('disasterMode.kmRadius', { n: disaster.radius_km })}</Text>
            </View>
          </View>
          {disaster.description ? (
            <Text style={S.heroDesc}>{disaster.description}</Text>
          ) : null}
        </View>

        {/* Prompt */}
        <Text style={S.prompt}>{t('disasterMode.prompt')}</Text>
        <Text style={S.promptSub}>
          {t('disasterMode.promptSub')}
        </Text>

        {/* Name */}
        <Text style={S.fieldLabel}>{t('disasterMode.yourName')}</Text>
        <TextInput
          style={S.input}
          value={name}
          onChangeText={setName}
          placeholder={t('disasterMode.phName')}
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
        <Text style={[S.fieldLabel, { marginTop: 20 }]}>{t('disasterMode.iAmCurrently')}</Text>
        {SAFETY_OPTIONS.map((opt) => {
          const busy = submitting === opt.value;
          const disabled = submitting !== null;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[S.action, disabled && !busy && S.actionDimmed]}
              onPress={() => report(opt.value)}
              disabled={disabled}
              activeOpacity={0.85}
            >
              <View style={S.actionIcon}>
                {busy ? (
                  <ActivityIndicator color={C.textMd} />
                ) : (
                  <Ionicons name={(STATUS_ICON[opt.value] ?? 'ellipse') as any} size={26} color={C.textMd} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.actionLabel}>{statusLabel(opt.value)}</Text>
                <Text style={S.actionSub}>{t(opt.subKey)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={C.textLo} />
            </TouchableOpacity>
          );
        })}

        <View style={S.reassure}>
          <Ionicons name="lock-closed" size={13} color={C.textLo} />
          <Text style={S.reassureText}>
            {t('disasterMode.reassure')}
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
    padding: 14, borderRadius: R.md, borderWidth: 1, marginBottom: 12,
    backgroundColor: C.bgPanel, borderColor: C.borderStrong,
    ...SHADOW.card,
  },
  actionDimmed: { opacity: 0.45 },
  actionIcon: {
    width: 52, height: 52, borderRadius: R.sm, backgroundColor: C.bgRaised,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  actionLabel: { fontSize: 18, fontWeight: '800', color: C.textHi },
  actionSub:   { fontSize: 13, color: C.textLo, marginTop: 2 },

  reassure: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    marginTop: 12, paddingHorizontal: 4,
  },
  reassureText: { flex: 1, fontSize: 12, color: C.textLo, lineHeight: 17 },
});
