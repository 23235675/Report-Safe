import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Switch, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { userStorage } from '../db/userStorage';
import { setAuthSession, clearAuthSession, loginUser, registerUser } from '../api/apiClient';
import { isValidHKID, normalizeHKID, normalizePhone } from '../utils/hkid';
import { C, R, SHADOW } from '../theme';
import { useTranslation } from '../i18n';

const USER_KEY = 'rs_user';

interface UserProfile {
  id?: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  personal_id?: string | null;
  privacy_consent: boolean;
  user_type?: string;
}

type Mode = 'login' | 'register' | 'profile';

export default function AccountScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('login');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Register form
  const [regForm, setRegForm] = useState({
    phone: '',
    name: '',
    personal_id: '',
    email: '',
    privacy_consent: false,
  });

  useEffect(() => {
    const raw = userStorage.get(USER_KEY);
    if (raw) {
      const p = JSON.parse(raw) as UserProfile;
      setProfile(p);
      setMode('profile');
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
          setRegForm({ phone: '', name: '', personal_id: '', email: '', privacy_consent: false });
        },
      },
    ]);
  }

  const initials = (profile?.name || profile?.phone || '?').charAt(0).toUpperCase();

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
              <TouchableOpacity onPress={() => { setMode('register'); setError(''); }}>
                <Text style={S.registerLink}>{t('account.createNow')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {/* ── REGISTER MODE ── */}
        {mode === 'register' ? (
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

              <View style={S.consentRow}>
                <Switch
                  value={regForm.privacy_consent}
                  onValueChange={(v) => setRegForm((f) => ({ ...f, privacy_consent: v }))}
                  trackColor={{ false: C.border, true: C.govBlue }}
                  thumbColor={C.bgPanel}
                />
                <Text style={S.consentText}>
                  {t('account.consent')}
                </Text>
              </View>

              <View style={S.formActions}>
                <TouchableOpacity
                  onPress={() => { setMode('login'); setError(''); }}
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
                <Text style={S.avatarText}>{initials}</Text>
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
});
