'use client';

import type { ReactNode } from 'react';
import { useSessionState } from '@/lib/sessionState';
import { ClipboardCheck, Settings } from 'lucide-react';
import ContractMoreRow from '@/components/sukusuku/living/ContractMoreRow';
import LotteryMoreRow from '@/components/sukusuku/living/LotteryMoreRow';
import StockEntryRow from '@/components/sukusuku/living/StockEntryRow';
import HokatsuScreen from '@/components/sukusuku/HokatsuScreen';
import type { FeedingSettings } from '@/lib/api/feedingSettings';
import type { TemperatureReminderSettings } from '@/lib/api/temperatureReminderSettings';
import ContractsScreen from './ContractsScreen';
import LotteryScreen from './LotteryScreen';
import MoreRow from './MoreRow';
import SettingsScreen from './SettingsScreen';
import StockScreen from './StockScreen';

// その他タブ（docs/family-app.md §4.5）。以前の設定タブ。毎日は開かないものの入口を、上から
// 福引チャンス・契約・防災備蓄・保活・設定の順に並べる。中身は、それぞれ別の画面で開く。
//   - 福引チャンス: 以前は家計タブの＋ボタンの中（tabs/LotteryScreen）
//   - 契約: 賃貸・保険・サブスクなどの控え（tabs/ContractsScreen。docs/contracts.md）
//   - 防災備蓄: 以前はリストタブの下（tabs/StockScreen）
//   - 保活: 以前は設定タブの中（HokatsuScreen）
//   - 設定: 以前の設定タブの中身（tabs/SettingsScreen）
// mobile版は `mobile/app/(tabs)/info.tsx`。
//
// 設定タブだった流れで、画面全体がスクロールしてよい（ルートの CLAUDE.md の「画面の作り方」の例外）。

type Screen = 'lottery' | 'contracts' | 'stock' | 'nursery' | 'settings';

interface InfoTabProps {
  familyId: string;
  userId: string;
  /** 次の授乳の目安の設定。家族で共通なので、変更はアプリ全体へ反映する。 */
  feedingSettings: FeedingSettings;
  onChangeFeedingSettings: (settings: FeedingSettings) => void;
  /** 検温のお知らせの設定。こちらも家族で共通。 */
  temperatureReminderSettings: TemperatureReminderSettings;
  onChangeTemperatureReminderSettings: (settings: TemperatureReminderSettings) => void;
  /** 保活（見学チェック）の中身（HokatsuTab）。保活の画面を開いたときだけ描画する。 */
  hokatsuPanel: ReactNode;
}

export default function InfoTab({
  familyId,
  userId,
  feedingSettings,
  onChangeFeedingSettings,
  temperatureReminderSettings,
  onChangeTemperatureReminderSettings,
  hokatsuPanel,
}: InfoTabProps) {
  // 開いている画面。null のあいだはその他タブの一覧を出す（戻る操作で一覧へ戻る）。
  // ブラウザの更新をしても、開いている画面のまま戻す（2026-10-16）。
  const [screen, setScreen] = useSessionState<Screen | null>('info.screen', null);
  const close = () => setScreen(null);

  if (screen === 'lottery') return <LotteryScreen familyId={familyId} userId={userId} onClose={close} />;
  if (screen === 'contracts') return <ContractsScreen familyId={familyId} userId={userId} onClose={close} />;
  if (screen === 'stock') return <StockScreen familyId={familyId} onClose={close} />;
  if (screen === 'nursery') return <HokatsuScreen onClose={close}>{hokatsuPanel}</HokatsuScreen>;
  if (screen === 'settings') {
    return (
      <SettingsScreen
        familyId={familyId}
        userId={userId}
        feedingSettings={feedingSettings}
        onChangeFeedingSettings={onChangeFeedingSettings}
        temperatureReminderSettings={temperatureReminderSettings}
        onChangeTemperatureReminderSettings={onChangeTemperatureReminderSettings}
        onClose={close}
      />
    );
  }

  return (
    <div className="px-4 pt-3 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 pb-6">
          <h2 className="px-0.5 text-[21px] font-extrabold text-gray-900">その他</h2>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-200">
            <LotteryMoreRow familyId={familyId} userId={userId} onOpen={() => setScreen('lottery')} />
            <ContractMoreRow familyId={familyId} onOpen={() => setScreen('contracts')} />
            <StockEntryRow familyId={familyId} onOpen={() => setScreen('stock')} />
            <MoreRow
              icon={<ClipboardCheck size={20} className="text-pink-500" />}
              tintClass="bg-pink-50"
              title="保活"
              description="見学チェックリスト"
              onClick={() => setScreen('nursery')}
            />
            <MoreRow
              icon={<Settings size={20} className="text-gray-700" />}
              tintClass="bg-gray-100"
              title="設定"
              description="家族・通知・授乳の目安・アカウント"
              onClick={() => setScreen('settings')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
