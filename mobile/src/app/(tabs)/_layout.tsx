import { Tabs } from 'expo-router';
import { Icon } from '@/components/ui';
import { colors } from '@/lib/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="learn" options={{ title: 'Learn', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'home' : 'home-outline'} color={color} size={24} /> }} />
      <Tabs.Screen name="practice" options={{ title: 'Practice', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'search' : 'search-outline'} color={color} size={24} /> }} />
      <Tabs.Screen name="league" options={{ title: 'League', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'trophy' : 'trophy-outline'} color={color} size={24} /> }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} size={24} /> }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends', tabBarIcon: ({ color, focused }) => <Icon name={focused ? 'people' : 'people-outline'} color={color} size={24} /> }} />
    </Tabs>
  );
}
