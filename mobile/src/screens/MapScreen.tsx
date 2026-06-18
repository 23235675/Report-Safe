import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Linking, RefreshControl, ScrollView, Modal, Switch,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { C, R, SHADOW } from '../theme';
import {
  API_BASE_URL, getDisasters, currentUserId, canManageFacilities,
  createSafePlace, listPendingSafePlaces, moderateSafePlace,
} from '../api/apiClient';
import type { Disaster, SafePlace } from '../api/apiClient';

interface Shelter {
  id: string;
  name: string;
  type: string;
  source?: string;
  lat: number;
  lng: number;
  capacity?: number | null;
  current_count?: number;
  address?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  hours_open?: string | null;
  distance_km?: number;
}

const TYPE_COLORS: Record<string, { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  hospital: { bg: C.criticalDim, fg: C.critical, icon: 'medkit' },
  clinic:   { bg: C.injuredDim,  fg: C.injured,  icon: 'fitness' },
  shelter:  { bg: C.govBlueDim,  fg: C.govBlue,  icon: 'home' },
  assembly: { bg: C.safeDim,     fg: C.safe,     icon: 'flag' },
};

function capPct(s: Shelter): number | null {
  if (!s.capacity || s.capacity <= 0) return null;
  return Math.round(((s.current_count ?? 0) / s.capacity) * 100);
}

