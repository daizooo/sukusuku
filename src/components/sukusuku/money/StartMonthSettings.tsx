'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMonthKey, monthKeyOfDate, shiftMonth } from '@/lib/moneyUtils';
import { saveMoneyStartMonth } from '@/lib/api/money';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 集計の開始月の設定（docs/kakei.md §0.4）。mobile版の `mobile/src/components/money/StartMonthSettings.tsx` と同じ並び・文言。
// 年の振り返りと、年初からの累計は、この月以降の記録のある月だけを数える。それより前の月は、月の画面では見られる。

interface StartMonthSettingsProps {
  familyId: string;
  /** いまの開始月（YYYY-MM）。null は全部の月を数える。 */
  startMonth: string | null;
  onSaved: (startMonth: string | null) => void;
  onBack: () => void;
}

const choiceClass = (selected: boolean) =>
  `flex-1 rounded-xl border py-2.5 text-sm ${
    selected ? 'border-blue-100 bg-blue-100 font-bold text-blue-800' : 'border-gray-200 bg-white font-semibold text-gray-700'
  }`;

export default function StartMonthSettings({ familyId, startMonth, onSaved, onBack }: StartMonthSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [enabled, setEnabled] = useState(startMonth !== null);
  const [month, setMonth] = useState(startMonth ?? monthKeyOfDate(new Date()));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const value = enabled ? month : null;
      await saveMoneyStartMonth(supabase, familyId, value);
      onSaved(value);
      onBack();
    } catch {
      window.alert('保存できませんでした。もう一度お試しください。');
      setSaving(false);
    }
  };

  return (
    <StackedScreen onBack={onBack}>
      <ScreenHeader title="集計の開始月" icon="back" onClose={onBack} />
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4">
        <p className="text-[13px] leading-relaxed text-gray-500">
          年の振り返りと、年初からの累計は、この月以降の記録のある月だけを数えます。それより前の月は、月の振り返りでは見られますが、年と累計には入りません。
        </p>
        <div className="flex gap-2" role="radiogroup">
          <button type="button" role="radio" aria-checked={enabled} onClick={() => setEnabled(true)} className={choiceClass(enabled)}>
            月を決める
          </button>
          <button type="button" role="radio" aria-checked={!enabled} onClick={() => setEnabled(false)} className={choiceClass(!enabled)}>
            すべての月を数える
          </button>
        </div>
        {enabled && (
          <div className="flex items-center justify-center gap-6 py-2">
            <button type="button" aria-label="前の月" onClick={() => setMonth(shiftMonth(month, -1))} className="text-gray-700">
              <ChevronLeft size={26} />
            </button>
            <span className="min-w-[140px] text-center text-[22px] font-extrabold text-gray-900 tabular-nums">
              {formatMonthKey(month)}
            </span>
            <button type="button" aria-label="次の月" onClick={() => setMonth(shiftMonth(month, 1))} className="text-gray-700">
              <ChevronRight size={26} />
            </button>
          </div>
        )}
      </div>
      <div className="shrink-0 p-4">
        <PrimaryButton label={saving ? '保存しています' : '保存する'} onClick={() => void save()} disabled={saving} />
      </div>
    </StackedScreen>
  );
}
