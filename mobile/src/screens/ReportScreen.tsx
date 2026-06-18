import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, Switch,
} from 'react-native';
import * as Location from 'expo-location';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { submitReport } from '../services/syncService';
import type { PendingReport, ReportStatus } from '../api/apiClient';
import { isValidHKID, normalizeHKID } from '../utils/hkid';
import { C, R, SHADOW, statusColor, statusDim, STATUS_LABEL, STATUS_ICON } from '../theme';
import VisibilityChip from '../components/VisibilityChip';

const DEFAULT_LOCATION = { lat: 22.3, lng: 114.1 };

type StatusOption = {
  value: ReportStatus;
  sub:   string;
};

const SELF_STATUSES: StatusOption[] = [
  { value: 'safe',      sub: 'I am unharmed' },
  { value: 'injured',   sub: 'I need medical attention' },
  { value: 'need_help', sub: 'Send rescuers to my location' },
];

const PROXY_STATUSES: StatusOption[] = [
  { value: 'safe',              sub: 'They are unharmed' },
  { value: 'injured',           sub: 'Needs medical attention' },
  { value: 'need_help',         sub: 'Needs rescuers' },
  { value: 'awaiting_response', sub: 'In disaster zone, not confirmed' },
  { value: 'missing',           sub: 'Last seen in affected area' },
];

function msgColors(kind: string) {
  switch (kind) {
    case 'success': return { bg: C.safeDim,     border: C.safe,     text: C.safe };
    case 'warn':    return { bg: C.awaitingDim,  border: C.awaiting,  text: C.awaiting };
    case 'error':   return { bg: C.criticalDim, border: C.critical, text: C.critical };
    default:        return { bg: C.amberDim,    border: C.amber,    text: C.amber };
  }
}

interface Props {
  route?: { params?: { initialStatus?: ReportStatus; proxy?: boolean; prefilledName?: string } };
}

