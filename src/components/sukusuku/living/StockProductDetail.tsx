'use client';

import { Pencil } from 'lucide-react';
import type { StockItem, StockTarget } from '@/types/app';
import {
  daysBetween,
  expiryCountdown,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  nextInspectionOn,
  spanText,
  storageShares,
  unitPriceOf,
  type StockPlan,
  type StockProduct,
  type StockStorage,
  type StorageShare,
} from '@/lib/stockUtils';
import { ModalShell } from '../modals/TaskForm';

// 品目1つの詳しい画面（docs/home.md §10.2.2）。mobile版の
// `mobile/src/components/living/StockProductDetail.tsx` と同じ項目・文言。
// 上に全体の数と、その中の寝室・持ち出し用の内訳（帯と1行ずつ。足りない場所は赤）。
// 下にロットを保管場所ごとに並べる。ロットを押すと編集（持ち出し用へ分ける・寝室へ戻すも、そこで行う）。
// 期限の無い備品のロットは、期限の代わりに点検した日・次の点検を出す。

interface StockProductDetailProps {
  product: StockProduct<StockItem, StockTarget>;
  plan: StockPlan;
  today: string;
  onClose: () => void;
  onEditTarget: (target: StockTarget) => void;
  onEditItem: (item: StockItem) => void;
}

const LEVEL_TEXT = { expired: 'text-red-700', soon: 'text-red-700', year: 'text-gray-600', ok: 'text-gray-500', none: 'text-gray-400' };

const PLACES: { storage: StockStorage; label: string; fill: string }[] = [
  { storage: 'home', label: '寝室', fill: 'bg-gray-200 text-gray-700' },
  { storage: 'carry', label: '持ち出し用', fill: 'bg-orange-100 text-orange-800' },
];

/** 帯の片側が細くなりすぎないように、最小の幅（%）。 */
const MIN_ZONE = 18;
/** 塗った部分がこれより細い（%）ときは、帯の中に数を出さない（下の行に出ている）。 */
const LABEL_MIN = 8;

const dateText = (on: string) => formatExpiry({ expiresOn: on, expiresMonthOnly: false });

