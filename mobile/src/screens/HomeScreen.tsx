import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, Modal, Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { C, R, SHADOW, DISASTER_ICON, statusColor } from '../theme';
import { useDisasterMode } from '../context/DisasterModeContext';
import { useTranslation } from '../i18n';
import { getNearbyIncidents, getPeople, getShelters } from '../api/apiClient';
import type { NearbyIncident, CivilianReport } from '../api/apiClient';
import MapWebView, { type MapMarker } from '../components/MapWebView';

// Severity is shown as a neutral grey badge (label carries the meaning) — aligned
// with the web's restrained, mostly-greyscale treatment. No status colour.
const SEV_NEUTRAL = { color: C.textMd, dim: C.bgRaised };

/** Statuses that constitute an active "need" worth surfacing nearby. */
const NEED_STATUSES = new Set(['need_help', 'injured', 'awaiting_response']);

/** Great-circle distance in km (small inline haversine). */
function distKm(a: { lat: number; lng: number }, lat: number, lng: number): number {
  const R_ = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - a.lat), dLng = toRad(lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_ * Math.asin(Math.sqrt(s));
}

export default function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const { t, severityLabel, disasterTypeLabel, statusLabel } = useTranslation();
  // Live data + the disaster-mode gate come from the app-wide provider, which
  // owns the single Socket.IO connection (so this device is tracked once).
  const { disasters, pending, loading, loaded, error, refresh, inDisasterZone, location, openIncident } = useDisasterMode();
  const [refreshing, setRefreshing] = useState(false);
  const [showIncidents, setShowIncidents] = useState(false);
  const [incidents, setIncidents] = useState<NearbyIncident[]>([]);
  const [needPeople, setNeedPeople] = useState<(CivilianReport & { _km: number })[]>([]);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [mapFull, setMapFull] = useState(false);

  const loadNearby = useCallback(async () => {
    const [inc, people, shelters] = await Promise.all([
      getNearbyIncidents(location.lat, location.lng),
      getPeople(),
      // Shelter pins are disaster-only.
      inDisasterZone ? getShelters() : Promise.resolve([]),
    ]);
    setIncidents(inc);
    const need = people
      .filter((p) => p.status && NEED_STATUSES.has(p.status) && p.coarse_lat != null && p.coarse_lng != null)
      .map((p) => ({ ...p, _km: distKm({ lat: p.coarse_lat!, lng: p.coarse_lng! }, location.lat, location.lng) }))
      .sort((a, b) => a._km - b._km)
      .slice(0, 6);
    setNeedPeople(need);

    // Map pins: active cases always; shelters only in a disaster zone.
    const pins: MapMarker[] = [];
    for (const i of inc) pins.push({ id: `i:${i.id}`, lat: i.lat, lng: i.lng, color: C.critical, title: t('home.cfrIncident') });
    for (const p of need) pins.push({ id: `p:${p.id}`, lat: p.coarse_lat!, lng: p.coarse_lng!, color: statusColor(p.status || 'need_help'), title: p.name, subtitle: statusLabel(p.status || 'need_help') });
    for (const s of shelters) pins.push({ id: `s:${s.id}`, lat: s.lat, lng: s.lng, color: C.govBlue, title: s.name });
    setMarkers(pins);
  }, [location.lat, location.lng, inDisasterZone, t, statusLabel]);

  useEffect(() => { if (loaded) loadNearby(); }, [loaded, loadNearby]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refresh(), loadNearby()]);
    setRefreshing(false);
  }, [refresh, loadNearby]);

  const isActive = disasters.length > 0;
  const hasNeed = incidents.length > 0 || needPeople.length > 0;

  return (
    <ScrollView
      style={S.bg}
      contentContainerStyle={S.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.govBlue} />}
    >
      {/* ── Loading / error on first load ─────────────────────── */}
      {loading && !loaded ? (
        <View style={S.loadingBox}>
          <ActivityIndicator size="large" color={C.govBlue} />
          <Text style={S.loadingText}>{t('home.loading')}</Text>
        </View>
      ) : error && !loaded ? (
        <View style={S.errorBanner}>
          <Ionicons name="cloud-offline" size={18} color={C.critical} />
          <Text style={S.errorBannerText}>{t('home.cantReach')}</Text>
          <TouchableOpacity onPress={onRefresh} style={S.errorRetryBtn} activeOpacity={0.85}>
            <Ionicons name="refresh" size={15} color={C.critical} />
            <Text style={S.errorRetryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loaded ? (
      <>
      {/* ── Status ribbon (with inline pending-sync pill) ──────── */}
      <View style={[S.ribbon, isActive ? S.ribbonActive : S.ribbonClear]}>
        <Ionicons
          name={isActive ? 'warning' : 'shield-checkmark'}
          size={18}
          color={isActive ? C.critical : C.textMd}
        />
        <Text style={[S.ribbonText, { flex: 1, color: isActive ? C.critical : C.textMd }]}>
          {isActive
            ? t(disasters.length === 1 ? 'home.activeOne' : 'home.activeMany', { n: disasters.length })
            : t('home.allClear')}
        </Text>
        {pending > 0 ? (
          <View style={S.pendingPill}>
            <Ionicons name="cloud-offline" size={13} color={C.awaiting} />
            <Text style={S.pendingPillText}>{t('home.pending', { n: pending })}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Live map: active cases (always) + shelters (disaster only) ── */}
      <View style={S.mapWrap}>
        <MapWebView center={location} markers={markers} height={240} />
        <TouchableOpacity style={S.mapExpand} onPress={() => setMapFull(true)} activeOpacity={0.85}>
          <Ionicons name="expand" size={18} color={C.textHi} />
        </TouchableOpacity>
      </View>

      {/* Full-screen map */}
      <Modal visible={mapFull} animationType="slide" onRequestClose={() => setMapFull(false)}>
        <View style={S.fullWrap}>
          <MapWebView center={location} markers={markers} height={Dimensions.get('window').height} />
          <TouchableOpacity style={S.mapClose} onPress={() => setMapFull(false)} activeOpacity={0.85}>
            <Ionicons name="close" size={22} color={C.textHi} />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Nearby Emergency Need ─────────────────────────────── */}
      <View style={S.section}>
        <Text style={S.sectionTitle}>{t('home.nearbyNeed')}</Text>
        <Text style={S.sectionSub}>{t('home.nearbyNeedSub')}</Text>

        {!hasNeed ? (
          <View style={S.calmBox}>
            <Ionicons name="checkmark-circle" size={18} color={C.textLo} />
            <Text style={S.calmText}>{t('home.nearbyNone')}</Text>
          </View>
        ) : (
          <>
            {/* CFR incidents (responders only) — highest urgency, tap to respond */}
            {incidents.map((i) => (
              <TouchableOpacity key={i.id} style={[S.needRow, { borderColor: C.criticalBorder }]} onPress={() => openIncident(i.id)} activeOpacity={0.85}>
                <View style={[S.needIcon, { backgroundColor: C.criticalDim }]}>
                  <Ionicons name="pulse" size={20} color={C.critical} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={S.needTitle} numberOfLines={1}>{t('home.cfrIncident')}</Text>
                  <Text style={S.needMeta}>{t('home.awayKm', { n: i.distance_km.toFixed(1) })}</Text>
                </View>
                <View style={S.respondBtn}>
                  <Text style={S.respondText}>{t('home.respond')}</Text>
                </View>
              </TouchableOpacity>
            ))}

            {/* Public Need-Help people (coarse location) */}
            {needPeople.map((p) => {
              const col = statusColor(p.status || 'need_help');
              return (
                <View key={p.id} style={[S.needRow, { borderColor: C.border }]}>
                  <View style={[S.needIcon, { backgroundColor: C.bgRaised }]}>
                    <Ionicons name="person" size={20} color={col} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={S.needTitle} numberOfLines={1}>{p.name}</Text>
                    <Text style={[S.needMeta, { color: col }]}>
                      {statusLabel(p.status || 'need_help')} · {t('home.awayKm', { n: p._km.toFixed(1) })}
                    </Text>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </View>

      {/* ── Shelter map button (disaster-only) ────────────────── */}
      {inDisasterZone ? (
        <TouchableOpacity style={S.mapBtn} onPress={() => navigation.navigate('Map')} activeOpacity={0.85}>
          <Ionicons name="map" size={18} color={C.govBlue} />
          <Text style={S.mapBtnText}>{t('home.viewMap')}</Text>
          <Ionicons name="chevron-forward" size={16} color={C.govBlue} style={{ marginLeft: 'auto' }} />
        </TouchableOpacity>
      ) : null}

      {/* ── Current incidents — hidden until the user opts to see them ── */}
      {disasters.length > 0 ? (
        <View style={S.section}>
          <TouchableOpacity style={S.toggleBtn} onPress={() => setShowIncidents((v) => !v)} activeOpacity={0.85}>
            <Ionicons name={showIncidents ? 'chevron-up' : 'list'} size={16} color={C.govBlue} />
            <Text style={S.toggleText}>
              {showIncidents ? t('home.hideIncidents') : t('home.showIncidents', { n: disasters.length })}
            </Text>
            <Ionicons name={showIncidents ? 'chevron-up' : 'chevron-down'} size={16} color={C.govBlue} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>

          {showIncidents ? disasters.map((d) => {
            const sev = SEV_NEUTRAL;
            return (
              <View key={d.id} style={S.disasterCard}>
                <View style={S.dcHead}>
                  <View style={[S.dcIcon, { backgroundColor: C.bgRaised }]}>
                    <Ionicons
                      name={(DISASTER_ICON[d.type?.toLowerCase()] ?? 'alert-circle') as any}
                      size={20}
                      color={C.textMd}
                    />
                  </View>
                  <View style={S.dcMeta}>
                    <Text style={S.dcName}>{disasterTypeLabel(d.type)}</Text>
                    {d.description ? <Text style={S.dcDesc} numberOfLines={1}>{d.description}</Text> : null}
                  </View>
                  <View style={[S.dcSev, { backgroundColor: sev.dim }]}>
                    <Text style={[S.dcSevText, { color: sev.color }]}>{severityLabel(d.severity)}</Text>
                  </View>
                </View>
                <View style={S.dcStat}>
                  <Ionicons name="resize" size={15} color={C.textLo} />
                  <Text style={S.dcStatVal}>{t('home.kmRadius', { n: d.radius_km })}</Text>
                </View>
                <View style={S.dcActions}>
                  <TouchableOpacity
                    style={[S.dcBtn, { backgroundColor: C.critical }]}
                    onPress={() => navigation.navigate('Report', { disasterId: d.id })}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="megaphone" size={15} color={C.textInv} />
                    <Text style={[S.dcBtnText, { color: C.textInv }]}>{t('home.reportStatus')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[S.dcBtn, { backgroundColor: C.govBlueDim, borderWidth: 1, borderColor: C.govBlue }]}
                    onPress={() => navigation.navigate('Family')}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="people" size={15} color={C.govBlue} />
                    <Text style={[S.dcBtnText, { color: C.govBlue }]}>{t('home.findSomeone')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }) : null}
        </View>
      ) : (
        <View style={S.noDisasters}>
          <View style={S.noDisCheck}>
            <Ionicons name="shield-checkmark" size={26} color={C.govBlue} />
          </View>
          <Text style={S.noDisTitle}>{t('home.noActive')}</Text>
          <Text style={S.noDisSub}>{t('home.noActiveSub')}</Text>
        </View>
      )}
      </>
      ) : null}

    </ScrollView>
  );
}

const S = StyleSheet.create({
  bg:        { flex: 1, backgroundColor: C.bgCanvas },
  container: { flexGrow: 1, paddingBottom: 32 },

  ribbon: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  ribbonActive: { backgroundColor: C.criticalDim, borderBottomWidth: 1, borderBottomColor: C.criticalBorder },
  ribbonClear:  { backgroundColor: C.bgRaised,    borderBottomWidth: 1, borderBottomColor: C.border },
  ribbonText: { fontSize: 14, fontWeight: '600' },

  pendingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: C.awaitingDim, borderWidth: 1, borderColor: C.awaitingBorder,
  },
  pendingPillText: { fontSize: 11, fontWeight: '700', color: C.awaiting },

  loadingBox: { paddingVertical: 56, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: C.textLo, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, padding: 14, borderRadius: R.md,
    backgroundColor: C.criticalDim, borderWidth: 1, borderColor: C.criticalBorder,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: C.critical, fontWeight: '600', lineHeight: 18 },
  errorRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.sm,
    backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.criticalBorder,
  },
  errorRetryText: { fontSize: 13, fontWeight: '700', color: C.critical },

  mapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: R.md,
    backgroundColor: C.govBlueDim, borderWidth: 1, borderColor: C.govBlue,
  },
  mapBtnText: { fontSize: 14, fontWeight: '700', color: C.govBlue },

  mapWrap: { paddingHorizontal: 16, paddingTop: 16 },
  mapExpand: {
    position: 'absolute', top: 26, right: 26, width: 36, height: 36, borderRadius: R.sm,
    backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.borderStrong,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.card,
  },
  fullWrap: { flex: 1, backgroundColor: C.bgCanvas },
  mapClose: {
    position: 'absolute', top: 48, right: 16, width: 44, height: 44, borderRadius: R.sm,
    backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.borderStrong,
    alignItems: 'center', justifyContent: 'center', ...SHADOW.raised,
  },

  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.textHi, letterSpacing: 0.1 },
  sectionSub: { fontSize: 12, color: C.textLo, marginTop: 2, marginBottom: 12 },

  calmBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    borderRadius: R.md, backgroundColor: C.bgRaised, borderWidth: 1, borderColor: C.border,
  },
  calmText: { flex: 1, fontSize: 13, color: C.textMd, fontWeight: '600' },

  needRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10,
    backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, ...SHADOW.card,
  },
  needIcon: { width: 40, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  needTitle: { fontSize: 15, fontWeight: '700', color: C.textHi },
  needMeta: { fontSize: 12, color: C.textLo, marginTop: 2, fontWeight: '600' },
  respondBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.sm, backgroundColor: C.critical, flexShrink: 0 },
  respondText: { fontSize: 13, fontWeight: '800', color: C.textInv },

  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 13,
    borderRadius: R.md, backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.border,
  },
  toggleText: { fontSize: 14, fontWeight: '700', color: C.govBlue },

  disasterCard: {
    backgroundColor: C.bgPanel, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border,
    marginTop: 12, overflow: 'hidden',
    ...SHADOW.card,
  },
  dcHead: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  dcIcon: { width: 40, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dcMeta: { flex: 1 },
  dcName: { fontSize: 16, fontWeight: '700', color: C.textHi },
  dcDesc: { fontSize: 12, color: C.textLo, marginTop: 2 },
  dcSev:  { paddingHorizontal: 9, paddingVertical: 4, borderRadius: R.pill },
  dcSevText: { fontSize: 11, fontWeight: '700' },
  dcStat: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  dcStatVal:  { fontSize: 15, fontWeight: '700', color: C.textHi },
  dcActions: {
    flexDirection: 'row', gap: 8, padding: 12,
    backgroundColor: C.bgRaised, borderTopWidth: 1, borderTopColor: C.border,
  },
  dcBtn: {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10,
    borderRadius: R.sm, alignItems: 'center', justifyContent: 'center',
  },
  dcBtnText: { fontSize: 13, fontWeight: '700' },

  noDisasters: {
    margin: 16, padding: 28, alignItems: 'center',
    backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, borderColor: C.border,
    ...SHADOW.card,
  },
  noDisCheck: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.govBlueDim, borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  noDisTitle: { fontSize: 16, fontWeight: '700', color: C.textHi, marginBottom: 4 },
  noDisSub:   { fontSize: 13, color: C.textLo, textAlign: 'center', lineHeight: 18 },
});
