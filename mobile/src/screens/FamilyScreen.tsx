import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  searchByName, listLovedOnes, addLovedOne, confirmLovedOne, removeLovedOne, currentUserId,
} from '../api/apiClient';
import type { CivilianReport, ReportStatus, LovedOne } from '../api/apiClient';
import { C, R, SHADOW, statusColor, statusDim, STATUS_ICON } from '../theme';
import VisibilityChip from '../components/VisibilityChip';
import { useTranslation, type I18n } from '../i18n';

const ALERT_STATUSES = new Set<ReportStatus>([
  'need_help', 'awaiting_response', 'potentially_missing', 'missing',
]);

function relativeTime(ts: number, t: I18n['t']): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1)  return t('time.justNow');
  if (mins < 60) return t('time.minutesAgo', { m: mins });
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? t('time.hoursAgo', { h: hrs }) : t('time.daysAgo', { d: Math.round(hrs / 24) });
}

export default function FamilyScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const { t, statusLabel } = useTranslation();

  // Account-link ("loved ones") state.
  const [hasAccount,  setHasAccount]  = useState<boolean>(!!currentUserId());
  const [links,       setLinks]       = useState<LovedOne[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError,  setLinksError]  = useState<string | null>(null);
  const [addPhone,    setAddPhone]    = useState('');
  const [adding,      setAdding]      = useState(false);
  const [notice,      setNotice]      = useState<string | null>(null);

  // Name-search state.
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<CivilianReport[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const loadLinks = useCallback(async () => {
    const uid = currentUserId();
    setHasAccount(!!uid);
    if (!uid) { setLinks([]); return; }
    setLinksLoading(true);
    setLinksError(null);
    try {
      setLinks(await listLovedOnes());
    } catch {
      setLinksError(t('family.errLoad'));
    } finally {
      setLinksLoading(false);
    }
  }, [t]);

  // Refresh links whenever the tab regains focus (new confirmations, status changes).
  useFocusEffect(useCallback(() => { loadLinks(); }, [loadLinks]));

  const confirmed = links.filter((l) => l.link_status === 'confirmed');
  const incoming  = links.filter((l) => l.link_status === 'pending' && l.is_incoming);
  const outgoing  = links.filter((l) => l.link_status === 'pending' && !l.is_incoming);

  async function onAdd(): Promise<void> {
    const phone = addPhone.trim();
    if (!phone) return;
    setAdding(true);
    setNotice(null);
    try {
      await addLovedOne(phone);
      setAddPhone('');
      setNotice(t('family.requestSent'));
      await loadLinks();
    } catch (e: any) {
      setNotice(
        e?.status === 404 ? t('family.addNoAccount')
        : e?.status === 400 ? (e.message || t('family.addCantLink'))
        : t('family.addFailed')
      );
    } finally {
      setAdding(false);
    }
  }

  async function onConfirm(linkId: string): Promise<void> {
    try { await confirmLovedOne(linkId); await loadLinks(); }
    catch { setNotice(t('family.confirmFailed')); }
  }

  function onRemove(link: LovedOne): void {
    const label = link.name || link.phone;
    Alert.alert(t('family.removeTitle'), t('family.stopSharing', { name: label }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'), style: 'destructive',
        onPress: async () => {
          try { await removeLovedOne(link.link_id); await loadLinks(); }
          catch { setNotice(t('family.removeFailed')); }
        },
      },
    ]);
  }

  function onProxy(name: string): void {
    navigation.navigate('Report', { proxy: true, prefilledName: name });
  }

  async function onSearch(nameOverride?: string): Promise<void> {
    const q = (nameOverride ?? query).trim();
    if (!q) return;
    setQuery(q);
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      setResults(await searchByName(q));
    } catch {
      setError(t('family.searchFailed'));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={FS.bg} contentContainerStyle={FS.content} keyboardShouldPersistTaps="handled">

      {/* ── Loved Ones (confirmed account links) ─────────────────────── */}
      <View style={FS.sectionHeader}>
        <Ionicons name="heart" size={14} color={C.govBlue} />
        <Text style={FS.sectionLabel}>{t('family.lovedOnes')}{confirmed.length ? ` (${confirmed.length})` : ''}</Text>
      </View>

      {!hasAccount ? (
        <View style={FS.gateBox}>
          <Ionicons name="person-circle-outline" size={36} color={C.borderStrong} />
          <Text style={FS.gateTitle}>{t('family.setupAccount')}</Text>
          <Text style={FS.gateText}>
            {t('family.setupAccountSub')}
          </Text>
          <TouchableOpacity style={FS.gateBtn} onPress={() => navigation.navigate('Account')} activeOpacity={0.85}>
            <Ionicons name="arrow-forward" size={16} color={C.textInv} />
            <Text style={FS.gateBtnText}>{t('family.goToAccount')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {notice ? (
            <View style={FS.noticeBox}>
              <Ionicons name="information-circle" size={16} color={C.govBlue} />
              <Text style={FS.noticeText}>{notice}</Text>
            </View>
          ) : null}

          {/* Add by phone */}
          <View style={FS.addRow}>
            <View style={FS.addField}>
              <Ionicons name="call-outline" size={16} color={C.textLo} />
              <TextInput
                style={FS.addInput}
                value={addPhone}
                onChangeText={setAddPhone}
                placeholder={t('family.addPlaceholder')}
                placeholderTextColor={C.textLo}
                keyboardType="phone-pad"
                autoCorrect={false}
                onSubmitEditing={onAdd}
                returnKeyType="done"
              />
            </View>
            <TouchableOpacity style={FS.addBtn} onPress={onAdd} disabled={adding} activeOpacity={0.85}>
              {adding
                ? <ActivityIndicator color={C.textInv} size="small" />
                : <Ionicons name="person-add" size={18} color={C.textInv} />}
            </TouchableOpacity>
          </View>

          {linksLoading && links.length === 0 ? (
            <View style={FS.inlineLoading}><ActivityIndicator color={C.govBlue} /></View>
          ) : null}

          {linksError ? (
            <View style={FS.errorBox}>
              <View style={FS.rowHead}>
                <Ionicons name="alert-circle" size={16} color={C.critical} />
                <Text style={FS.errorText}>{linksError}</Text>
              </View>
              <TouchableOpacity style={FS.retryBtn} onPress={loadLinks}>
                <Ionicons name="refresh" size={15} color={C.critical} />
                <Text style={FS.retryBtnText}>{t('common.tryAgain')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Confirmed loved ones */}
          {confirmed.map((l) => {
            const has = !!l.report_status;
            const col = has ? statusColor(l.report_status as string) : C.textLo;
            const dim = has ? statusDim(l.report_status as string) : C.bgRaised;
            const alert = has && ALERT_STATUSES.has(l.report_status as ReportStatus);
            return (
              <View key={l.link_id} style={[FS.card, alert && { borderLeftColor: col, borderLeftWidth: 3 }]}>
                <View style={FS.cardTop}>
                  <View style={[FS.statusDot, { backgroundColor: dim }]}>
                    <Ionicons name={(has ? (STATUS_ICON[l.report_status as string] ?? 'ellipse') : 'help') as any} size={18} color={col} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={FS.cardName} numberOfLines={1}>{l.name || l.phone}</Text>
                    <Text style={FS.cardMeta} numberOfLines={1}>
                      {has
                        ? `${l.status_updated_at ? relativeTime(Number(l.status_updated_at), t) : t('time.updated')}`
                        : t('family.noStatusYet')}
                    </Text>
                  </View>
                  {has ? (
                    <View style={[FS.badge, { backgroundColor: dim, borderColor: col }]}>
                      <Text style={[FS.badgeText, { color: col }]}>{statusLabel(l.report_status as string)}</Text>
                    </View>
                  ) : (
                    <View style={[FS.badge, { backgroundColor: C.bgRaised, borderColor: C.border }]}>
                      <Text style={[FS.badgeText, { color: C.textLo }]}>{t('family.noReport')}</Text>
                    </View>
                  )}
                </View>
                <View style={FS.cardActions}>
                  <VisibilityChip tier="coarse" short />
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={FS.chip} onPress={() => onProxy(l.name || '')}>
                    <Ionicons name="create-outline" size={15} color={C.amber} />
                    <Text style={[FS.chipText, { color: C.amber }]}>{t('family.report')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={FS.iconBtn} onPress={() => onRemove(l)} hitSlop={8}>
                    <Ionicons name="close" size={18} color={C.textLo} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {confirmed.length === 0 && !linksLoading && !linksError ? (
            <Text style={FS.emptyHint}>
              {t('family.noLovedOnes')}
            </Text>
          ) : null}

          {/* Incoming requests */}
          {incoming.length > 0 ? (
            <>
              <View style={FS.subHeader}>
                <Ionicons name="mail-unread-outline" size={13} color={C.amber} />
                <Text style={FS.subLabel}>{t('family.requestsForYou', { n: incoming.length })}</Text>
              </View>
              {incoming.map((l) => (
                <View key={l.link_id} style={FS.reqRow}>
                  <View style={FS.reqAvatar}><Text style={FS.reqAvatarText}>{(l.name || l.phone).charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={FS.cardName} numberOfLines={1}>{l.name || l.phone}</Text>
                    <Text style={FS.cardMeta}>{t('family.wantsToConnect')}</Text>
                  </View>
                  <TouchableOpacity style={FS.confirmBtn} onPress={() => onConfirm(l.link_id)}>
                    <Ionicons name="checkmark" size={15} color={C.textInv} />
                    <Text style={FS.confirmBtnText}>{t('family.confirm')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={FS.iconBtn} onPress={() => onRemove(l)} hitSlop={8}>
                    <Ionicons name="close" size={18} color={C.textLo} />
                  </TouchableOpacity>
                </View>
              ))}
            </>
          ) : null}

          {/* Outgoing pending requests */}
          {outgoing.length > 0 ? (
            <>
              <View style={FS.subHeader}>
                <Ionicons name="time-outline" size={13} color={C.textLo} />
                <Text style={FS.subLabel}>{t('family.awaitingConfirmation', { n: outgoing.length })}</Text>
              </View>
              {outgoing.map((l) => (
                <View key={l.link_id} style={FS.reqRow}>
                  <View style={[FS.reqAvatar, { backgroundColor: C.bgRaised }]}><Text style={[FS.reqAvatarText, { color: C.textLo }]}>{(l.name || l.phone).charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={FS.cardName} numberOfLines={1}>{l.name || l.phone}</Text>
                    <Text style={FS.cardMeta}>{t('family.requestSentLabel')}</Text>
                  </View>
                  <TouchableOpacity style={FS.iconBtn} onPress={() => onRemove(l)} hitSlop={8}>
                    <Text style={FS.cancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          ) : null}
        </>
      )}

      {/* ── Search by name or phone (find any registered person) ───────── */}
      <View style={[FS.sectionHeader, { marginTop: 22 }]}>
        <Ionicons name="search" size={14} color={C.textLo} />
        <Text style={FS.sectionLabel}>{t('family.searchByName')}</Text>
      </View>
      <Text style={FS.searchHint}>
        {t('family.searchHint')}
      </Text>

      <View style={FS.searchRow}>
        <View style={FS.searchField}>
          <Ionicons name="search" size={18} color={C.textLo} />
          <TextInput
            style={FS.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('family.searchPlaceholder')}
            placeholderTextColor={C.textLo}
            onSubmitEditing={() => onSearch()}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="words"
          />
        </View>
        <TouchableOpacity style={FS.searchBtn} onPress={() => onSearch()} disabled={loading} activeOpacity={0.85}>
          {loading
            ? <ActivityIndicator color={C.textInv} size="small" />
            : <Ionicons name="arrow-forward" size={20} color={C.textInv} />}
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={FS.errorBox}>
          <View style={FS.rowHead}>
            <Ionicons name="alert-circle" size={16} color={C.critical} />
            <Text style={FS.errorText}>{error}</Text>
          </View>
          <TouchableOpacity style={FS.retryBtn} onPress={() => onSearch()}>
            <Ionicons name="refresh" size={15} color={C.critical} />
            <Text style={FS.retryBtnText}>{t('common.tryAgain')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {searched && !loading && !error && results.length === 0 ? (
        <View style={FS.emptyBox}>
          <View style={FS.rowHead}>
            <Ionicons name="search" size={16} color={C.awaiting} />
            <Text style={FS.emptyText}>{t('family.noOneFound', { q: query })}</Text>
          </View>
          <TouchableOpacity style={FS.proxyBtn} onPress={() => onProxy(query)} activeOpacity={0.85}>
            <Ionicons name="person-add" size={16} color={C.textInv} />
            <Text style={FS.proxyBtnText}>{t('family.reportMissing', { q: query })}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {results.map((r) => {
        const has   = !!r.status;
        const col   = has ? statusColor(r.status as string) : C.textLo;
        const dim   = has ? statusDim(r.status as string) : C.bgRaised;
        const alert = has && ALERT_STATUSES.has(r.status as ReportStatus);
        return (
          <View key={r.id} style={[FS.card, alert && { borderLeftColor: col, borderLeftWidth: 3 }]}>
            <View style={FS.cardTop}>
              <View style={[FS.statusDot, { backgroundColor: dim }]}>
                <Ionicons name={(has ? (STATUS_ICON[r.status as string] ?? 'ellipse') : 'help') as any} size={18} color={col} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={FS.cardName} numberOfLines={1}>{r.name}</Text>
                <Text style={FS.cardMeta} numberOfLines={1}>
                  {r.phone_masked ? r.phone_masked : ''}
                  {has
                    ? `${r.phone_masked ? ' · ' : ''}${r.updated_at ? relativeTime(r.updated_at, t) : t('time.updated')}${r.coarse_lat != null ? ` · ~${r.coarse_lat.toFixed(2)}, ${r.coarse_lng?.toFixed(2)}` : ''}`
                    : `${r.phone_masked ? ' · ' : ''}${t('family.noStatusYet')}`}
                  {r.reported_by === 'family' ? `  · ${t('family.via', { name: r.reporter_name || t('family.familyMember') })}` : ''}
                </Text>
              </View>
              {has ? (
                <View style={[FS.badge, { backgroundColor: dim, borderColor: col }]}>
                  <Text style={[FS.badgeText, { color: col }]}>{statusLabel(r.status as string)}</Text>
                </View>
              ) : (
                <View style={[FS.badge, { backgroundColor: C.bgRaised, borderColor: C.border }]}>
                  <Text style={[FS.badgeText, { color: C.textLo }]}>{t('family.noReport')}</Text>
                </View>
              )}
            </View>
            <View style={FS.cardActions}>
              <VisibilityChip tier="coarse" short />
              <View style={{ flex: 1 }} />
              {alert ? (
                <TouchableOpacity style={FS.chip} onPress={() => onProxy(r.name)}>
                  <Ionicons name="create-outline" size={15} color={C.amber} />
                  <Text style={[FS.chipText, { color: C.amber }]}>{t('family.updateStatus')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}

      <View style={FS.privacyNote}>
        <Ionicons name="lock-closed" size={15} color={C.textLo} />
        <Text style={FS.privacyText}>
          {t('family.privacyNote')}
        </Text>
      </View>
    </ScrollView>
  );
}

const FS = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bgCanvas },
  content: { padding: 16, paddingBottom: 40 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4, color: C.textHi, textTransform: 'uppercase' },
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, marginBottom: 8 },
  subLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, color: C.textMd, textTransform: 'uppercase' },

  /* Account gate */
  gateBox: { alignItems: 'center', gap: 6, padding: 24, backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, borderColor: C.border },
  gateTitle: { fontSize: 15, fontWeight: '700', color: C.textHi, marginTop: 6 },
  gateText: { fontSize: 13, color: C.textLo, textAlign: 'center', lineHeight: 19 },
  gateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 18, paddingVertical: 11, borderRadius: R.sm, backgroundColor: C.govBlue },
  gateBtnText: { fontSize: 14, fontWeight: '700', color: C.textInv },

  /* Notice / inline states */
  noticeBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginBottom: 10, borderRadius: R.sm, backgroundColor: C.govBlueDim, borderWidth: 1, borderColor: C.border },
  noticeText: { flex: 1, fontSize: 13, color: C.govBlue, fontWeight: '600', lineHeight: 18 },
  inlineLoading: { paddingVertical: 16, alignItems: 'center' },
  emptyHint: { fontSize: 13, color: C.textLo, lineHeight: 19, paddingVertical: 8 },

  /* Add-by-phone */
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  addField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 46, backgroundColor: C.bgRaised, borderRadius: R.pill, borderWidth: 1, borderColor: C.border },
  addInput: { flex: 1, fontSize: 15, color: C.textHi, padding: 0 },
  addBtn: { width: 46, height: 46, borderRadius: R.pill, backgroundColor: C.govBlue, alignItems: 'center', justifyContent: 'center', ...SHADOW.card },

  /* Cards (loved ones + search results) */
  card: { backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  statusDot: { width: 38, height: 38, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardName: { fontSize: 16, fontWeight: '700', color: C.textHi, marginBottom: 2 },
  cardMeta: { fontSize: 12, color: C.textLo },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderWidth: 1, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'center' },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: R.pill, backgroundColor: C.bgRaised },
  chipText: { fontSize: 12, fontWeight: '700' },
  iconBtn: { padding: 6 },

  /* Request rows */
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  reqAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.govBlueDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  reqAvatarText: { fontSize: 15, fontWeight: '700', color: C.govBlue },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.pill, backgroundColor: C.safe },
  confirmBtnText: { fontSize: 13, fontWeight: '700', color: C.textInv },
  cancelText: { fontSize: 13, fontWeight: '700', color: C.textLo, paddingHorizontal: 4 },

  /* Search */
  searchHint: { fontSize: 13, color: C.textLo, lineHeight: 19, marginBottom: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  searchField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 48, backgroundColor: C.bgRaised, borderRadius: R.pill, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, fontSize: 16, color: C.textHi, padding: 0 },
  searchBtn: { width: 48, height: 48, borderRadius: R.pill, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', ...SHADOW.card },

  /* Shared blocks */
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  errorBox: { padding: 14, marginBottom: 10, borderRadius: R.md, borderWidth: 1, borderColor: C.criticalBorder, backgroundColor: C.criticalDim },
  errorText: { flex: 1, fontSize: 13, color: C.critical, lineHeight: 19, fontWeight: '600' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: R.sm, borderWidth: 1, borderColor: C.criticalBorder, backgroundColor: C.bgPanel },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: C.critical },
  emptyBox: { padding: 14, marginBottom: 10, borderRadius: R.md, borderWidth: 1, borderColor: C.awaitingBorder, backgroundColor: C.awaitingDim },
  emptyText: { flex: 1, fontSize: 13, color: C.awaiting, lineHeight: 19, fontWeight: '600' },
  proxyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11, borderRadius: R.sm, backgroundColor: C.amber },
  proxyBtnText: { fontSize: 14, fontWeight: '700', color: C.textInv },

  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 20, padding: 12, backgroundColor: C.bgRaised, borderRadius: R.md, borderWidth: 1, borderColor: C.border },
  privacyText: { flex: 1, fontSize: 12, color: C.textLo, lineHeight: 18 },
});