export default function StockProductDetail({
  product,
  plan,
  today,
  onClose,
  onEditTarget,
  onEditItem,
}: StockProductDetailProps) {
  const status = product.target?.status ?? null;
  const cost = product.target?.cost ?? null;
  const unit = product.unit;
  const shares = storageShares(product, today);
  const q = (value: number) => `${formatQuantity(value)}${unit}`;

  // 帯: 寝室・持ち出し用を、それぞれ要る量（無ければ持っている量）の幅で並べる。
  const weight = (share: StorageShare) => Math.max(share.required ?? 0, share.have);
  const zones = PLACES.filter(({ storage }) => weight(shares[storage]) > 0);
  const weightSum = zones.reduce((sum, { storage }) => sum + weight(shares[storage]), 0);
  const zoneWidth = (storage: StockStorage) => {
    if (zones.length < 2) return 100;
    const raw = (weight(shares[storage]) / weightSum) * 100;
    return Math.min(100 - MIN_ZONE, Math.max(MIN_ZONE, raw));
  };

  const shareNote = (storage: StockStorage) => {
    const share = shares[storage];
    if (share.required === null) return null;
    if (share.shortage > 0) return { text: `あと ${q(share.shortage)}`, alert: true };
    const other = shares[storage === 'home' ? 'carry' : 'home'];
    if (share.surplus > 0 && other.shortage > 0) return { text: `${q(share.surplus)}多い（分けられます）`, alert: false };
    return share.required > 0 ? { text: '揃っています', alert: false } : null;
  };

  const facts: [string, string][] =
    status && cost
      ? [
          [`${plan.days}日分の費用`, cost.total === null ? '値段未登録' : formatYen(cost.total)],
          ['買い足し', cost.shortageCost === null ? '—' : status.shortage > 0 ? formatYen(cost.shortageCost) : '不要'],
          [`1${unit}あたり`, cost.unitPrice === null ? '—' : formatYen(cost.unitPrice)],
        ]
      : [];

  // ロットの1行。期限の無い備品は、期限の代わりに点検した日・次の点検。
  const lotRow = (item: StockItem) => {
    const level = expiryLevel(item.expiresOn, today);
    const next = nextInspectionOn(item);
    const due = next !== null && next <= today;
    const perUnit = unitPriceOf(item);
    const main = item.expiresOn
      ? `${formatExpiry(item)} まで`
      : next !== null
        ? item.inspectedOn
          ? `${dateText(item.inspectedOn)} に点検`
          : 'まだ点検していません'
        : '期限なし';
    const sub = item.expiresOn
      ? { text: expiryCountdown(item.expiresOn, today), className: LEVEL_TEXT[level] }
      : next !== null
        ? due
          ? { text: '点検の時期です', className: 'text-red-700' }
          : { text: `次は ${dateText(next)} ごろ・あと${spanText(daysBetween(today, next))}`, className: 'text-gray-500' }
        : null;
    const extra = [
      item.name !== product.name ? item.name : '',
      item.price !== null
        ? `${formatYen(item.price)}/${item.unit || '個'}${
            perUnit !== null && status && (item.unit !== status.target.unit || item.amountPerUnit !== 1)
              ? `（${formatYen(perUnit)}/${status.target.unit}）`
              : ''
          }`
        : '',
    ]
      .filter(Boolean)
      .join('・');
    return (
      <li key={item.id}>
        <button
          type="button"
          aria-label={`${item.name}を編集`}
          onClick={() => onEditItem(item)}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-gray-50"
        >
          <span className="min-w-0 flex-1 leading-tight tabular-nums">
            <span className="block text-[13px] font-bold text-gray-900">{main}</span>
            {sub && <span className={`block text-[11px] font-bold ${sub.className}`}>{sub.text}</span>}
            {extra !== '' && <span className="block text-[10px] font-medium text-gray-400">{extra}</span>}
          </span>
          <span className="shrink-0 text-sm font-bold text-gray-900 tabular-nums">
            {formatQuantity(item.quantity)}
            {item.unit}
          </span>
          <Pencil size={13} className="shrink-0 text-gray-400" />
        </button>
      </li>
    );
  };

  return (
    <ModalShell
      title={product.name}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={() => (status ? onEditTarget(status.target) : onClose())}
          className="w-full py-3 rounded-xl bg-gray-100 text-sm font-bold text-gray-700 hover:bg-gray-200"
        >
          {status ? '必要数を直す' : '閉じる'}
        </button>
      }
    >
      <div className="space-y-3">
        <section className="space-y-2 rounded-2xl bg-gray-100 px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-bold text-gray-500">全体</span>
            <span className="text-[28px] font-bold leading-none text-gray-900 tabular-nums">
              {formatQuantity(product.total)}
              <span className="ml-1 text-[13px] text-gray-400">{unit}</span>
            </span>
            <span
              className={`flex-1 text-right text-[11px] font-bold tabular-nums ${
                status && status.shortage > 0 ? 'text-red-700' : 'text-gray-400'
              }`}
            >
              {status
                ? `必要 ${formatQuantity(status.required)}${status.shortage > 0 ? `・あと ${formatQuantity(status.shortage)}` : ''}`
                : '必要数なし'}
            </span>
          </div>

          {zones.length > 0 && (
            <div className="flex h-[22px] gap-[3px]">
              {zones.map(({ storage, fill }) => {
                const share = shares[storage];
                const ratio = share.required ? Math.min(1, share.have / share.required) : 1;
                return (
                  <div key={storage} className="flex h-full overflow-hidden rounded-[7px] bg-white" style={{ width: `${zoneWidth(storage)}%` }}>
                    {share.have > 0 && (
                      <div
                        className={`flex h-full items-center pl-[7px] text-[11px] font-bold tabular-nums whitespace-nowrap ${fill}`}
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      >
                        {zoneWidth(storage) * ratio >= LABEL_MIN && formatQuantity(share.have)}
                      </div>
                    )}
                    {ratio < 1 && <div className="h-full flex-1 bg-red-100" />}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-0.5">
            {PLACES.map(({ storage, label, fill }) => {
              const share = shares[storage];
              const note = shareNote(storage);
              return (
                <div key={storage} className="flex items-baseline gap-1 tabular-nums">
                  <span className={`h-[9px] w-[9px] shrink-0 self-center rounded-[3px] ${fill}`} />
                  <span className="ml-0.5 text-xs font-bold text-gray-700">{label}</span>
                  <span className="ml-1 text-sm font-bold text-gray-900">{formatQuantity(share.have)}</span>
                  <span className="text-[11px] font-bold text-gray-400">
                    {share.required ? ` / ${formatQuantity(share.required)}${unit}` : ` ${unit}`}
                  </span>
                  {note && (
                    <span className={`flex-1 text-right text-[11px] font-bold ${note.alert ? 'text-red-700' : 'text-gray-400'}`}>
                      {note.text}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {facts.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {facts.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-gray-100 px-2 py-1.5">
                <p className="text-[10px] font-bold text-gray-400">{label}</p>
                <p className="text-[13px] font-bold text-gray-900 tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        )}

        {product.lots.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">まだありません</p>
        ) : (
          PLACES.map(({ storage, label }) => {
            const lots = product.lots.filter((item) => item.storage === storage);
            if (lots.length === 0) return null;
            return (
              <section key={storage}>
                <h3 className="mb-1 flex items-baseline gap-1.5 px-0.5">
                  <span className="text-[13px] font-bold text-gray-900">{label}</span>
                  <span className="text-[11px] font-bold text-gray-400 tabular-nums">
                    {formatQuantity(shares[storage].have)}
                    {unit}
                  </span>
                </h3>
                <ul className="overflow-hidden rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">{lots.map(lotRow)}</ul>
              </section>
            );
          })
        )}
      </div>
    </ModalShell>
  );
}
