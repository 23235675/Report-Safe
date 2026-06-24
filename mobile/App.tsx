import React, { useEffect, useRef } from 'react';
import {
  Animated, StyleSheet, View, Text, TouchableOpacity,
} from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { ReportStatus } from './src/api/apiClient';

import HomeScreen    from './src/screens/HomeScreen';
import ReportScreen  from './src/screens/ReportScreen';
import FamilyScreen  from './src/screens/FamilyScreen';
import ShelterScreen from './src/screens/ShelterScreen';
import AccountScreen from './src/screens/AccountScreen';
import DisasterModeScreen from './src/screens/DisasterModeScreen';
import IncidentResponseScreen from './src/screens/IncidentResponseScreen';
import { connectivityWatcher } from './src/services/connectivityWatcher';
import { notificationService } from './src/services/notificationService';
import { DisasterModeProvider, useDisasterMode } from './src/context/DisasterModeContext';
import { LanguageProvider, useTranslation } from './src/i18n';
import LangToggle from './src/components/LangToggle';
import { C, R, SHADOW } from './src/theme';

export const navigationRef = createNavigationContainerRef<RootTabParamList>();

export type RootTabParamList = {
  Home:    undefined;
  Report:  { initialStatus?: ReportStatus; proxy?: boolean; prefilledName?: string; disasterId?: string } | undefined;
  Family:  undefined;
  Map:     undefined;
  Account: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

/** Ionicons glyph per tab — filled when focused, outline when not. */
const TAB_ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  Home:    { on: 'home',          off: 'home-outline' },
  Report:  { on: 'megaphone',     off: 'megaphone-outline' },
  Family:  { on: 'people',        off: 'people-outline' },
  Map:     { on: 'location',      off: 'location-outline' },
  Account: { on: 'person-circle', off: 'person-circle-outline' },
};

export default function App(): React.JSX.Element {
  useEffect(() => {
    connectivityWatcher.startWatching();
    // Set up local disaster notifications (handler + Android channel + permission).
    notificationService.configure();
    notificationService.requestPermissions();
    return () => connectivityWatcher.stopWatching();
  }, []);

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <DisasterModeProvider>
          <AppContent />
        </DisasterModeProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}

/**
 * Gates the whole app behind disaster mode: when the device is inside an active
 * disaster zone and the user hasn't confirmed their safety, the full-screen
 * DisasterModeScreen replaces the tab navigator entirely.
 */
function AppContent(): React.JSX.Element {
  const { inDisasterMode, activeDisaster, acknowledgeAllInZone, activeIncident } = useDisasterMode();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  if (inDisasterMode && activeDisaster) {
    return (
      <>
        <StatusBar style="light" />
        <DisasterModeScreen
          disaster={activeDisaster}
          onReported={() => acknowledgeAllInZone()}
        />
      </>
    );
  }

  // CFR: an opted-in responder matched to a nearby emergency. Shown only when
  // the victim's own disaster gate isn't active (above). Dismissable.
  if (activeIncident) {
    return (
      <>
        <StatusBar style="light" />
        <IncidentResponseScreen />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            // Federal navy command bar — official, daylight-readable, white title.
            headerStyle: {
              backgroundColor: C.govBlue,
              borderBottomColor: C.brand,
              borderBottomWidth: 2,
              elevation: 0,
              shadowOpacity: 0,
            },
            headerTintColor: C.textInv,
            headerRight: () => <LangToggle />,
            headerTitleStyle: {
              fontWeight: '800',
              fontSize: 17,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: C.textInv,
            },
            tabBarStyle: {
              backgroundColor: C.bgPanel,
              borderTopColor: C.border,
              borderTopWidth: 1,
              height: 56 + insets.bottom,
              paddingTop: 6,
              paddingBottom: Math.max(insets.bottom, 8),
              elevation: 0,
              shadowOpacity: 0,
            },
            tabBarActiveTintColor: C.govBlue,
            tabBarInactiveTintColor: C.textLo,
            tabBarLabelStyle: {
              fontSize: 11,
              letterSpacing: 0.2,
              fontWeight: '600',
            },
            tabBarIcon: ({ focused, color, size }) => {
              const glyph = TAB_ICONS[route.name] ?? { on: 'ellipse', off: 'ellipse-outline' };
              return (
                <Ionicons
                  name={focused ? glyph.on : glyph.off}
                  size={size ?? 24}
                  color={color}
                />
              );
            },
          })}
        >
          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{
              title: t('tabs.homeTitle'),
              tabBarLabel: t('tabs.home'),
              headerTitleAlign: 'left',
              // 報 brand mark (matches the web wordmark), top-left of "Report Safe".
              headerLeft: () => (
                <View style={BM.mark}>
                  <Text style={BM.markText}>報</Text>
                </View>
              ),
            }}
          />
          <Tab.Screen
            name="Family"
            component={FamilyScreen}
            options={{ title: t('tabs.familyTitle'), tabBarLabel: t('tabs.family') }}
          />
          <Tab.Screen
            name="Report"
            component={ReportScreen}
            options={{
              title: t('tabs.reportTitle'),
              tabBarLabel: t('tabs.report'),
              // Core action — centered + raised + emphasized (mobile wireframe:
              // "REPORT 放中間：最大按鈕"). Navigation behaviour is unchanged.
              tabBarButton: (props) => <ReportTabButton {...props} />,
            }}
          />
          {/* Shelter info (always viewable). The live map lives on Home. */}
          <Tab.Screen
            name="Map"
            component={ShelterScreen}
            options={{ title: t('tabs.mapTitle'), tabBarLabel: t('tabs.shelters') }}
          />
          <Tab.Screen
            name="Account"
            component={AccountScreen}
            options={{ title: t('tabs.accountTitle'), tabBarLabel: t('tabs.account') }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <LovedOneBanner />
    </View>
  );
}

