import React, { useEffect, useRef } from 'react';
import {
  Animated, StyleSheet, View, Text, TouchableOpacity,
} from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { ReportStatus } from './src/api/apiClient';

import HomeScreen    from './src/screens/HomeScreen';
import ReportScreen  from './src/screens/ReportScreen';
import FamilyScreen  from './src/screens/FamilyScreen';
import MapScreen     from './src/screens/MapScreen';
import AccountScreen from './src/screens/AccountScreen';
import DisasterModeScreen from './src/screens/DisasterModeScreen';
import { connectivityWatcher } from './src/services/connectivityWatcher';
import { notificationService } from './src/services/notificationService';
import { DisasterModeProvider, useDisasterMode } from './src/context/DisasterModeContext';
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
      <DisasterModeProvider>
        <AppContent />
      </DisasterModeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Gates the whole app behind disaster mode: when the device is inside an active
 * disaster zone and the user hasn't confirmed their safety, the full-screen
 * DisasterModeScreen replaces the tab navigator entirely.
 */
function AppContent(): React.JSX.Element {
  const { inDisasterMode, activeDisaster, acknowledgeDisaster } = useDisasterMode();
  const insets = useSafeAreaInsets();

  if (inDisasterMode && activeDisaster) {
    return (
      <>
        <StatusBar style="light" backgroundColor={C.bgPanel} />
        <DisasterModeScreen
          disaster={activeDisaster}
          onReported={() => acknowledgeDisaster(activeDisaster.id)}
        />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef}>
        <StatusBar style="light" backgroundColor={C.bgPanel} />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: {
              backgroundColor: C.bgPanel,
              borderBottomColor: C.border,
              borderBottomWidth: 1,
              elevation: 0,
              shadowOpacity: 0,
            },
            headerTintColor: C.textHi,
            headerTitleStyle: {
              fontWeight: '700',
              fontSize: 17,
              letterSpacing: 0.2,
              color: C.textHi,
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
            options={{ title: 'Report Safe', tabBarLabel: 'Home' }}
          />
          <Tab.Screen
            name="Report"
            component={ReportScreen}
            options={{ title: 'Submit Report', tabBarLabel: 'Report' }}
          />
          <Tab.Screen
            name="Family"
            component={FamilyScreen}
            options={{ title: 'Find Someone', tabBarLabel: 'Family' }}
          />
          <Tab.Screen
            name="Map"
            component={MapScreen}
            options={{ title: 'Shelters', tabBarLabel: 'Shelters' }}
          />
          <Tab.Screen
            name="Account"
            component={AccountScreen}
            options={{ title: 'Account', tabBarLabel: 'Account' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <LovedOneBanner />
    </View>
  );
}

/**
 * Floating amber banner shown when a confirmed loved one enters a disaster zone
 * while this app is open (socket path). Non-blocking — never enters disaster mode.
 * Renders outside NavigationContainer so it overlays every screen + tab transitions.
 */
function LovedOneBanner(): React.JSX.Element | null {
  const { lovedOneAlerts, dismissLovedOneAlert } = useDisasterMode();
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
            {alert.affectedName || 'A loved one'} may be affected
          </Text>
          <Text style={BN.sub} numberOfLines={1}>
            {alert.disaster.type} · Tap View to see their status
          </Text>
        </View>
        <TouchableOpacity onPress={viewFamily} style={BN.viewBtn} activeOpacity={0.8}>
          <Text style={BN.viewText}>View</Text>
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
