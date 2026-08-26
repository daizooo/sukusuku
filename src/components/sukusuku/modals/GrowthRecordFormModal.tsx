'use client';

import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { GrowthRecord } from '@/types/app';
import { formatDateString, monthsSinceBirth, parseDateString, toDateString } from '@/lib/dateUtils';
import {
  MAX_HEIGHT_CM,
  MAX_MONTH_AGE,
  maxWeightFor,
  round2,
  toWeightKg,
  validateGrowthRecordForm,
  type GrowthRecordDraft,
  type WeightUnit,
} from '@/lib/growthRecordInput';

interface FormState {
  recordedDate: string;
  // null は「誕生日から自動計算」の状態。ユーザーが触ると文字列になる。
  monthAge: string | null;
  height: string;
  weight: string;
  weightUnit: WeightUnit;
}

const initialState = (mode: 'add' | 'edit' | null, record: GrowthRecord | null): FormState => {
  if (mode === 'edit' && record) {
    return {
      recordedDate: record.recordedDate,
      // 生後ヶ月が未入力のままの記録は、開いたときに自動計算で補えるよう null にしておく
      monthAge: record.month !== null ? String(record.month) : null,
      height: record.height !== null ? String(record.height) : '',
      weight: record.weight !== null ? String(record.weight) : '',
      weightUnit: 'kg',
    };
  }
  return { recordedDate: toDateString(new Date()), monthAge: null, height: '', weight: '', weightUnit: 'kg' };
};

interface GrowthRecordFormModalProps {
  mode: 'add' | 'edit' | null;
  record: GrowthRecord | null;
  // プロフィールに登録された子の誕生日（'YYYY-MM-DD'）。未設定なら空文字。
  birthDate?: string;
  onClose: () => void;
  onSubmit: (draft: GrowthRecordDraft) => void;
  onDelete?: (id: string) => void;
}

// 呼び出し側で key={mode + record?.id} を指定し、対象が変わるたびに再マウントして初期値を計算し直す前提
export default function GrowthRecordFormModal({
  mode,
  record,
  birthDate = '',
  onClose,
  onSubmit,
  onDelete,
}: GrowthRecordFormModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(mode, record));
  const [error, setError] = useState<string | null>(null);

  if (!mode) return null;

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  // 生後ヶ月は誕生日と記録日から自動で埋める。ユーザーが自分で入力したらそちらを優先する。
  const autoMonthAge = birthDate ? monthsSinceBirth(birthDate, form.recordedDate) : null;
  const isMonthAgeAuto = form.monthAge === null && autoMonthAge !== null;
  const monthAgeValue = form.monthAge ?? (autoMonthAge !== null ? String(autoMonthAge) : '');

  const weightMax = maxWeightFor(form.weightUnit);
  const weightInKg = toWeightKg(form.weight, form.weightUnit);

  // 単位を切り替えたら入力済みの数値も換算する。
  // 「3.2」と入れたあとにgへ切り替えて3.2gとして保存されてしまうのを防ぐ。
  const changeWeightUnit = (unit: WeightUnit) => {
    if (unit === form.weightUnit) return;
    const parsed = Number(form.weight);
    const converted =
      form.weight.trim() === '' || !Number.isFinite(parsed)
        ? form.weight
        : String(round2(unit === 'g' ? parsed * 1000 : parsed / 1000));
    update({ weightUnit: unit, weight: converted });
  };

  const handleSubmit = () => {
    const result = validateGrowthRecordForm({
      recordedDate: form.recordedDate,
      monthAge: monthAgeValue,
      height: form.height,
      weight: form.weight,
      weightUnit: form.weightUnit,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSubmit(result.draft);
  };

  const unitButtonClass = (unit: WeightUnit) =>
    `flex-1 py-1 text-[11px] font-bold rounded-md transition ${
      form.weightUnit === unit ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
    }`;

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h3 className="font-bold text-gray-800">{mode === 'add' ? '身長・体重を記録' : '記録を編集'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">記録日</label>
            <input
              type="date"
              value={form.recordedDate}
              onChange={(e) => update({ recordedDate: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
            />
            {form.recordedDate && (
              <p className="text-[10px] text-gray-400 mt-1">
                {formatDateString(parseDateString(form.recordedDate))}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">生後ヶ月</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_MONTH_AGE}
              value={monthAgeValue}
              onChange={(e) => update({ monthAge: e.target.value })}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
              placeholder="例: 1"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              {isMonthAgeAuto
                ? '誕生日と記録日から自動で計算しています。変更もできます。'
                : 'グラフの横軸に使います。未入力の場合は記録日で並びます。'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">身長 (cm)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                max={MAX_HEIGHT_CM}
                value={form.height}
                onChange={(e) => update({ height: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
                placeholder="例: 50.2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">体重</label>
              <input
                type="number"
                inputMode="decimal"
                step={form.weightUnit === 'kg' ? '0.01' : '1'}
                min={0}
                max={weightMax}
                value={form.weight}
                onChange={(e) => update({ weight: e.target.value })}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none"
                placeholder={form.weightUnit === 'kg' ? '例: 3.2' : '例: 3200'}
              />
              <div className="flex bg-gray-200 p-0.5 rounded-lg mt-1.5" role="group" aria-label="体重の単位">
                {(['kg', 'g'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    aria-pressed={form.weightUnit === unit}
                    onClick={() => changeWeightUnit(unit)}
                    className={unitButtonClass(unit)}
                  >
                    {unit}
                  </button>
                ))}
              </div>
              {form.weightUnit === 'g' && weightInKg !== null && (
                <p className="text-[10px] text-gray-400 mt-1">= {weightInKg}kg として保存します</p>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
              {error}
            </p>
          )}

          <button
            onClick={handleSubmit}
            className="w-full bg-blue-500 text-white font-medium py-3 rounded-xl mt-4 shadow-sm active:bg-blue-600 transition"
          >
            {mode === 'add' ? '追加する' : '保存する'}
          </button>
          {mode === 'edit' && record && onDelete && (
            <button
              onClick={() => onDelete(record.id)}
              className="w-full flex items-center justify-center text-xs text-red-500 font-medium py-2"
            >
              <Trash2 size={14} className="mr-1" /> 削除する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
