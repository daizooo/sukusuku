import { Tabs } from 'expo-router';
import { Baby, CalendarDays, ListTodo, Settings } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 下のタブバー。予定・リスト・育児・設定の4つ（docs/family-app.md §4.1）。
// 並び・見出し・アイコンはPWA版の NAV_ITEMS と同じにしてある
// （src/components/sukusuku/SukusukuApp.tsx）。
//
// PWA版は画面の広い端末では左の縦ナビになるが、こちらは常に下のタブバー。
// PWA版もスマホ幅では下のタブバーなので、出る形は同じ。

export default function TabsLayout() {
  return (
    <Tabs
      // 戻る操作は、開いた順に1つ前のタブへ戻る（既定はどこからでもホームへ戻ってしまう）。
      // 最初のタブまで戻ったところで、アプリを閉じる。
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navActive,
        tabBarInactiveTintColor: colors.navInactive,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="schedule"
        options={{
          title: '予定',
          tabBarIcon: ({ color }) => <CalendarDays size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: 'リスト',
          tabBarIcon: ({ color }) => <ListTodo size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="care"
        options={{ title: '育児', tabBarIcon: ({ color }) => <Baby size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="info"
        options={{ title: '設定', tabBarIcon: ({ color }) => <Settings size={22} color={color} /> }}
      />
    </Tabs>
  );
}
