'use client';

import { useMemo, useState } from 'react';
import type { MoneyRatioTargets } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { saveMoneyRatioTargets } from '@/lib/api/money';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 目安の割合（docs/kakei.md §0.9。2026-10-24）。mobile版の `mobile/src/components/money/RatioTargetSettings.tsx` と同じ並び・文言。
// 支出の種類（変動費・予備費・固定費〔確定＋見込み〕）ごとに、収入に対する目安の割合（%）を決める。年の振り返りの見出しに
// 「11%（目安35%）」の形で出す。収支（残り）は 100% − 合計で、ここに出すだけ。合計が100%を超えると保存できない。
// 空にした種類は目安なし（振り返りに出さない）。

interface RatioTargetSettingsProps {
  familyId: string;
  targets: MoneyRatioTargets;
  onSaved: (targets: MoneyRatioTargets) => void;
  onBack: () => void;
}

const ROWS: { key: keyof MoneyRatioTargets; label: string }[] = [
  { key: 'variable', label: '変動費' },
  { key: 'reserve', label: '予備費' },
  { key: 'fixed', label: '固定費（確定・見込み）' },
];

/** 入力の文字を割合（0〜100 の整数）にする。空は null、読めない・範囲外は undefined。 */
function parsePercent(text: string): number | null | undefined {
  const value = text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace(/[%％\s]/g, '');
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return undefined;
  const percent = Number(value);
  return percent <= 100 ? percent : undefined;
}

export default function RatioTargetSettings({ familyId, targets, onSaved, onBack }: RatioTargetSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [texts, setTexts] = useState<Record<keyof MoneyRatioTargets, string>>({
    variable: targets.variable === null ? '' : String(targets.variable),
    reserve: targets.reserve === null ? '' : String(targets.reserve),
    fixed: targets.fixed === null ? '' : String(targets.fixed),
  });
  const [saving, setSaving] = useState(false);

  const parsed = ROWS.map((row) => parsePercent(texts[row.key]));
  const invalid = parsed.some((value) => value === undefined);
  const total = parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const over = total > 100;

  const save = async () => {
    if (invalid || over) return;
    const next: MoneyRatioTargets = { variable: parsed[0] ?? null, reserve: parsed[1] ?? null, fixed: parsed[2] ?? null };
    setSaving(true);
    try {
      await saveMoneyRatioTargets(supabase, familyId, next);
      onSaved(next);
      onBack();
    } catch {
      window.alert('保存できませんでした。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <StackedScreen onBack={onBack}>
      <ScreenHeader title="目安の割合" icon="back" onClose={onBack} />
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 p-4">
        <p className="text-[13px] font-medium text-gray-500">
          収入に対して、支出の種類ごとに何%までに収めたいか。年の振り返りで実績の割合と並べます。
        </p>
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {ROWS.map((row, index) => (
            <label key={row.key} className={`flex items-center gap-2 px-3.5 py-2.5 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
              <span className="flex-1 text-[15px] font-semibold text-gray-900">{row.label}</span>
              <input
                value={texts[row.key]}
                onChange={(event) => setTexts((prev) => ({ ...prev, [row.key]: event.target.value }))}
                inputMode="numeric"
                placeholder="−"
                maxLength={3}
                aria-label={`${row.label}の目安（%）`}
                className={`w-16 rounded-lg border px-2 py-1.5 text-right text-base font-bold tabular-nums text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  parsed[index] === undefined ? 'border-red-600' : 'border-gray-200'
                }`}
              />
              <span className="text-[15px] font-semibold text-gray-500">%</span>
            </label>
          ))}
          <div className="flex items-center gap-2 border-t border-gray-200 px-3.5 py-2.5">
            <span className="flex-1 text-[15px] font-semibold text-gray-500">収支（残り）</span>
            <span className={`text-base font-bold tabular-nums ${over ? 'text-red-600' : 'text-gray-500'}`}>{`${100 - total}%`}</span>
          </div>
        </div>
        {over && <p className="text-[13px] font-semibold text-red-600">合計が100%を超えています</p>}
        <PrimaryButton label={saving ? '保存しています…' : '保存'} onClick={() => void save()} disabled={saving || invalid || over} />
      </div>
    </StackedScreen>
  );
}
