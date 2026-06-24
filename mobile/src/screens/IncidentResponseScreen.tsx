import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDisasterMode } from '../context/DisasterModeContext';
import { useTranslation } from '../i18n';
import { C, R, SHADOW } from '../theme';
import type { Aed, IncidentResponder } from '../api/apiClient';

/** Ionicons glyph per incident type. */
const INCIDENT_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  cardiac_arrest: 'heart',
  fire: 'flame',
  trauma: 'medkit',
  other: 'alert-circle',
};

const STATUS_COLOR: Record<string, string> = {
  enroute: C.govBlue,
  onscene: C.safe,
  notified: C.textLo,
  declined: C.textLo,
  stood_down: C.textLo,
};

function openDirections(lat: number, lng: number) {
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {});
}

/**
 * Full-screen, DISMISSABLE responder workbench shown to an opted-in volunteer
 * when a nearby emergency is dispatched. Unlike DisasterModeScreen (which gates
 * the victim's whole app), this is opt-in and the responder may Close/Decline at
 * any time. Patient location + AEDs + co-responders are rendered as cards with
 * Google Maps "Directions" links — matching the app's existing geo pattern.
 */
export default function IncidentResponseScreen(): React.JSX.Element | null {
  const { activeIncident, respondToActiveIncident, dismissIncident, location } = useDisasterMode();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);

  if (!activeIncident) return null;
  const { incident, aeds, responders } = activeIncident;
  const typeLabel = t(`incidentType.${incident.type}`);
  const hint = incident.type === 'fire' ? t('incident.fireHint') : t('incident.cprHint');

  async function respond(status: 'enroute' | 'onscene' | 'declined') {
    setBusy(status);
    try { await respondToActiveIncident(status); } finally { setBusy(null); }
  }

  function call999() {
    Linking.openURL('tel:999').catch(() => {});
  }

  return (
    <SafeAreaView style={S.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={S.container}>
        {/* Badge */}
        <View style={S.badge}>
          <Ionicons name="pulse" size={15} color={C.textInv} />
          <Text style={S.badgeText}>{t('incident.badge')}</Text>
        </View>

        {/* Hero */}
        <View style={S.hero}>
          <View style={S.heroIcon}>
            <Ionicons name={INCIDENT_ICON[incident.type] ?? 'alert-circle'} size={32} color={C.critical} />
          </View>
          <Text style={S.heroTitle}>{t('incident.nearbyTitle', { type: typeLabel })}</Text>
          <Text style={S.heroHelp}>{t('incident.help')}</Text>
        </View>

        {/* Patient location */}
        <Text style={S.sectionLabel}>{t('incident.patientLocation')}</Text>
        <View style={S.card}>
          <View style={S.cardRow}>
            <Ionicons name="location" size={18} color={C.critical} />
            <Text style={S.cardTitle} numberOfLines={2}>
              {incident.address || `${incident.lat.toFixed(5)}, ${incident.lng.toFixed(5)}`}
            </Text>
          </View>
          <TouchableOpacity style={S.dirBtn} onPress={() => openDirections(incident.lat, incident.lng)} activeOpacity={0.85}>
            <Ionicons name="navigate" size={15} color={C.textInv} />
            <Text style={S.dirBtnText}>{t('incident.directions')}</Text>
          </TouchableOpacity>
        </View>

        {/* Guidance */}
        <View style={S.hintBox}>
          <Ionicons name="information-circle" size={16} color={C.govBlue} />
          <Text style={S.hintText}>{hint}</Text>
        </View>

        {/* Nearest AED */}
        <Text style={S.sectionLabel}>{t('incident.nearestAed')}</Text>
        {aeds.length === 0 ? (
          <Text style={S.empty}>{t('incident.noAed')}</Text>
        ) : (
          aeds.map((a: Aed) => (
            <View key={a.id} style={S.card}>
              <View style={S.cardRow}>
                <Ionicons name="heart-circle" size={18} color={C.safe} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={S.cardTitle} numberOfLines={1}>{a.name}</Text>
                  <Text style={S.cardMeta} numberOfLines={1}>
                    {a.distance_km.toFixed(2)} km{a.floor ? ` · ${a.floor}` : ''}{a.available_hours ? ` · ${a.available_hours}` : ''}
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={[S.dirBtn, S.dirBtnAlt]} onPress={() => openDirections(a.lat, a.lng)} activeOpacity={0.85}>
                <Ionicons name="navigate" size={15} color={C.govBlue} />
                <Text style={[S.dirBtnText, { color: C.govBlue }]}>{t('incident.directions')}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        {/* Co-responders */}
        <Text style={S.sectionLabel}>{t('incident.coResponders')}</Text>
        {responders.length === 0 ? (
          <Text style={S.empty}>{t('incident.noResponders')}</Text>
        ) : (
          responders.map((r: IncidentResponder) => (
            <View key={r.user_id} style={S.responderRow}>
              <Ionicons name="person-circle" size={22} color={STATUS_COLOR[r.status] ?? C.textLo} />
              <Text style={S.responderName} numberOfLines={1}>{r.name}</Text>
              <Text style={[S.responderStatus, { color: STATUS_COLOR[r.status] ?? C.textLo }]}>
                {t(`incident.status${r.status === 'enroute' ? 'Enroute' : r.status === 'onscene' ? 'Onscene' : 'Decline'}`)}
              </Text>
            </View>
          ))
        )}

        {/* Respond actions */}
        <Text style={[S.sectionLabel, { marginTop: 18 }]}>{t('incident.iAmResponding')}</Text>
        <TouchableOpacity style={[S.action, { backgroundColor: C.govBlueDim, borderColor: C.govBlue }]} onPress={() => respond('enroute')} disabled={busy !== null} activeOpacity={0.85}>
          {busy === 'enroute' ? <ActivityIndicator color={C.govBlue} /> : <Ionicons name="walk" size={22} color={C.govBlue} />}
          <Text style={[S.actionText, { color: C.govBlue }]}>{t('incident.statusEnroute')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[S.action, { backgroundColor: C.safeDim, borderColor: C.safe }]} onPress={() => respond('onscene')} disabled={busy !== null} activeOpacity={0.85}>
          {busy === 'onscene' ? <ActivityIndicator color={C.safe} /> : <Ionicons name="flag" size={22} color={C.safe} />}
          <Text style={[S.actionText, { color: C.safe }]}>{t('incident.statusOnscene')}</Text>
        </TouchableOpacity>

        {/* Call 999 */}
        <TouchableOpacity style={S.call} onPress={call999} activeOpacity={0.85}>
          <Ionicons name="call" size={20} color={C.textInv} />
          <View style={{ flex: 1 }}>
            <Text style={S.callText}>{t('incident.call999')}</Text>
            <Text style={S.callSub}>{t('incident.call999sub')}</Text>
          </View>
        </TouchableOpacity>
        <Text style={S.coords}>
          {t('incident.coords', { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) })}
        </Text>

        {/* Decline / Close */}
        <TouchableOpacity style={S.declineBtn} onPress={() => respond('declined')} disabled={busy !== null} activeOpacity={0.85}>
          <Text style={S.declineText}>{t('incident.statusDecline')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={S.closeBtn} onPress={dismissIncident} activeOpacity={0.7}>
          <Text style={S.closeText}>{t('incident.close')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bgCanvas },
  container: { padding: 20, paddingBottom: 36 },

  badge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6,
    backgroundColor: C.safe, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: R.pill, marginBottom: 18,
  },
  badgeText: { color: C.textInv, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },

  hero: {
    alignItems: 'center', padding: 20, borderRadius: R.md,
    backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.criticalBorder,
    marginBottom: 20, ...SHADOW.card,
  },
  heroIcon: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: C.criticalDim,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    borderWidth: 2, borderColor: C.criticalBorder,
  },
  heroTitle: { fontSize: 21, fontWeight: '800', color: C.textHi, textAlign: 'center' },
  heroHelp:  { fontSize: 14, color: C.textMd, textAlign: 'center', lineHeight: 20, marginTop: 8 },

  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: C.textMd, marginBottom: 8, marginTop: 8 },

  card: { backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10, ...SHADOW.card },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: C.textHi },
  cardMeta: { fontSize: 12, color: C.textLo, marginTop: 2 },
  dirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: R.sm, backgroundColor: C.govBlue, marginTop: 10 },
  dirBtnAlt: { backgroundColor: C.govBlueDim, borderWidth: 1, borderColor: C.govBlue },
  dirBtnText: { fontSize: 13, fontWeight: '700', color: C.textInv },

  hintBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: R.sm, backgroundColor: C.govBlueDim, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  hintText: { flex: 1, fontSize: 13, color: C.textMd, lineHeight: 19 },

  empty: { fontSize: 13, color: C.textLo, marginBottom: 8 },

  responderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  responderName: { flex: 1, fontSize: 14, fontWeight: '600', color: C.textHi },
  responderStatus: { fontSize: 12, fontWeight: '700' },

  action: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: R.md, borderWidth: 1.5, marginBottom: 10, ...SHADOW.card },
  actionText: { fontSize: 17, fontWeight: '800' },

  call: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: R.md, backgroundColor: C.critical, marginTop: 8, ...SHADOW.card },
  callText: { fontSize: 17, fontWeight: '800', color: C.textInv },
  callSub: { fontSize: 12, color: C.textInv, opacity: 0.9, marginTop: 1 },
  coords: { fontSize: 12, color: C.textLo, textAlign: 'center', marginTop: 8 },

  declineBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 14, borderRadius: R.sm, borderWidth: 1, borderColor: C.criticalBorder, backgroundColor: C.criticalDim },
  declineText: { fontSize: 14, fontWeight: '700', color: C.critical },
  closeBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  closeText: { fontSize: 14, fontWeight: '600', color: C.textLo },
});
