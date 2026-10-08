'use client';

import { useState } from 'react';
import type { MoneyHolding, MoneyHoldingAccount, MoneySecurity, MoneySecurityDraft, MoneySecurityKind } from '@/types/app';
import { HOLDING_ACCOUNTS, SECURITY_KINDS } from '@/lib/moneyUtils';
import { ModalShell } from '../modals/TaskForm';
import { PrimaryButton } from './moneyVisual';

// 銘柄の追加・編集（docs/kakei.md §9.2.4）。mobile版の `mobile/src/components/money/SecuritySheet.tsx` と同じ項目・文言。
// 種類（米国株・投資信託・預り金）・名前・コード、預り区分ごとの保有数と取得単価（円）。
// 保有数を空・0 にした区分は使わなくする。価格はサーバーが取る（足したときに過去1年分も）。

interface SecuritySheetProps {
  security: MoneySecurity | null;
  /** この口座での保有（編集のとき、預り区分ごとの今の値を出す）。 */
  holdings: MoneyHolding[];
  onClose: () => void;
  onSubmit: (draft: MoneySecurityDraft) => void;
  onArchive?: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';
const chipClass = (selected: boolean) =>
  `rounded-full px-3 py-1.5 text-[13px] font-semibold ${selected ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`;

const parseNumber = (text: string): number | null => {
  const value = Number(text.replace(/,/g, '').trim());
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? value : null;
};

export default function SecuritySheet({ security, holdings, onClose, onSubmit, onArchive }: SecuritySheetProps) {
  const [kind, setKind] = useState<MoneySecurityKind>(security?.kind ?? 'us_stock');
  const [name, setName] = useState(security?.name ?? '');
  const [code, setCode] = useState(security?.code ?? '');
  const [fundCode, setFundCode] = useState(security?.fundCode ?? '');
  const [currency, setCurrency] = useState<'JPY' | 'USD'>(security?.currency ?? 'USD');
  const initial = (account: MoneyHoldingAccount) => holdings.find((holding) => holding.account === account && !holding.archived);
  const [quantities, setQuantities] = useState<Record<MoneyHoldingAccount, string>>(
    () =>
      Object.fromEntries(
        HOLDING_ACCOUNTS.map((entry) => [entry.id, initial(entry.id) ? String(initial(entry.id)?.quantity) : '']),
      ) as Record<MoneyHoldingAccount, string>,
  );
  const [costs, setCosts] = useState<Record<MoneyHoldingAccount, string>>(
    () =>
      Object.fromEntries(
        HOLDING_ACCOUNTS.map((entry) => {
          const cost = initial(entry.id)?.costPrice;
          return [entry.id, cost === null || cost === undefined ? '' : String(cost)];
        }),
      ) as Record<MoneyHoldingAccount, string>,
  );
  const [error, setError] = useState<string | null>(null);

  const chooseKind = (next: MoneySecurityKind) => {
    setKind(next);
    if (next === 'us_stock') setCurrency('USD');
    if (next === 'jp_fund') setCurrency('JPY');
  };

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    if (kind === 'us_stock' && code.trim() === '') return setError('ティッカーを入れてください');
    if (kind === 'jp_fund' && (code.trim() === '' || fundCode.trim() === '')) {
      return setError('ISINコードと協会コードを入れてください');
    }
    const entries: MoneySecurityDraft['holdings'] = [];
    for (const entry of HOLDING_ACCOUNTS) {
      const quantityText = quantities[entry.id];
      const costText = costs[entry.id];
      const quantity = quantityText.trim() === '' ? 0 : parseNumber(quantityText);
      const costPrice = costText.trim() === '' ? null : parseNumber(costText);
      if (quantity === null || (costText.trim() !== '' && costPrice === null)) {
        return setError('保有数・取得単価は数字で入れてください');
      }
      entries.push({ account: entry.id, quantity, costPrice });
    }
    if (entries.every((entry) => entry.quantity === 0) && security === null) return setError('保有数を入れてください');
    onSubmit({
      name: name.trim(),
      kind,
      code: kind === 'cash' ? null : code.trim().toUpperCase(),
      fundCode: kind === 'jp_fund' ? fundCode.trim().toUpperCase() : null,
      currency,
      holdings: entries,
    });
  };

  const archive = () => {
    if (window.confirm(`${security?.name ?? ''}を一覧から外しますか？売ったときに。これまでの評価額の推移は残ります。`)) onArchive?.();
  };

  const accounts = kind === 'cash' ? HOLDING_ACCOUNTS.filter((entry) => entry.id === 'tokutei') : HOLDING_ACCOUNTS;

  return (
    <ModalShell
      title={security ? '銘柄を編集' : '銘柄を足す'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="保存する" onClick={submit} />
          {onArchive && (
            <button type="button" onClick={archive} className="w-full py-2 text-sm text-red-500">
              一覧から外す
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <span className={labelClass}>種類</span>
          <div className="flex flex-wrap gap-2">
            {SECURITY_KINDS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={kind === entry.id}
                onClick={() => chooseKind(entry.id)}
                className={chipClass(kind === entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={labelClass}>名前</span>
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {kind === 'us_stock' && (
          <label className="block">
            <span className={labelClass}>ティッカー</span>
            <input
              className={inputClass}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              placeholder="例: VTI"
            />
          </label>
        )}
        {kind === 'jp_fund' && (
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className={labelClass}>ISINコード</span>
              <input
                className={inputClass}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoCapitalize="characters"
                autoCorrect="off"
                placeholder="JP90C000…"
              />
            </label>
            <label className="block flex-1">
              <span className={labelClass}>協会コード</span>
              <input
                className={inputClass}
                value={fundCode}
                onChange={(event) => setFundCode(event.target.value)}
                autoCapitalize="characters"
                autoCorrect="off"
              />
            </label>
          </div>
        )}
        {kind === 'cash' && (
          <div>
            <span className={labelClass}>通貨</span>
            <div className="flex flex-wrap gap-2">
              {(['USD', 'JPY'] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={currency === entry}
                  onClick={() => setCurrency(entry)}
                  className={chipClass(currency === entry)}
                >
                  {entry === 'USD' ? '米ドル' : '円'}
                </button>
              ))}
            </div>
          </div>
        )}
        {kind !== 'cash' && (
          <div className="flex gap-3 border-t border-gray-200 pt-3">
            <span className="flex-1 text-xs font-bold text-gray-700">{kind === 'jp_fund' ? '口数' : '株数'}</span>
            <span className="flex-1 text-xs font-bold text-gray-700">
              {kind === 'jp_fund' ? '取得単価（1万口）' : '取得単価（円）'}
            </span>
          </div>
        )}
        {accounts.map((entry) => (
          <div key={entry.id}>
            {kind !== 'cash' && <span className="mb-1.5 block text-xs font-medium text-gray-500">{entry.label}</span>}
            <div className="flex gap-3">
              <input
                className={inputClass}
                value={quantities[entry.id]}
                onChange={(event) => setQuantities((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                inputMode="decimal"
                aria-label={kind === 'cash' ? '額' : `${entry.label}の${kind === 'jp_fund' ? '口数' : '株数'}`}
                placeholder={kind === 'cash' ? '額' : undefined}
              />
              {kind !== 'cash' && (
                <input
                  className={inputClass}
                  value={costs[entry.id]}
                  onChange={(event) => setCosts((prev) => ({ ...prev, [entry.id]: event.target.value }))}
                  inputMode="decimal"
                  aria-label={`${entry.label}の取得単価`}
                />
              )}
            </div>
          </div>
        ))}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
