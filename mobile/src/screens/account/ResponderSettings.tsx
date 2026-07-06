import React from 'react';
import { View, Text, TouchableOpacity, Switch, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../theme';
import { useTranslation } from '../../i18n';
import { S } from './styles';

/**
 * Community First Responder (CFR) opt-in card. JSX moved verbatim from
 * AccountScreen — the responder state and save handler stay in the
 * orchestrator (they are initialized from the stored profile on mount).
 */

interface Props {
  respOptIn: boolean;
  setRespOptIn: (v: boolean) => void;
  respSkills: Set<'cpr' | 'aed' | 'fire'>;
  onToggleSkill: (s: 'cpr' | 'aed' | 'fire') => void;
  respRadius: number;
  onSetRadius: (km: number) => void;
  respBusy: boolean;
  respSaved: boolean;
  respErr: string;
  onSave: () => void;
}

export default function ResponderSettings({
  respOptIn, setRespOptIn, respSkills, onToggleSkill,
  respRadius, onSetRadius, respBusy, respSaved, respErr, onSave,
}: Props): React.JSX.Element {
  const { t } = useTranslation();

  const RADIUS_OPTS = [
    { km: 0.4, key: 'responder.radiusWalk' },
    { km: 0.8, key: 'responder.radiusBike' },
    { km: 1.5, key: 'responder.radiusDrive' },
  ];

  return (
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
                  onPress={() => onToggleSkill(k)}
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
                  onPress={() => onSetRadius(o.km)}
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
          onPress={onSave}
          disabled={respBusy}
          activeOpacity={0.85}
        >
          {respBusy ? <ActivityIndicator color={C.textInv} size="small" /> : <Ionicons name="checkmark" size={16} color={C.textInv} />}
          <Text style={S.respSaveText}>{respBusy ? t('responder.saving') : t('responder.save')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
