import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C, R } from '../theme';
import { useTranslation } from '../i18n';

/**
 * LangToggle — a compact EN / 中 switch shown in the navigation header.
 * Flips the app locale (persisted) between English and Traditional Chinese.
 */
export default function LangToggle(): React.JSX.Element {
  const { locale, setLocale } = useTranslation();
  return (
    <View style={S.wrap} accessibilityRole="radiogroup">
      <TouchableOpacity
        style={[S.opt, locale === 'en' && S.optActive]}
        onPress={() => setLocale('en')}
        accessibilityRole="radio"
        accessibilityState={{ selected: locale === 'en' }}
        activeOpacity={0.8}
      >
        <Text style={[S.txt, locale === 'en' && S.txtActive]}>EN</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[S.opt, locale === 'zh' && S.optActive]}
        onPress={() => setLocale('zh')}
        accessibilityRole="radio"
        accessibilityState={{ selected: locale === 'zh' }}
        activeOpacity={0.8}
      >
        <Text style={[S.txt, locale === 'zh' && S.txtActive]}>中</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    marginRight: 12,
    backgroundColor: C.bgRaised,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.pill,
  },
  opt: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: R.pill },
  optActive: { backgroundColor: C.govBlue },
  txt: { fontSize: 12, fontWeight: '700', color: C.textLo },
  txtActive: { color: C.textInv },
});
