import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../theme';
import { useTranslation } from '../../i18n';
import { S } from './styles';
import type { RegFormState } from '../AccountScreen';

/**
 * Two-step onboarding (consent → details). JSX moved verbatim from
 * AccountScreen — the mode/regStep state machine, the form state and the
 * register handler stay in the orchestrator.
 */

/** Onboarding consent-page points (wireframe step 1). */
const CONSENT_POINTS: { icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
  { icon: 'document-text', key: 'account.consentTerms' },
  { icon: 'alert-circle',  key: 'account.consentEmergency' },
  { icon: 'location',      key: 'account.consentLocation' },
  { icon: 'notifications', key: 'account.consentNotification' },
];

interface Props {
  regStep: 'consent' | 'details';
  regForm: RegFormState;
  setRegForm: React.Dispatch<React.SetStateAction<RegFormState>>;
  loading: boolean;
  error: string;
  onBackToLogin: () => void;
  onAgreeContinue: () => void;
  onBackToConsent: () => void;
  onRegister: () => void;
}

export default function RegisterFlow({
  regStep, regForm, setRegForm, loading, error,
  onBackToLogin, onAgreeContinue, onBackToConsent, onRegister,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      {/* ── ONBOARDING STEP 1: CONSENT (wireframe) ── */}
      {regStep === 'consent' ? (
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
              <TouchableOpacity onPress={onBackToLogin} style={S.ghostBtn}>
                <Text style={S.ghostBtnText}>{t('common.back')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onAgreeContinue}
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
      {regStep === 'details' ? (
        <>
          <View style={S.header}>
            <Ionicons name="person-add-sharp" size={40} color={C.govBlue} />
            <Text style={S.headerTitle}>{t('account.createAccount')}</Text>
            <Text style={S.headerSub}>{t('account.setupProfile')}</Text>
          </View>

          {error && (
            <View style={S.errorBar} accessibilityLiveRegion="polite">
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
                  accessibilityLabel={t('account.phoneRegLabel')}
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
                accessibilityLabel={t('account.fullName')}
              />
            </View>

            <View style={S.field}>
              <Text style={S.fieldLbl}>{t('account.genderLabel')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
                {(['male', 'female'] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[S.input, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      borderColor: regForm.gender === g ? C.govBlue : C.border,
                      backgroundColor: regForm.gender === g ? C.govBlueDim : C.bgPanel }]}
                    onPress={() => setRegForm((f) => ({ ...f, gender: g }))}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: regForm.gender === g }}
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
                accessibilityLabel={t('account.hkidLabel')}
                accessibilityHint={t('account.hkidHint')}
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
                accessibilityLabel={t('account.emailLabel')}
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
                onPress={onBackToConsent}
                style={S.ghostBtn}
              >
                <Text style={S.ghostBtnText}>{t('common.back')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onRegister}
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
    </>
  );
}