/**
 * Center "REPORT" tab — the core action, rendered as a raised, emphasized
 * circular button per the mobile wireframe. Reuses the tab's real onPress so
 * navigation/accessibility are unchanged; only the visual treatment differs.
 */
function ReportTabButton({ accessibilityState, onPress }: BottomTabBarButtonProps): React.JSX.Element {
  const focused = !!accessibilityState?.selected;
  return (
    <View style={CTB.slot} pointerEvents="box-none">
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={onPress}
        activeOpacity={0.85}
        style={[CTB.btn, focused && CTB.btnOn]}
      >
        <Ionicons name="megaphone" size={26} color={C.textInv} />
      </TouchableOpacity>
    </View>
  );
}

const BM = StyleSheet.create({
  mark: {
    marginLeft: 14, marginRight: 6, width: 28, height: 28, borderRadius: 6,
    backgroundColor: C.textInv, alignItems: 'center', justifyContent: 'center',
  },
  markText: { color: C.govBlue, fontSize: 16, fontWeight: '900', lineHeight: 20 },
});

const CTB = StyleSheet.create({
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  btn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.govBlue,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -16 }],
    borderWidth: 4,
    borderColor: C.bgPanel,
    ...SHADOW.raised,
  },
  btnOn: { backgroundColor: C.brand }, // deep navy ink when focused
});

/**
 * Floating amber banner shown when a confirmed loved one enters a disaster zone
 * while this app is open (socket path). Non-blocking — never enters disaster mode.
 * Renders outside NavigationContainer so it overlays every screen + tab transitions.
 */
function LovedOneBanner(): React.JSX.Element | null {
  const { lovedOneAlerts, dismissLovedOneAlert } = useDisasterMode();
  const { t, disasterTypeLabel } = useTranslation();
  const insets = useSafeAreaInsets();
  const alert = lovedOneAlerts[0] ?? null;
  const translateY = useRef(new Animated.Value(-100)).current;
  const shownId = useRef<string | null>(null);

  useEffect(() => {
    if (!alert) { shownId.current = null; return; }
    if (alert.id === shownId.current) return;
    shownId.current = alert.id;
    translateY.setValue(-100);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start();
    const t = setTimeout(() => dismissLovedOneAlert(alert.id), 7000);
    return () => clearTimeout(t);
  }, [alert?.id, translateY, dismissLovedOneAlert]);

  if (!alert) return null;

  function dismiss() { dismissLovedOneAlert(alert!.id); }
  function viewFamily() {
    dismiss();
    if (navigationRef.isReady()) navigationRef.navigate('Family');
  }

  return (
    <Animated.View
      style={[BN.wrap, { top: insets.top + 8, transform: [{ translateY }] }]}
      pointerEvents="box-none"
    >
      <View style={BN.card}>
        <View style={BN.icon}>
          <Ionicons name="heart" size={16} color={C.amber} />
        </View>
        <View style={{ flex: 1, minWidth: 0, marginHorizontal: 10 }}>
          <Text style={BN.title} numberOfLines={1}>
            {t('lovedOne.affected', { name: alert.affectedName || t('lovedOne.aLovedOne') })}
          </Text>
          <Text style={BN.sub} numberOfLines={1}>
            {t('lovedOne.sub', { type: disasterTypeLabel(alert.disaster.type) })}
          </Text>
        </View>
        <TouchableOpacity onPress={viewFamily} style={BN.viewBtn} activeOpacity={0.8}>
          <Text style={BN.viewText}>{t('lovedOne.view')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={dismiss} style={BN.closeBtn} hitSlop={10}>
          <Ionicons name="close" size={16} color={C.textLo} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const BN = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999,
    ...SHADOW.card,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bgPanel,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: C.amber,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.awaitingDim,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: { fontSize: 13, fontWeight: '700', color: C.textHi, lineHeight: 18 },
  sub:   { fontSize: 12, color: C.textLo, marginTop: 1 },
  viewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: R.pill,
    backgroundColor: C.amber,
    marginLeft: 4,
  },
  viewText: { fontSize: 12, fontWeight: '700', color: C.textInv },
  closeBtn: { padding: 6, marginLeft: 2 },
});
