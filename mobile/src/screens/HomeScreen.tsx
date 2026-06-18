import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { C, R, SHADOW, DISASTER_ICON } from '../theme';
import { useDisasterMode } from '../context/DisasterModeContext';
import { useTranslation } from '../i18n';

function severityColors(s: number | null | undefined): { color: string; dim: string } {
  if (!s || s < 3) return { color: C.safe,     dim: C.safeDim };
  if (s < 4)       return { color: C.injured,  dim: C.injuredDim };
  if (s < 5)       return { color: C.awaiting, dim: C.awaitingDim };
  return             { color: C.critical, dim: C.criticalDim };
}

export default function HomeScreen(): React.JSX.Element {
  const navigation = useNavigation<any>();
  const { t, severityLabel, disasterTypeLabel } = useTranslation();
  // Live data + the disaster-mode gate come from the app-wide provider, which
  // owns the single Socket.IO connection (so this device is tracked once).
  const { stats, disasters, pending, loading, loaded, error, refresh } = useDisasterMode();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const isActive    = disasters.length > 0 || stats.active_disasters > 0;
  const missingSum  = (stats.potentially_missing || 0) + (stats.missing || 0);

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

      {/* ── Status ribbon (with inline pending-sync pill) ──────── */}
      {loaded ? (
      <>
      <View style={[S.ribbon, isActive ? S.ribbonActive : S.ribbonClear]}>
        <Ionicons
          name={isActive ? 'warning' : 'shield-checkmark'}
          size={18}
          color={isActive ? C.critical : C.safe}
        />
        <Text style={[S.ribbonText, { flex: 1, color: isActive ? C.critical : C.safe }]}>
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

      {/* ── Aggregate stats bar ───────────────────────────────── */}
      <View style={S.statsBar}>
        <StatPill label={t('home.statTotal')}   value={stats.total}        color={C.textHi}    />
        <StatPill label={t('home.statSafe')}    value={stats.safe}         color={C.safe}      />
        <StatPill label={t('home.statInjured')} value={stats.injured}      color={C.injured}   />
        <StatPill label={t('home.statHelp')}    value={stats.need_help}    color={C.critical}  />
        <StatPill label={t('home.statMissing')} value={missingSum}         color={C.potMissing}/>
      </View>

      {/* ── Disaster cards ────────────────────────────────────── */}
      {disasters.length > 0 ? (
        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('home.activeIncidents')}</Text>
          {disasters.map((d) => {
            const sev = severityColors(d.severity);
            return (
              <View key={d.id} style={S.disasterCard}>
                <View style={S.dcHead}>
                  <View style={[S.dcIcon, { backgroundColor: C.criticalDim }]}>
                    <Ionicons
                      name={(DISASTER_ICON[d.type?.toLowerCase()] ?? 'alert-circle') as any}
                      size={20}
                      color={C.critical}
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
          })}
        </View>
      ) : (
        <View style={S.noDisasters}>
          <View style={S.noDisCheck}>
            <Ionicons name="shield-checkmark" size={26} color={C.safe} />
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

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={S.statPill}>
      <Text style={[S.statVal, { color }]}>{value}</Text>
      <Text style={S.statLbl}>{label}</Text>
    </View>
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
  ribbonClear:  { backgroundColor: C.safeDim,     borderBottomWidth: 1, borderBottomColor: C.safeBorder },
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

  statsBar: {
    flexDirection: 'row', backgroundColor: C.bgPanel,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  statPill: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statVal:  { fontSize: 18, fontWeight: '700', lineHeight: 22 },
  statLbl:  { fontSize: 10, color: C.textLo, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.textHi, marginBottom: 12, letterSpacing: 0.1 },

  disasterCard: {
    backgroundColor: C.bgPanel, borderRadius: R.md,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 12, overflow: 'hidden',
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
  dcStatUnit: { fontSize: 13, fontWeight: '500', color: C.textLo },
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
    backgroundColor: C.safeDim, borderWidth: 2, borderColor: C.safeBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  noDisTitle: { fontSize: 16, fontWeight: '700', color: C.textHi, marginBottom: 4 },
  noDisSub:   { fontSize: 13, color: C.textLo, textAlign: 'center', lineHeight: 18 },

});
