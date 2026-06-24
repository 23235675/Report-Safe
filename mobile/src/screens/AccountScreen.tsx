import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Switch, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { userStorage } from '../db/userStorage';
import { setAuthSession, clearAuthSession, loginUser, registerUser, getCurrentUser, setResponderProfile } from '../api/apiClient';
import { isValidHKID, normalizeHKID, normalizePhone } from '../utils/hkid';
import { C, R, SHADOW } from '../theme';
import { useTranslation } from '../i18n';

const USER_KEY = 'rs_user';

interface UserProfile {
  id?: string;
  phone: string;
  name?: string | null;
  gender?: 'male' | 'female' | null;
  email?: string | null;
  personal_id?: string | null;
  privacy_consent: boolean;
  user_type?: string;
}

type Mode = 'login' | 'register' | 'profile';

/** Onboarding consent-page points (wireframe step 1). */
const CONSENT_POINTS: { icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
  { icon: 'document-text', key: 'account.consentTerms' },
  { icon: 'alert-circle',  key: 'account.consentEmergency' },
  { icon: 'location',      key: 'account.consentLocation' },
  { icon: 'notifications', key: 'account.consentNotification' },
];

export default function AccountScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('login');
  const [regStep, setRegStep] = useState<'consent' | 'details'>('consent');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Register form
  const [regForm, setRegForm] = useState({
    phone: '',
    name: '',
    gender: '' as '' | 'male' | 'female',
    personal_id: '',
    email: '',
    privacy_consent: false,
  });

  // ── Community First Responder (CFR) opt-in ──
  const RADIUS_OPTS = [
    { km: 0.4, key: 'responder.radiusWalk' },
    { km: 0.8, key: 'responder.radiusBike' },
    { km: 1.5, key: 'responder.radiusDrive' },
  ];
  const [respOptIn, setRespOptIn]   = useState(false);
  const [respSkills, setRespSkills] = useState<Set<'cpr' | 'aed' | 'fire'>>(new Set(['cpr']));
  const [respRadius, setRespRadius] = useState(0.8);
  const [respBusy, setRespBusy]     = useState(false);
  const [respSaved, setRespSaved]   = useState(false);
  const [respErr, setRespErr]       = useState('');

  function toggleSkill(s: 'cpr' | 'aed' | 'fire') {
    setRespSkills((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  async function saveResponder() {
    setRespErr('');
    setRespBusy(true);
    try {
      await setResponderProfile({
        responder_opt_in: respOptIn,
        responder_skills: [...respSkills],
        responder_max_radius_km: respRadius,
      });
      setRespSaved(true);
      setTimeout(() => setRespSaved(false), 2500);
    } catch (e: any) {
      setRespErr(e?.status === 401 ? t('responder.signInFirst') : (e.message || 'Failed'));
    } finally {
      setRespBusy(false);
    }
  }

  useEffect(() => {
    try {
      const raw = userStorage.get(USER_KEY);
      if (raw) {
        const p = JSON.parse(raw) as UserProfile & {
          responder_opt_in?: boolean; responder_skills?: ('cpr' | 'aed' | 'fire')[]; responder_max_radius_km?: number;
        };
        setProfile(p);
        setMode('profile');
        if (p.responder_opt_in != null) setRespOptIn(!!p.responder_opt_in);
        if (Array.isArray(p.responder_skills) && p.responder_skills.length) setRespSkills(new Set(p.responder_skills));
        if (p.responder_max_radius_km) setRespRadius(p.responder_max_radius_km);
      }
    } catch {
      // Corrupt stored profile — drop it and fall back to the login screen
      // rather than crashing the whole tab on mount.
      userStorage.remove(USER_KEY);
    }
  }, []);

  function applySession(body: any) {
    const p: UserProfile = body.user;
    setProfile(p);
    userStorage.set(USER_KEY, JSON.stringify(p));
    setAuthSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    setMode('profile');
  }

  // ── LOGIN (phone only, real endpoint — mirrors web) ──
  async function handleLogin() {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) { setError(t('account.errPhone')); return; }
    setLoading(true);
    setError('');
    try {
      applySession(await loginUser(normalizePhone(digits)));
      setPhone('');
    } catch (e: any) {
      setError(e?.status === 404
        ? t('account.noAccount')
        : (e.message || t('account.signInFailed')));
    } finally {
      setLoading(false);
    }
  }

  // ── REGISTER ──
  async function handleRegister() {
    const digits = regForm.phone.replace(/\D/g, '');
    if (digits.length < 8)        { setError(t('account.errPhone')); return; }
    if (!regForm.name.trim())     { setError(t('account.errFullName')); return; }
    if (!regForm.gender)          { setError(t('account.errGender')); return; }
    if (!regForm.personal_id.trim()) { setError(t('account.errHkidRequired')); return; }
    if (!isValidHKID(regForm.personal_id)) {
      setError(t('account.errHkidFormat')); return;
    }
    if (!regForm.privacy_consent) { setError(t('account.errConsent')); return; }

    setLoading(true);
    setError('');
    try {
      applySession(await registerUser({
        phone: normalizePhone(digits),
        name: regForm.name.trim(),
        gender: regForm.gender as 'male' | 'female',
        personal_id: normalizeHKID(regForm.personal_id),
        email: regForm.email.trim() || null,
        privacy_consent: regForm.privacy_consent,
        user_type: 'mobile',
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.details?.[0]?.message || e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── LOGOUT ──
  function handleLogout() {
    Alert.alert(t('account.signOutTitle'), t('account.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('account.signOut'),
        style: 'destructive',
        onPress: () => {
          userStorage.remove(USER_KEY);
          clearAuthSession();
          setProfile(null);
          setMode('login');
          setPhone('');
          setRegForm({ phone: '', name: '', gender: '', personal_id: '', email: '', privacy_consent: false });
        },
      },
    ]);
  }

  const genderIconName = profile?.gender === 'male' ? 'male' : profile?.gender === 'female' ? 'female' : 'person';

  return (
    <ScrollView style={S.bg} contentContainerStyle={S.container}>
      <View style={S.card}>
        {/* ── LOGIN MODE ── */}
        {mode === 'login' && !profile ? (
          <>
            <View style={S.header}>
              <Ionicons name="person-circle" size={40} color={C.govBlue} />
              <Text style={S.headerTitle}>{t('account.signIn')}</Text>
              <Text style={S.headerSub}>{t('account.signInSub')}</Text>
            </View>

            {error && (
              <View style={S.errorBar}>
                <Ionicons name="alert-circle" size={16} color={C.critical} />
                <Text style={S.errorText}>{error}</Text>
              </View>
            )}

            <View style={S.form}>
              <View style={S.field}>
                <Text style={S.fieldLbl}>{t('account.phoneLabel')}</Text>
                <View style={S.phoneRow}>
                  <Text style={S.phonePrefix}>+852</Text>
                  <TextInput
                    style={[S.input, S.phoneInput, S.mono]}
                    value={phone}
                    onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 8))}
                    placeholder="9 8 7 6 5 4 3 2"
                    placeholderTextColor={C.textLo}
                    keyboardType="numeric"
                    maxLength={8}
                  />
                </View>
              </View>

              <TouchableOpacity
                onPress={handleLogin}
                disabled={loading}
                style={[S.primaryBtn, loading && { opacity: 0.6 }]}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color={C.textInv} size="small" />
                ) : (
                  <Ionicons name="log-in" size={16} color={C.textInv} />
                )}
                <Text style={S.primaryBtnText}>{loading ? t('account.signingIn') : t('account.signIn')}</Text>
              </TouchableOpacity>
            </View>

            <View style={S.divider} />

            <View style={S.registerPrompt}>
              <Text style={S.registerPromptText}>{t('account.noAccountQ')}</Text>
              <TouchableOpacity onPress={() => { setMode('register'); setRegStep('consent'); setError(''); }}>
                <Text style={S.registerLink}>{t('account.createNow')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {/* ── ONBOARDING STEP 1: CONSENT (wireframe) ── */}
        {mode === 'register' && regStep === 'consent' ? (
          <>
            <View style={S.header}>
              <Ionicons name="shield-checkmark" size={40} color={C.govBlue} />
              <Text style={S.headerTitle}>{t('account.consentTitle')}</Text>
              <Text style={S.headerSub}>{t('account.consentIntro')}</Text>
            </View>

            <View style={S.form}>
              <View style={S.consentList}>
                {CONSENT_POINTS.map((p) => (
                  <View key={p.key} style={S.consentPoint}>
                    <Ionicons name={p.icon} size={18} color={C.govBlue} style={{ marginTop: 1 }} />
                    <Text style={S.consentPointText}>{t(p.key)}</Text>
                  </View>
                ))}
              </View>

              <View style={S.formActions}>
                <TouchableOpacity onPress={() => { setMode('login'); setError(''); }} style={S.ghostBtn}>
                  <Text style={S.ghostBtnText}>{t('common.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setRegForm((f) => ({ ...f, privacy_consent: true })); setRegStep('details'); setError(''); }}
                  style={S.primaryBtn}
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark" size={16} color={C.textInv} />
                  <Text style={S.primaryBtnText}>{t('account.agreeContinue')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : null}

        {/* ── ONBOARDING STEP 2: CREATE ACCOUNT (wireframe) ── */}
        {mode === 'register' && regStep === 'details' ? (
          <>
            <View style={S.header}>
              <Ionicons name="person-add-sharp" size={40} color={C.govBlue} />
              <Text style={S.headerTitle}>{t('account.createAccount')}</Text>
              <Text style={S.headerSub}>{t('account.setupProfile')}</Text>
            </View>

            {error && (
              <View style={S.errorBar}>
                <Ionicons name="alert-circle" size={16} color={C.critical} />
                <Text style={S.errorText}>{error}</Text>
              </View>
            )}

            <View style={S.form}>
              <View style={S.field}>
                <Text style={S.fieldLbl}>{t('account.phoneRegLabel')}</Text>
                <View style={S.phoneRow}>
                  <Text style={S.phonePrefix}>+852</Text>
                  <TextInput
                    style={[S.input, S.phoneInput, S.mono]}
                    value={regForm.phone}
                    onChangeText={(v) =>
                      setRegForm((f) => ({ ...f, phone: v.replace(/\D/g, '').slice(0, 8) }))
                    }
                    placeholder="9 8 7 6 5 4 3 2"
                    placeholderTextColor={C.textLo}
                    keyboardType="numeric"
                    maxLength={8}
                  />
                </View>
              </View>

              <View style={S.field}>
                <Text style={S.fieldLbl}>{t('account.fullName')}</Text>
                <TextInput
                  style={S.input}
                  value={regForm.name}
                  onChangeText={(v) => setRegForm((f) => ({ ...f, name: v }))}
                  placeholder={t('account.phFullName')}
                  placeholderTextColor={C.textLo}
                />
              </View>

              <View style={S.field}>
                <Text style={S.fieldLbl}>{t('account.genderLabel')}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['male', 'female'] as const).map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[S.input, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                        borderColor: regForm.gender === g ? C.govBlue : C.border,
                        backgroundColor: regForm.gender === g ? C.govBlueDim : C.bgPanel }]}
                      onPress={() => setRegForm((f) => ({ ...f, gender: g }))}
                    >
                      <Ionicons name={g} size={18} color={regForm.gender === g ? C.govBlue : C.textLo} />
                      <Text style={{ color: regForm.gender === g ? C.govBlue : C.textMd, fontWeight: '600' }}>
                        {t(g === 'male' ? 'account.genderMale' : 'account.genderFemale')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={S.field}>
                <Text style={S.fieldLbl}>{t('account.hkidLabel')}</Text>
                <TextInput
                  style={[S.input, S.mono]}
                  value={regForm.personal_id}
                  onChangeText={(v) => setRegForm((f) => ({ ...f, personal_id: v }))}
                  placeholder={t('account.phHkid')}
                  placeholderTextColor={C.textLo}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
                <Text style={S.fieldHint}>{t('account.hkidHint')}</Text>
              </View>

              <View style={S.field}>
                <Text style={S.fieldLbl}>{t('account.emailLabel')}</Text>
                <TextInput
                  style={S.input}
                  value={regForm.email}
                  onChangeText={(v) => setRegForm((f) => ({ ...f, email: v }))}
                  placeholder="name@example.com"
                  placeholderTextColor={C.textLo}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={S.consentGranted}>
                <Ionicons name="shield-checkmark" size={16} color={C.safe} />
                <Text style={S.consentGrantedText}>{t('account.consent')}</Text>
              </View>

              <View style={S.formActions}>
                <TouchableOpacity
                  onPress={() => { setRegStep('consent'); setError(''); }}
                  style={S.ghostBtn}
                >
                  <Text style={S.ghostBtnText}>{t('common.back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRegister}
                  disabled={loading}
                  style={[S.primaryBtn, loading && { opacity: 0.6 }]}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color={C.textInv} size="small" />
                  ) : (
                    <Ionicons name="checkmark" size={16} color={C.textInv} />
                  )}
                  <Text style={S.primaryBtnText}>{loading ? t('account.creating') : t('account.createAccount')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : null}

        {/* ── PROFILE MODE (logged in) ── */}
        {mode === 'profile' && profile ? (
          <>
            <View style={S.cardHead}>
              <View style={S.avatar}>
                <Ionicons name={genderIconName} size={26} color={C.textInv} />
              </View>
              <View style={S.identity}>
                <Text style={S.identityName}>{profile.name || t('account.noName')}</Text>
                <Text style={S.identityPhone}>{profile.phone}</Text>
              </View>
            </View>

            {saved && (
              <View style={S.successBar}>
                <Ionicons name="checkmark-circle" size={16} color={C.safe} />
                <Text style={S.successText}>{t('account.updated')}</Text>
              </View>
            )}

            <View style={S.profileView}>
              <View style={S.profileRow}>
                <Text style={S.prLbl}>{t('account.phone')}</Text>
                <Text style={[S.prVal, S.mono]}>{profile.phone}</Text>
              </View>
              {profile.personal_id && (
                <View style={S.profileRow}>
                  <Text style={S.prLbl}>{t('account.hkidLabel')}</Text>
                  <Text style={[S.prVal, S.mono]}>{profile.personal_id}</Text>
                </View>
              )}
              {profile.gender && (
                <View style={S.profileRow}>
                  <Text style={S.prLbl}>{t('account.genderLabel')}</Text>
                  <Text style={S.prVal}>
                    {t(profile.gender === 'male' ? 'account.genderMale' : 'account.genderFemale')}
                  </Text>
                </View>
              )}
              {profile.email && (
                <View style={S.profileRow}>
                  <Text style={S.prLbl}>{t('account.email')}</Text>
                  <Text style={S.prVal}>{profile.email}</Text>
                </View>
              )}
              <View style={S.profileRow}>
                <Text style={S.prLbl}>{t('account.privacyConsent')}</Text>
                <Text style={[S.prVal, { color: profile.privacy_consent ? C.safe : C.textLo }]}>
                  {profile.privacy_consent ? t('account.granted') : t('account.notGranted')}
                </Text>
              </View>
            </View>

            <TouchableOpacity onPress={handleLogout} style={S.signOutBtn} activeOpacity={0.85}>
              <Ionicons name="log-out-outline" size={18} color={C.critical} />
              <Text style={S.signOutText}>{t('account.signOut')}</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      {/* ── Community First Responder opt-in (logged-in users) ── */}
      {profile ? (
        <View style={S.card}>
          <View style={S.respHead}>
            <View style={S.respHeadIcon}>
              <Ionicons name="pulse" size={20} color={C.govBlue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.respTitle}>{t('responder.title')}</Text>
              <Text style={S.respSub}>{t('responder.sub')}</Text>
            </View>
          </View>

          <View style={S.respBody}>
            <View style={S.consentRow}>
              <Switch
                value={respOptIn}
                onValueChange={setRespOptIn}
                trackColor={{ false: C.border, true: C.govBlue }}
                thumbColor={C.bgPanel}
              />
              <View style={{ flex: 1 }}>
                <Text style={S.respOptLabel}>{t('responder.optIn')}</Text>
                <Text style={S.respHint}>{t('responder.optInHint')}</Text>
              </View>
            </View>

            {respOptIn ? (
              <>
                <Text style={S.respSection}>{t('responder.skills')}</Text>
                <View style={S.chipRow}>
                  {([['cpr', 'responder.skillCpr'], ['aed', 'responder.skillAed'], ['fire', 'responder.skillFire']] as const).map(([k, lbl]) => (
                    <TouchableOpacity
                      key={k}
                      style={[S.chip, respSkills.has(k) && S.chipOn]}
                      onPress={() => toggleSkill(k)}
                      activeOpacity={0.8}
                    >
                      <Text style={[S.chipText, respSkills.has(k) && S.chipTextOn]}>{t(lbl)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={S.respSection}>{t('responder.radius')}</Text>
                <View style={S.chipRow}>
                  {RADIUS_OPTS.map((o) => (
                    <TouchableOpacity
                      key={o.km}
                      style={[S.chip, respRadius === o.km && S.chipOn]}
                      onPress={() => setRespRadius(o.km)}
                      activeOpacity={0.8}
                    >
                      <Text style={[S.chipText, respRadius === o.km && S.chipTextOn]}>{t(o.key)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : null}

            {respErr ? (
              <View style={S.errorBar}>
                <Ionicons name="alert-circle" size={16} color={C.critical} />
                <Text style={S.errorText}>{respErr}</Text>
              </View>
            ) : null}
            {respSaved ? (
              <View style={S.respSavedBar}>
                <Ionicons name="checkmark-circle" size={16} color={C.safe} />
                <Text style={S.respSavedText}>{t('responder.saved')}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[S.respSaveBtn, respBusy && { opacity: 0.6 }]}
              onPress={saveResponder}
              disabled={respBusy}
              activeOpacity={0.85}
            >
              {respBusy ? <ActivityIndicator color={C.textInv} size="small" /> : <Ionicons name="checkmark" size={16} color={C.textInv} />}
              <Text style={S.respSaveText}>{respBusy ? t('responder.saving') : t('responder.save')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={S.privacyNote}>
        <View style={S.pnHead}>
          <Ionicons name="shield-checkmark" size={18} color={C.govBlue} />
          <Text style={S.pnTitle}>{t('account.privacyTitle')}</Text>
        </View>
        <Text style={S.pnBody}>
          {t('account.privacyBody')}
        </Text>
      </View>

      {!profile && (
        <View style={S.noAccountNote}>
          <Ionicons name="information-circle" size={18} color={C.amber} />
          <Text style={S.noAccountText}>
            {t('account.noAccountNote')}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const S = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bgCanvas },
  container: { padding: 16, paddingBottom: 32 },

  card: { backgroundColor: C.bgPanel, borderRadius: R.md, borderWidth: 1, borderColor: C.border, marginBottom: 16, overflow: 'hidden', ...SHADOW.card },

  header: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 18, fontWeight: '800', color: C.textHi, marginTop: 8 },
  headerSub: { fontSize: 13, color: C.textLo, marginTop: 4 },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.govBlue, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { color: C.textInv, fontSize: 20, fontWeight: '700' },
  identity: { flex: 1 },
  identityName: { fontSize: 16, fontWeight: '700', color: C.textHi },
  identityPhone: { fontSize: 13, color: C.textLo, marginTop: 2 },

  successBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.safeDim, padding: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  successText: { fontSize: 13, fontWeight: '600', color: C.safe },
  errorBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.criticalDim, padding: 10, margin: 12, marginBottom: 0, borderRadius: R.sm, borderWidth: 1, borderColor: C.criticalBorder },
  errorText: { flex: 1, fontSize: 13, fontWeight: '600', color: C.critical },

  form: { padding: 16, gap: 12 },
  field: { gap: 4 },
  fieldLbl: { fontSize: 12, fontWeight: '600', color: C.textMd, textTransform: 'uppercase', letterSpacing: 0.3 },
  fieldHint: { fontSize: 11, color: C.textLo, marginTop: 3 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 6, padding: 10, fontSize: 14, color: C.textHi, backgroundColor: C.bgCanvas },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  phonePrefix: { fontSize: 14, fontWeight: '700', color: C.textHi, marginLeft: 10 },
  phoneInput: { flex: 1 },
  mono: { fontFamily: 'monospace' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  consentText: { flex: 1, fontSize: 13, color: C.textMd, lineHeight: 18, marginTop: 2 },
  consentList: { gap: 12, marginBottom: 4 },
  consentPoint: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  consentPointText: { flex: 1, fontSize: 13, color: C.textMd, lineHeight: 19 },
  consentGranted: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, backgroundColor: C.safeDim, borderRadius: R.sm, borderWidth: 1, borderColor: C.safeBorder },
  consentGrantedText: { flex: 1, fontSize: 12, color: C.textMd, lineHeight: 17 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  ghostBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: R.sm, borderWidth: 1, borderColor: C.border },
  ghostBtnText: { fontSize: 14, fontWeight: '600', color: C.textMd },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 20, paddingVertical: 11, borderRadius: R.sm, backgroundColor: C.govBlue },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: C.textInv },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  registerPrompt: { paddingHorizontal: 16, paddingBottom: 16, alignItems: 'center', gap: 6 },
  registerPromptText: { fontSize: 13, color: C.textMd },
  registerLink: { fontSize: 14, fontWeight: '700', color: C.govBlue, textDecorationLine: 'underline' },

  profileView: { padding: 16 },
  profileRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  prLbl: { width: 130, fontSize: 11, fontWeight: '700', color: C.textLo, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 1 },
  prVal: { flex: 1, fontSize: 14, color: C.textHi },

  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, padding: 12, borderRadius: R.sm, borderWidth: 1, borderColor: C.criticalBorder, backgroundColor: C.criticalDim },
  signOutText: { fontSize: 14, fontWeight: '700', color: C.critical },

  privacyNote: { backgroundColor: C.govBlueDim, borderRadius: R.md, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  pnHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  pnTitle: { fontSize: 14, fontWeight: '700', color: C.textHi },
  pnBody: { fontSize: 13, color: C.textMd, lineHeight: 19 },

  noAccountNote: { flexDirection: 'row', gap: 10, backgroundColor: C.awaitingDim, borderRadius: R.md, padding: 12, borderWidth: 1, borderColor: C.border, alignItems: 'flex-start' },
  noAccountText: { flex: 1, fontSize: 12, color: C.textMd, lineHeight: 16 },

  /* Responder opt-in */
  respHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  respHeadIcon: { width: 40, height: 40, borderRadius: R.sm, backgroundColor: C.govBlueDim, alignItems: 'center', justifyContent: 'center' },
  respTitle: { fontSize: 15, fontWeight: '800', color: C.textHi },
  respSub: { fontSize: 12, color: C.textLo, marginTop: 3, lineHeight: 16 },
  respBody: { padding: 16, gap: 12 },
  respOptLabel: { fontSize: 14, fontWeight: '700', color: C.textHi },
  respHint: { fontSize: 12, color: C.textLo, marginTop: 2, lineHeight: 16 },
  respSection: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: C.textMd, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: R.pill, backgroundColor: C.bgCanvas, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.govBlueDim, borderColor: C.govBlue },
  chipText: { fontSize: 13, fontWeight: '600', color: C.textMd },
  chipTextOn: { color: C.govBlue },
  respSavedBar: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: C.safeDim, borderRadius: R.sm, borderWidth: 1, borderColor: C.safeBorder },
  respSavedText: { fontSize: 13, fontWeight: '600', color: C.safe },
  respSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: R.sm, backgroundColor: C.govBlue, marginTop: 4 },
  respSaveText: { fontSize: 15, fontWeight: '700', color: C.textInv },
});