export default function ReportScreen({ route }: Props): React.JSX.Element {
  const params        = route?.params;
  const [isProxy,     setIsProxy]     = useState(params?.proxy === true);
  const [subjectName, setSubjectName] = useState(params?.prefilledName ?? '');
  const [reporterName,setReporterName]= useState('');
  const [status,      setStatus]      = useState<ReportStatus>(
    params?.initialStatus ?? 'safe'
  );
  const [notes,       setNotes]       = useState('');
  const [phone,       setPhone]       = useState('');
  const [personalId,  setPersonalId]  = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [message,     setMessage]     = useState<{ kind: string; text: string } | null>(null);
  const [success,     setSuccess]     = useState(false);
  const [lastRefId,   setLastRefId]   = useState<string | null>(null);

  const statusOptions = isProxy ? PROXY_STATUSES : SELF_STATUSES;
  const showNotes     = status === 'injured' || status === 'need_help';

  // Reset status when switching proxy mode if current status is proxy-only
  useEffect(() => {
    if (!isProxy && !SELF_STATUSES.find((s) => s.value === status)) {
      setStatus('safe');
    }
  }, [isProxy]);

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

  function resetForm(): void {
    setSubjectName('');
    setReporterName('');
    setStatus('safe');
    setNotes('');
    setPhone('');
    setPersonalId('');
    setMessage(null);
  }

  async function onSubmit(): Promise<void> {
    if (!subjectName.trim()) {
      setMessage({ kind: 'error', text: isProxy
        ? 'Please enter the name of the person being reported.'
        : 'Please enter your name.' });
      return;
    }
    if (isProxy && !reporterName.trim()) {
      setMessage({ kind: 'error', text: 'Please enter your name as the reporter.' });
      return;
    }
    // Phone + HKID are required basic data for self-reports. For proxy
    // reports they are requested but not blocking — the reporter may not
    // know the subject's HKID, and a missing ID must never stop a rescue.
    if (!isProxy) {
      if (!phone.trim()) {
        setMessage({ kind: 'error', text: 'Please enter your phone number.' });
        return;
      }
      if (!personalId.trim()) {
        setMessage({ kind: 'error', text: 'Please enter your HKID number, e.g. A123456(7).' });
        return;
      }
    }
    if (personalId.trim() && !isValidHKID(personalId)) {
      setMessage({ kind: 'error', text: 'HKID looks invalid — check the format A123456(7).' });
      return;
    }

    setSubmitting(true);
    setMessage({ kind: 'info', text: 'Getting your location...' });

    try {
      const id     = randomUUID();
      const loc    = await resolveLocation();
      const report: PendingReport = {
        id,
        name:          subjectName.trim(),
        status,
        lat:           loc.lat,
        lng:           loc.lng,
        medical_notes: showNotes ? notes.trim() || null : null,
        phone:         phone.trim() || null,
        personal_id:   personalId.trim() ? normalizeHKID(personalId) : null,
        created_at:    Date.now(),
        reported_by:   isProxy ? 'family' : 'self',
        reporter_name: isProxy ? reporterName.trim() : null,
        user_type:     'mobile',
      };

      setMessage({ kind: 'info', text: 'Submitting...' });
      const result = await submitReport(report);

      if (result.delivered > 0 || result.relayed > 0) {
        setLastRefId(id);
        setSuccess(true);
        resetForm();
      } else if (result.rejected && result.rejected > 0) {
        // The server permanently refused it (e.g. bad data) — show the real
        // reason instead of pretending it's queued.
        setMessage({ kind: 'error', text: result.error || 'The server rejected this report. Please check the details and try again.' });
      } else {
        setMessage({ kind: 'warn', text: 'No connection — saved offline and will send when connected.' });
      }
    } catch {
      setMessage({ kind: 'error', text: 'Report saved locally. Will retry automatically.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <View style={[S.bg, { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
        <View style={S.successCircle}>
          <Ionicons name="checkmark-circle" size={72} color={C.safe} />
        </View>
        <Text style={S.successTitle}>Report Delivered</Text>
        <Text style={S.successSub}>Your status has been sent to rescue teams and family.</Text>
        <View style={S.refPill}>
          <Ionicons name="receipt-outline" size={13} color={C.textLo} />
          <Text style={S.refText}>Ref {lastRefId?.slice(0, 8)}</Text>
        </View>
        <TouchableOpacity
          style={[S.submitBtn, { width: '100%', marginTop: 28 }]}
          onPress={() => setSuccess(false)}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle-outline" size={18} color={C.textInv} />
          <Text style={S.submitText}>Submit Another Report</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={S.bg}
      contentContainerStyle={S.container}
      keyboardShouldPersistTaps="handled"
    >
      {/* Proxy toggle */}
      <View style={S.proxyToggle}>
        <Ionicons name={isProxy ? 'people' : 'person'} size={20} color={C.govBlue} />
        <View style={{ flex: 1 }}>
          <Text style={S.proxyLabel}>Reporting for someone else</Text>
          <Text style={S.proxySub}>Submit on behalf of a family member</Text>
        </View>
        <Switch
          value={isProxy}
          onValueChange={setIsProxy}
          trackColor={{ false: C.borderStrong, true: C.govBlue }}
          thumbColor={C.bgPanel}
        />
      </View>

      {/* Status selection */}
      <View style={S.sectionHeader}>
        <Text style={S.sectionLabel}>
          {isProxy ? 'Their current status' : 'I am currently'}
        </Text>
      </View>

      {statusOptions.map((opt) => {
        const active = status === opt.value;
        const col    = statusColor(opt.value);
        const dim    = statusDim(opt.value);
        return (
          <TouchableOpacity
            key={opt.value}
            style={[S.statusRow, active && { backgroundColor: dim, borderLeftColor: col }]}
            onPress={() => setStatus(opt.value)}
            activeOpacity={0.7}
          >
            <View style={[S.statusIconWrap, { backgroundColor: active ? dim : C.bgRaised }]}>
              <Ionicons
                name={(STATUS_ICON[opt.value] ?? 'ellipse-outline') as any}
                size={22}
                color={active ? col : C.textLo}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.statusLabel, { color: active ? col : C.textHi }]}>
                {STATUS_LABEL[opt.value] || opt.value}
              </Text>
              <Text style={S.statusSub}>{opt.sub}</Text>
            </View>
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={active ? col : C.borderStrong}
            />
          </TouchableOpacity>
        );
      })}

      {/* Form fields */}
      <View style={S.formPad}>
        {/* Subject name */}
        <Text style={S.fieldLabel}>
          {isProxy ? 'THEIR NAME (PERSON BEING REPORTED)' : 'YOUR NAME'}
        </Text>
        <TextInput
          style={S.input}
          value={subjectName}
          onChangeText={setSubjectName}
          placeholder={isProxy ? 'e.g. Wei Chen' : 'e.g. Mei Wong'}
          placeholderTextColor={C.textLo}
          autoComplete="name"
          returnKeyType="next"
        />

        {/* Reporter name (proxy only) */}
        {isProxy ? (
          <>
            <Text style={S.fieldLabel}>YOUR NAME (SUBMITTER)</Text>
            <TextInput
              style={S.input}
              value={reporterName}
              onChangeText={setReporterName}
              placeholder="e.g. David Lin (brother)"
              placeholderTextColor={C.textLo}
              autoComplete="off"
            />
          </>
        ) : null}

        {/* Medical notes */}
        {showNotes ? (
          <>
            <Text style={S.fieldLabel}>MEDICAL NOTES / SITUATION</Text>
            <TextInput
              style={[S.input, S.textarea]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Describe injuries or what help is needed"
              placeholderTextColor={C.textLo}
              textAlignVertical="top"
            />
          </>
        ) : null}

        <Text style={S.fieldLabel}>
          {isProxy ? 'THEIR HKID (IF KNOWN)' : 'YOUR HKID *'}
        </Text>
        <TextInput
          style={S.input}
          value={personalId}
          onChangeText={setPersonalId}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="A123456(7)"
          placeholderTextColor={C.textLo}
        />

        <Text style={S.fieldLabel}>
          {isProxy ? 'THEIR PHONE (IF KNOWN)' : 'YOUR PHONE *'}
        </Text>
        <TextInput
          style={S.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+852 ..."
          placeholderTextColor={C.textLo}
        />

        {/* Submit */}
        <TouchableOpacity
          style={[S.submitBtn, submitting && S.submitDisabled]}
          onPress={onSubmit}
          disabled={submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color={C.textInv} />
          ) : (
            <>
              <Ionicons name="send" size={17} color={C.textInv} />
              <Text style={S.submitText}>
                {isProxy ? 'Submit Report for Someone Else' : 'Submit My Report'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {message ? (
          <View style={[S.msgBox, {
            backgroundColor: msgColors(message.kind).bg,
            borderColor:     msgColors(message.kind).border,
          }]}>
            <Ionicons
              name={message.kind === 'error' ? 'alert-circle'
                  : message.kind === 'success' ? 'checkmark-circle'
                  : message.kind === 'warn' ? 'cloud-offline' : 'information-circle'}
              size={16}
              color={msgColors(message.kind).text}
            />
            <Text style={[S.msgText, { color: msgColors(message.kind).text }]}>
              {message.text}
            </Text>
          </View>
        ) : null}

        {/* Privacy tiers this report will be visible under */}
        <View style={S.privacyBox}>
          <View style={S.privacyHead}>
            <Ionicons name="lock-closed" size={14} color={C.textMd} />
            <Text style={S.privacyHeadText}>Who can see this report</Text>
          </View>
          <View style={S.privacyChips}>
            <VisibilityChip tier="coarse" />
            <VisibilityChip tier="rescue" />
          </View>
          <Text style={S.privacyText}>
            Family &amp; public search shows approximate location only (±1 km). Exact GPS and medical
            notes are visible to authorized rescue teams only.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  bg:        { backgroundColor: C.bgCanvas },
  container: { paddingBottom: 40 },

  proxyToggle: {
    flexDirection: 'row', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.bgPanel, gap: 12,
  },
  proxyLabel: { fontSize: 15, fontWeight: '700', color: C.textHi },
  proxySub:   { fontSize: 12, color: C.textLo, marginTop: 2 },

  sectionHeader: {
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8,
    backgroundColor: C.bgCanvas,
  },
  sectionLabel: {
    fontSize: 12, fontWeight: '700',
    letterSpacing: 0.6, color: C.textLo, textTransform: 'uppercase',
  },

  statusRow: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 72, paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.bgPanel, borderLeftWidth: 3, borderLeftColor: 'transparent', gap: 14,
  },
  statusIconWrap: {
    width: 44, height: 44, borderRadius: R.sm,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  statusLabel: { fontSize: 17, fontWeight: '700', marginBottom: 2 },
  statusSub:   { fontSize: 13, color: C.textLo },

  formPad: { padding: 16, paddingTop: 20 },

  fieldLabel: {
    fontSize: 12, fontWeight: '700',
    letterSpacing: 0.4, color: C.textMd, marginBottom: 7, marginTop: 16,
  },
  input: {
    backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.borderStrong,
    borderRadius: R.sm, padding: 14, fontSize: 16, color: C.textHi,
  },
  textarea: { height: 96, textAlignVertical: 'top' },

  submitBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: C.amber, height: 54,
    alignItems: 'center', justifyContent: 'center', marginTop: 24, borderRadius: R.sm,
    ...SHADOW.card,
  },
  submitDisabled: { opacity: 0.45 },
  submitText: {
    color: C.textInv, fontSize: 15, fontWeight: '700', textAlign: 'center',
  },

  msgBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 16, padding: 12, borderWidth: 1, borderRadius: R.sm,
  },
  msgText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },

  privacyBox: {
    marginTop: 20, padding: 14, borderRadius: R.sm,
    backgroundColor: C.bgRaised, borderWidth: 1, borderColor: C.border,
  },
  privacyHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  privacyHeadText: { fontSize: 13, fontWeight: '700', color: C.textMd },
  privacyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  privacyText: { fontSize: 12, color: C.textLo, lineHeight: 17 },

  /* Success state */
  successCircle: {
    width: 104, height: 104, borderRadius: 52, backgroundColor: C.safeDim,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  successTitle: { fontSize: 22, fontWeight: '800', color: C.textHi, marginBottom: 6 },
  successSub:   { fontSize: 14, color: C.textLo, textAlign: 'center', lineHeight: 20, marginBottom: 16, paddingHorizontal: 12 },
  refPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill,
    backgroundColor: C.bgRaised, borderWidth: 1, borderColor: C.border,
  },
  refText: { fontSize: 12, color: C.textMd, fontWeight: '600' },
});
