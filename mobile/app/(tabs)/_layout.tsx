import { Tabs } from 'expo-router';
import { Baby, CalendarDays, Ellipsis, ListTodo } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import YenCoinIcon from '@/components/ui/YenCoinIcon';

// 下のタブバー。予定・リスト・育児・家計・その他の5つ（docs/family-app.md §4.1・docs/kakei.md §2）。
// 暮らしタブは2026-10-10に廃止した。2026-10-13にタブを改め、リストタブを「ToDo」、設定タブを「その他」にした
// （防災備蓄・福引チャンス・保活・契約・設定はその他タブから開く。docs/family-app.md §4.5）。
// ファイル名（list.tsx・info.tsx）と DB の users.start_tab の値（'list'・'settings'）は変えていない。
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
        // キーボードが出ているあいだは、下のタブバーを隠して入力欄に高さを譲る。
        tabBarHideOnKeyboard: true,
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
        name="money"
        options={{ title: '家計', tabBarIcon: ({ color }) => <YenCoinIcon size={22} color={color} /> }}
      />
      <Tabs.Screen
        name="info"
        options={{ title: 'その他', tabBarIcon: ({ color }) => <Ellipsis size={22} color={color} /> }}
      />
    </Tabs>
  );
}
