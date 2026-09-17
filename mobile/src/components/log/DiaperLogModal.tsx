import { useState } from 'react';
import { Modal } from 'react-native';
import type { DiaperKind, DiaperLog, PoopColor, PoopConsistency } from '@/types/app';
import { DIAPER_KIND_OPTIONS } from '@/lib/careLogUtils';
import { DeleteButton, FieldLabel, NoteField, Segmented, SubmitButton } from '@/components/ui/form';
import DateTimeField from '@/components/ui/DateTimeField';
import LogModalShell from '@/components/log/LogModalShell';

// おむつの記録。PWA版の `src/components/sukusuku/modals/DiaperLogModal.tsx` を
// React Nativeに置き換えたもの。入力の順序・既定値・保存する中身は同じにしてある。
//
// 入れるのは種類・日時・メモだけ（docs/what-to-record.md §7-1）。
// うんちの色（6択）とかたさ（3択）は入力から外してある。実データでは色を51件すべてで
// 選んでいたのに「気になる色」は0件、かたさも9割が既定値のままで、押した回数のわりに
// 判断が変わったことが無かった（§11-1・§11-2）。気になったときはメモ欄に書く。
//
// すでに保存されている色・かたさは消さない。編集して保存し直しても、そのまま持ち回す。

export interface DiaperLogInput {
  kind: DiaperKind;
  poopColor?: PoopColor;
  poopConsistency?: PoopConsistency;
  time: Date;
  note: string;
}

interface DiaperLogModalProps {
  /** 編集する記録。新規追加なら null。 */
  log: DiaperLog | null;
  /** 新規追加時に記録する日。過去の日を表示中でもその日に登録する。 */
  baseDate: Date;
  onClose: () => void;
  onSubmit: (input: DiaperLogInput) => void;
  onDelete: () => void;
}

const KIND_OPTIONS = DIAPER_KIND_OPTIONS.map(({ value, label }) => ({ value, label }));

/** 開くたびに入力内容を作り直したいので、閉じている間は中身ごと外す。 */
export default function DiaperLogModal({
  show,
  ...props
}: DiaperLogModalProps & { show: boolean }) {
  return (
    <Modal visible={show} animationType="slide" onRequestClose={props.onClose}>
      {show ? <DiaperLogModalBody {...props} /> : null}
    </Modal>
  );
}

function DiaperLogModalBody({
  log,
  baseDate,
  onClose,
  onSubmit,
  onDelete,
}: DiaperLogModalProps) {
  const [kind, setKind] = useState<DiaperKind>(log?.kind ?? 'pee');
  // 新規は表示中の日 + 今の時刻。編集は保存されている日時をそのまま出す。
  const [time, setTime] = useState(() => {
    if (log) return log.time;
    const now = new Date();
    const at = new Date(baseDate);
    at.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return at;
  });
  const [note, setNote] = useState(log?.note ?? '');

  const hasPoop = DIAPER_KIND_OPTIONS.find((option) => option.value === kind)?.hasPoop ?? false;

  const handleSubmit = () => {
    onSubmit({
      kind,
      // おしっこだけのときは、うんちの項目を持たせない。
      poopColor: hasPoop ? log?.poopColor : undefined,
      poopConsistency: hasPoop ? log?.poopConsistency : undefined,
      time,
      note,
    });
  };

  return (
    <LogModalShell
      title={log ? 'おむつの記録を編集' : 'おむつを記録'}
      onClose={onClose}
      // おしっこ/うんちの切り替えは、選び直したときに動かないよう上に固定しておく。
      subheader={
        <>
          <FieldLabel>種類</FieldLabel>
          <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />
        </>
      }
      footer={
        <>
          <SubmitButton accent="diaper" onPress={handleSubmit}>
            保存する
          </SubmitButton>
          {log && <DeleteButton onPress={onDelete} />}
        </>
      }
    >
      <DateTimeField label="日時" value={time} onChange={setTime} maximumDate={new Date()} />
      <NoteField value={note} onChange={setNote} placeholder="色が気になる / ゆるめ など" />
    </LogModalShell>
  );
}
