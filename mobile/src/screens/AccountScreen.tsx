import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { userStorage } from '../db/userStorage';
import { setAuthSession, clearAuthSession, loginUser, registerUser, setResponderProfile } from '../api/apiClient';
import { isValidHKID, normalizeHKID, normalizePhone } from '../utils/hkid';
import { C } from '../theme';
import { useTranslation } from '../i18n';
import LoginFlow from './account/LoginFlow';
import RegisterFlow from './account/RegisterFlow';
import ProfilePanel from './account/ProfilePanel';
import ResponderSettings from './account/ResponderSettings';
import { S } from './account/styles';

/**
 * Account tab orchestrator. Owns the mode/regStep state machine, the profile +
 * form + responder state, and every handler; the panels
 * (LoginFlow / RegisterFlow / ProfilePanel / ResponderSettings) are
 * presentational and receive props/callbacks. All state deliberately lives
 * here so typed-but-unsubmitted input survives switching between panels,
 * exactly as it did when this was a single component.
 */

const USER_KEY = 'rs_user';

export interface UserProfile {
  id?: string;
  phone: string;
  name?: string | null;
  gender?: 'male' | 'female' | null;
  email?: string | null;
  personal_id?: string | null;
  privacy_consent: boolean;
  user_type?: string;
}

export interface RegFormState {
  phone: string;
  name: string;
  gender: '' | 'male' | 'female';
  personal_id: string;
  email: string;
  privacy_consent: boolean;
}

type Mode = 'login' | 'register' | 'profile';

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
  const [regForm, setRegForm] = useState<RegFormState>({
    phone: '',
    name: '',
    gender: '',
    personal_id: '',
    email: '',
    privacy_consent: false,
  });

  // ── Community First Responder (CFR) opt-in ──
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

  // ── Mode/regStep state machine transitions (passed to the panels) ──
  function goToRegister() { setMode('register'); setRegStep('consent'); setError(''); }
  function backToLogin() { setMode('login'); setError(''); }
  function agreeAndContinue() { setRegForm((f) => ({ ...f, privacy_consent: true })); setRegStep('details'); setError(''); }
  function backToConsent() { setRegStep('consent'); setError(''); }

  return (
    <ScrollView style={S.bg} contentContainerStyle={S.container}>
      <View style={S.card}>
        {/* ── LOGIN MODE ── */}
        {mode === 'login' && !profile ? (
          <LoginFlow
            phone={phone}
            setPhone={setPhone}
            loading={loading}
            error={error}
            onLogin={handleLogin}
            onGoRegister={goToRegister}
          />
        ) : null}

        {/* ── REGISTER MODE (consent → details) ── */}
        {mode === 'register' ? (
          <RegisterFlow
            regStep={regStep}
            regForm={regForm}
            setRegForm={setRegForm}
            loading={loading}
            error={error}
            onBackToLogin={backToLogin}
            onAgreeContinue={agreeAndContinue}
            onBackToConsent={backToConsent}
            onRegister={handleRegister}
          />
        ) : null}

        {/* ── PROFILE MODE (logged in) ── */}
        {mode === 'profile' && profile ? (
          <ProfilePanel profile={profile} saved={saved} onLogout={handleLogout} />
        ) : null}
      </View>

      {/* ── Community First Responder opt-in (logged-in users) ── */}
      {profile ? (
        <ResponderSettings
          respOptIn={respOptIn}
          setRespOptIn={setRespOptIn}
          respSkills={respSkills}
          onToggleSkill={toggleSkill}
          respRadius={respRadius}
          onSetRadius={setRespRadius}
          respBusy={respBusy}
          respSaved={respSaved}
          respErr={respErr}
          onSave={saveResponder}
        />
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