export default function MapScreen(): React.JSX.Element {
  const [shelters,   setShelters]   = useState<Shelter[]>([]);
  const [disasters,  setDisasters]  = useState<Disaster[]>([]);
  const [filterDis,  setFilterDis]  = useState<string>('');
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');

  // Safe-place: suggest (any logged-in user) + moderate (gov/volunteer).
  const isLoggedIn  = !!currentUserId();
  const canManage   = canManageFacilities();
  const [pending,   setPending]   = useState<SafePlace[]>([]);
  const [showForm,  setShowForm]  = useState(false);
  const [spForm,    setSpForm]    = useState({ name: '', lat: '', lng: '', description: '', capacity: '' });
  const [spErr,     setSpErr]     = useState('');
  const [spBusy,    setSpBusy]    = useState(false);
  const [spOk,      setSpOk]      = useState('');

  async function loadPending() {
    if (!canManage) { setPending([]); return; }
    try { setPending(await listPendingSafePlaces()); } catch { setPending([]); }
  }

  async function useMyLocation() {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setSpErr('Location permission denied — enter coordinates manually.'); return; }
      const pos = await Location.getCurrentPositionAsync({});
      setSpForm((f) => ({ ...f, lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5) }));
    } catch { setSpErr('Could not get your location — enter coordinates manually.'); }
  }

  async function submitSafePlace() {
    setSpErr('');
    if (!spForm.name.trim()) { setSpErr('Please name the safe place.'); return; }
    if (spForm.lat === '' || spForm.lng === '') { setSpErr('Location is required — tap “Use my location” or enter coordinates.'); return; }
    setSpBusy(true);
    try {
      await createSafePlace({
        name: spForm.name.trim(),
        lat: Number(spForm.lat),
        lng: Number(spForm.lng),
        description: spForm.description.trim() || null,
        capacity: spForm.capacity ? Number(spForm.capacity) : null,
        disaster_id: filterDis || null,
      });
      setShowForm(false);
      setSpForm({ name: '', lat: '', lng: '', description: '', capacity: '' });
      setSpOk('Thank you — submitted for review by an official. It will appear once approved.');
      setTimeout(() => setSpOk(''), 4000);
    } catch (e: any) {
      setSpErr(e?.status === 401 ? 'Please sign in (Account tab) first.' : (e.message || 'Could not submit.'));
    } finally {
      setSpBusy(false);
    }
  }

  async function reviewPlace(id: string, status: 'approved' | 'rejected') {
    try { await moderateSafePlace(id, status); await loadPending(); }
    catch (e: any) { setError(e.message); }
  }

  async function loadShelters(disasterId?: string) {
    try {
      const params = new URLSearchParams();
      if (disasterId) params.set('disaster_id', disasterId);
      const url = `${API_BASE_URL}/api/shelters${params.toString() ? `?${params}` : ''}`;
      const res  = await fetch(url);
      const body = await res.json();
      setShelters(body.shelters || []);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function loadAll() {
    setError('');
    const [d] = await Promise.all([getDisasters()]);
    setDisasters(d);
    await loadShelters(filterDis || undefined);
    loadPending();
  }

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [filterDis]);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [filterDis]);

  function openDirections(s: Shelter) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
    Linking.openURL(url).catch(() => {});
  }

  function callPhone(phone: string) {
    Linking.openURL(`tel:${phone}`).catch(() => {});
  }

  return (
    <ScrollView
      style={S.bg}
      contentContainerStyle={S.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.govBlue} />}
    >
      <View style={S.header}>
        <View style={S.headerIcon}>
          <Ionicons name="navigate" size={20} color={C.govBlue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={S.headerTitle}>Shelters &amp; Safe Places</Text>
          <Text style={S.headerSub}>Pull to refresh. Tap a card for directions.</Text>
        </View>
      </View>

      {/* Filter by disaster */}
      {disasters.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.filterRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          <TouchableOpacity
            onPress={() => setFilterDis('')}
            style={[S.filterChip, !filterDis && S.filterActive]}
          >
            <Text style={[S.filterChipText, !filterDis && { color: C.govBlue }]}>All</Text>
          </TouchableOpacity>
          {disasters.map((d) => (
            <TouchableOpacity
              key={d.id}
              onPress={() => setFilterDis(d.id)}
              style={[S.filterChip, filterDis === d.id && S.filterActive]}
            >
              <Text style={[S.filterChipText, filterDis === d.id && { color: C.govBlue }]}>
                {d.type.charAt(0).toUpperCase() + d.type.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {/* Suggest a safe place (any logged-in user) */}
      <View style={S.suggestRow}>
        <TouchableOpacity style={S.suggestBtn} onPress={() => { setSpErr(''); setShowForm(true); }} activeOpacity={0.85}>
          <Ionicons name="add-circle-outline" size={16} color={C.govBlue} />
          <Text style={S.suggestBtnText}>Suggest a Safe Place</Text>
        </TouchableOpacity>
      </View>

      {spOk ? (
        <View style={S.okBox}>
          <Ionicons name="checkmark-circle" size={16} color={C.safe} />
          <Text style={S.okText}>{spOk}</Text>
        </View>
      ) : null}

      {/* Pending moderation queue (gov/volunteer only) */}
      {canManage && pending.length > 0 ? (
        <View style={S.pendingPanel}>
          <View style={S.pendingHead}>
            <Ionicons name="alert-circle" size={15} color={C.amber} />
            <Text style={S.pendingHeadText}>Suggestions awaiting review ({pending.length})</Text>
          </View>
          {pending.map((p) => (
            <View key={p.id} style={S.pendingRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={S.pendingName} numberOfLines={1}>{p.name}</Text>
                <Text style={S.pendingMeta} numberOfLines={1}>
                  {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                  {p.capacity ? ` · cap ${p.capacity}` : ''}
                  {p.submitter_name ? ` · by ${p.submitter_name}` : ''}
                </Text>
                {p.description ? <Text style={S.pendingDesc} numberOfLines={2}>{p.description}</Text> : null}
              </View>
              <View style={S.pendingActions}>
                <TouchableOpacity style={S.approveBtn} onPress={() => reviewPlace(p.id, 'approved')}>
                  <Ionicons name="checkmark" size={15} color={C.textInv} />
                </TouchableOpacity>
                <TouchableOpacity style={S.declineBtn} onPress={() => reviewPlace(p.id, 'rejected')}>
                  <Ionicons name="close" size={15} color={C.critical} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <View style={S.errorBox}>
          <Text style={S.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator size="large" color={C.govBlue} style={{ marginTop: 40 }} />
      ) : shelters.length === 0 ? (
        <View style={S.empty}>
          <Ionicons name="map-outline" size={48} color={C.borderStrong} />
          <Text style={S.emptyText}>No shelters found</Text>
          <Text style={S.emptyHint}>Try removing the disaster filter or pull to refresh.</Text>
        </View>
      ) : (
        <View style={S.list}>
          {shelters.map((s) => {
            const tc  = TYPE_COLORS[s.type] ?? { bg: C.bgRaised, fg: C.textMd, icon: 'business' as const };
            const pct = capPct(s);
            return (
              <TouchableOpacity
                key={s.id}
                style={S.shelterCard}
                onPress={() => openDirections(s)}
                activeOpacity={0.85}
              >
                <View style={S.scHead}>
                  <View style={[S.typeIcon, { backgroundColor: tc.bg }]}>
                    <Ionicons name={tc.icon} size={20} color={tc.fg} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={S.scName} numberOfLines={1}>{s.name}</Text>
                    <Text style={[S.typeBadgeText, { color: tc.fg }]}>{s.type}</Text>
                  </View>
                  {s.distance_km != null ? (
                    <View style={S.distancePill}>
                      <Ionicons name="walk" size={13} color={C.textLo} />
                      <Text style={S.distance}>{s.distance_km.toFixed(1)} km</Text>
                    </View>
                  ) : null}
                </View>
                {s.address ? (
                  <View style={S.scAddrRow}>
                    <Ionicons name="location-outline" size={14} color={C.textLo} />
                    <Text style={S.scAddr} numberOfLines={1}>{s.address}</Text>
                  </View>
                ) : null}

                {pct != null ? (
                  <View style={S.capRow}>
                    <View style={S.capBarWrap}>
                      <View style={[S.capBar, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: pct >= 90 ? C.critical : pct >= 70 ? C.injured : C.safe }]} />
                    </View>
                    <Text style={S.capText}>{s.current_count}/{s.capacity} ({pct}%)</Text>
                  </View>
                ) : null}

                {s.hours_open ? (
                  <View style={S.scAddrRow}>
                    <Ionicons name="time-outline" size={14} color={C.textLo} />
                    <Text style={S.scMeta}>{s.hours_open}</Text>
                  </View>
                ) : null}

                <View style={S.scActions}>
                  <TouchableOpacity style={S.scBtn} onPress={() => openDirections(s)} activeOpacity={0.85}>
                    <Ionicons name="navigate" size={16} color={C.textInv} />
                    <Text style={S.scBtnText}>Directions</Text>
                  </TouchableOpacity>
                  {s.phone ? (
                    <TouchableOpacity style={[S.scBtn, S.scBtnAlt]} onPress={() => callPhone(s.phone!)} activeOpacity={0.85}>
                      <Ionicons name="call" size={16} color={C.govBlue} />
                      <Text style={[S.scBtnText, { color: C.govBlue }]}>Call</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── Suggest a Safe Place modal ──────────────────────────── */}
      <Modal visible={showForm} transparent animationType="fade" onRequestClose={() => setShowForm(false)}>
        <View style={S.modalOverlay}>
          <View style={S.modalCard}>
            <View style={S.modalHead}>
              <Text style={S.modalTitle}>Suggest a Safe Place</Text>
              <TouchableOpacity onPress={() => setShowForm(false)} hitSlop={10}>
                <Ionicons name="close" size={20} color={C.textLo} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={S.modalSub}>
                Share a refuge location you know about (a community hall, covered car park, higher ground). It’s reviewed by an official before going public.
              </Text>
              {!isLoggedIn ? (
                <View style={S.warnBox}>
                  <Ionicons name="alert-circle" size={15} color={C.amber} />
                  <Text style={S.warnText}>Sign in on the Account tab first — submissions are tied to your account.</Text>
                </View>
              ) : null}
              {spErr ? (
                <View style={S.errInline}>
                  <Ionicons name="alert-circle" size={15} color={C.critical} />
                  <Text style={S.errInlineText}>{spErr}</Text>
                </View>
              ) : null}
              <View style={S.field}>
                <Text style={S.fieldLbl}>Name *</Text>
                <TextInput style={S.input} value={spForm.name} onChangeText={(v) => setSpForm((f) => ({ ...f, name: v }))} placeholder="e.g. Kowloon Park covered area" placeholderTextColor={C.textLo} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={[S.field, { flex: 1 }]}>
                  <Text style={S.fieldLbl}>Latitude *</Text>
                  <TextInput style={S.input} value={spForm.lat} onChangeText={(v) => setSpForm((f) => ({ ...f, lat: v }))} placeholder="22.30" placeholderTextColor={C.textLo} keyboardType="numbers-and-punctuation" />
                </View>
                <View style={[S.field, { flex: 1 }]}>
                  <Text style={S.fieldLbl}>Longitude *</Text>
                  <TextInput style={S.input} value={spForm.lng} onChangeText={(v) => setSpForm((f) => ({ ...f, lng: v }))} placeholder="114.17" placeholderTextColor={C.textLo} keyboardType="numbers-and-punctuation" />
                </View>
              </View>
              <TouchableOpacity style={S.locBtn} onPress={useMyLocation} activeOpacity={0.85}>
                <Ionicons name="locate" size={15} color={C.govBlue} />
                <Text style={S.locBtnText}>Use my location</Text>
              </TouchableOpacity>
              <View style={S.field}>
                <Text style={S.fieldLbl}>Approx. capacity (optional)</Text>
                <TextInput style={S.input} value={spForm.capacity} onChangeText={(v) => setSpForm((f) => ({ ...f, capacity: v }))} placeholder="e.g. 50" placeholderTextColor={C.textLo} keyboardType="number-pad" />
              </View>
              <View style={S.field}>
                <Text style={S.fieldLbl}>Description (optional)</Text>
                <TextInput style={[S.input, { height: 64, textAlignVertical: 'top' }]} value={spForm.description} onChangeText={(v) => setSpForm((f) => ({ ...f, description: v }))} placeholder="Entrance, shelter type, hazards…" placeholderTextColor={C.textLo} multiline />
              </View>
              <TouchableOpacity
                style={[S.submitBtn, (spBusy || !isLoggedIn) && { opacity: 0.5 }]}
                onPress={submitSafePlace}
                disabled={spBusy || !isLoggedIn}
                activeOpacity={0.85}
              >
                {spBusy ? <ActivityIndicator color={C.textInv} size="small" /> : <Ionicons name="checkmark" size={16} color={C.textInv} />}
                <Text style={S.submitBtnText}>{spBusy ? 'Submitting…' : 'Submit'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  bg:        { flex: 1, backgroundColor: C.bgCanvas },
  container: { paddingBottom: 32 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bgPanel,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: R.sm, backgroundColor: C.govBlueDim,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.textHi },
  headerSub:   { fontSize: 12, color: C.textLo, marginTop: 3 },

  filterRow: { marginTop: 12, marginBottom: 4 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, backgroundColor: C.bgPanel, borderWidth: 1, borderColor: C.border },
  filterActive: { borderColor: C.govBlue, backgroundColor: C.govBlueDim },
  filterChipText: { fontSize: 13, fontWeight: '600', color: C.textMd },

  errorBox: { margin: 16, padding: 12, backgroundColor: C.criticalDim, borderRadius: R.sm, borderWidth: 1, borderColor: C.criticalBorder },
  errorText: { fontSize: 13, color: C.critical, fontWeight: '600' },

  empty: { padding: 40, alignItems: 'center', gap: 6 },
  emptyText: { fontSize: 16, fontWeight: '700', color: C.textHi, marginTop: 8 },
  emptyHint: { fontSize: 13, color: C.textLo, textAlign: 'center' },

  list: { padding: 16, gap: 12 },
  shelterCard: { backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: 14, ...SHADOW.card },
  scHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  typeIcon: { width: 40, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  typeBadgeText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize', marginTop: 1 },
  distancePill: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  distance: { fontSize: 12, color: C.textLo, fontWeight: '600' },

  scName: { fontSize: 15, fontWeight: '700', color: C.textHi },
  scAddrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  scAddr: { flex: 1, fontSize: 12, color: C.textLo },
  scMeta: { fontSize: 12, color: C.textLo },

  capRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, marginTop: 2 },
  capBarWrap: { flex: 1, height: 6, backgroundColor: C.bgHover, borderRadius: R.pill, overflow: 'hidden' },
  capBar:     { height: '100%', borderRadius: R.pill },
  capText:    { fontSize: 11, color: C.textLo, fontWeight: '600', width: 92, textAlign: 'right' },

  scActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  scBtn:     { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: R.sm, backgroundColor: C.govBlue, alignItems: 'center', justifyContent: 'center' },
  scBtnAlt:  { backgroundColor: C.govBlueDim, borderWidth: 1, borderColor: C.govBlue },
  scBtnText: { fontSize: 14, fontWeight: '700', color: C.textInv },

  /* Suggest a safe place */
  suggestRow: { paddingHorizontal: 16, marginTop: 12 },
  suggestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: R.sm, borderWidth: 1, borderColor: C.govBlue, backgroundColor: C.govBlueDim },
  suggestBtnText: { fontSize: 14, fontWeight: '700', color: C.govBlue },
  okBox: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, marginTop: 12, padding: 12, backgroundColor: C.safeDim, borderRadius: R.sm, borderWidth: 1, borderColor: C.safeBorder },
  okText: { flex: 1, fontSize: 13, color: C.safe, fontWeight: '600', lineHeight: 18 },

  /* Pending moderation queue */
  pendingPanel: { margin: 16, marginTop: 12, padding: 12, backgroundColor: C.awaitingDim, borderRadius: R.md, borderWidth: 1, borderColor: C.awaitingBorder },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  pendingHeadText: { fontSize: 13, fontWeight: '700', color: C.amber },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.awaitingBorder },
  pendingName: { fontSize: 14, fontWeight: '600', color: C.textHi },
  pendingMeta: { fontSize: 12, color: C.textLo, marginTop: 2 },
  pendingDesc: { fontSize: 12, color: C.textMd, marginTop: 2 },
  pendingActions: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  approveBtn: { width: 34, height: 34, borderRadius: R.sm, backgroundColor: C.safe, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { width: 34, height: 34, borderRadius: R.sm, backgroundColor: C.criticalDim, borderWidth: 1, borderColor: C.criticalBorder, alignItems: 'center', justifyContent: 'center' },

  /* Modal */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: C.bgPanel, borderRadius: R.md, maxHeight: '85%', overflow: 'hidden' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: C.textHi },
  modalSub: { fontSize: 13, color: C.textLo, lineHeight: 18 },
  warnBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: C.awaitingDim, borderRadius: R.sm, borderWidth: 1, borderColor: C.awaitingBorder },
  warnText: { flex: 1, fontSize: 12, color: C.amber, fontWeight: '600' },
  errInline: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: C.criticalDim, borderRadius: R.sm, borderWidth: 1, borderColor: C.criticalBorder },
  errInlineText: { flex: 1, fontSize: 12, color: C.critical, fontWeight: '600' },
  field: { gap: 4 },
  fieldLbl: { fontSize: 12, fontWeight: '600', color: C.textMd },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 6, padding: 10, fontSize: 14, color: C.textHi, backgroundColor: C.bgCanvas },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.pill, backgroundColor: C.govBlueDim, borderWidth: 1, borderColor: C.govBlue },
  locBtnText: { fontSize: 13, fontWeight: '600', color: C.govBlue },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: R.sm, backgroundColor: C.govBlue, marginTop: 4 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: C.textInv },
});
