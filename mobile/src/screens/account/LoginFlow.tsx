import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../theme';
import { useTranslation } from '../../i18n';
import { S } from './styles';

/**
 * Sign-in panel (phone-only login). JSX moved verbatim from AccountScreen —
 * state and the login handler stay in the orchestrator.
 */

interface Props {
  phone: string;
  setPhone: (v: string) => void;
  loading: boolean;
  error: string;
  onLogin: () => void;
  onGoRegister: () => void;
}

export default function LoginFlow({
  phone, setPhone, loading, error, onLogin, onGoRegister,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  return (
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
          onPress={onLogin}
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
        <TouchableOpacity onPress={onGoRegister}>
          <Text style={S.registerLink}>{t('account.createNow')}</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
