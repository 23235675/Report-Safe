import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../theme';
import { useTranslation } from '../../i18n';
import { S } from './styles';
import type { UserProfile } from '../AccountScreen';

/**
 * Logged-in profile panel (identity card + detail rows + sign-out). JSX moved
 * verbatim from AccountScreen — the profile state and logout handler stay in
 * the orchestrator.
 */

interface Props {
  profile: UserProfile;
  saved: boolean;
  onLogout: () => void;
}

export default function ProfilePanel({ profile, saved, onLogout }: Props): React.JSX.Element {
  const { t } = useTranslation();

  const genderIconName = profile.gender === 'male' ? 'male' : profile.gender === 'female' ? 'female' : 'person';

  return (
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

      <TouchableOpacity onPress={onLogout} style={S.signOutBtn} activeOpacity={0.85}>
        <Ionicons name="log-out-outline" size={18} color={C.critical} />
        <Text style={S.signOutText}>{t('account.signOut')}</Text>
      </TouchableOpacity>
    </>
  );
}
