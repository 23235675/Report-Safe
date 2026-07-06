import { StyleSheet } from 'react-native';
import { C, R, SHADOW } from '../../theme';

/**
 * Shared styles for the Account screen family (AccountScreen orchestrator +
 * LoginFlow / RegisterFlow / ProfilePanel / ResponderSettings). Moved verbatim
 * from AccountScreen.tsx so the split introduces zero visual change.
 */
export const S = StyleSheet.create({
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
