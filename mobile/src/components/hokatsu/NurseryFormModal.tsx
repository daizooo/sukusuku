import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Trash2, X } from 'lucide-react-native';
import type { Nursery, NurseryStatus } from '@/types/app';
import { formatDateWithWeekday, parseDateString, parseTimeInput, toDateString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import SelectField from '@/components/ui/SelectField';
import SheetModal from '@/components/ui/SheetModal';

// 園の情報（連絡先・見学の日時・メモ）を編集する。Web版の
// `src/components/sukusuku/modals/NurseryFormModal.tsx` を置き換えたもの。
//
// 見学チェックリストは保活タブの「チェックリスト」側でその場で編集するため、ここでは触らない
// （checklistは編集せずそのまま持ち回り、保存時に元の状態を書き戻す）。

export type NurseryDraft = Omit<Nursery, 'id'>;

const EMPTY_DRAFT: NurseryDraft = {
  name: '',
  address: '',
  status: '未見学',
  phone: '',
  visitDate: null,
  visitTime: null,
  memo: '',
  checklist: {},
};

const STATUSES: NurseryStatus[] = ['未見学', '見学予約済', '見学済'];

interface NurseryFormModalProps {
  mode: 'add' | 'edit' | null;
  nursery: Nursery | null;
  onClose: () => void;
  onSubmit: (draft: NurseryDraft) => void;
  onDelete?: (id: string) => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// 呼び出し側で対象が変わるたびに作り直す前提（初期値をそのとき計算するため）。
export default function NurseryFormModal({
  mode,
  nursery,
  onClose,
  onSubmit,
  onDelete,
}: NurseryFormModalProps) {
  const [draft, setDraft] = useState<NurseryDraft>(() =>
    mode === 'edit' && nursery
      ? {
          name: nursery.name,
          address: nursery.address,
          status: nursery.status,
          phone: nursery.phone,
          visitDate: nursery.visitDate,
          visitTime: nursery.visitTime,
          memo: nursery.memo,
          checklist: nursery.checklist,
        }
      : EMPTY_DRAFT,
  );

  const set = (patch: Partial<NurseryDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const visitDate = parseDateString(draft.visitDate ?? '');

  // 見学の日時は <input type="date"/"time"> が無いので端末のピッカーで選ぶ。
  const openDatePicker = () =>
    DateTimePickerAndroid.open({
      value: visitDate ?? new Date(),
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) set({ visitDate: toDateString(picked) });
      },
    });

  const openTimePicker = () =>
    DateTimePickerAndroid.open({
      value: parseTimeInput(draft.visitTime ?? '10:00'),
      mode: 'time',
      is24Hour: true,
      onChange: (_event, picked) => {
        if (!picked) return;
        set({
          visitTime: `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`,
        });
      },
    });

  return (
    <SheetModal visible={mode !== null} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {mode === 'add' ? '保育園を追加' : draft.name || '保育園を編集'}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="閉じる" onPress={onClose} hitSlop={12}>
          <X size={20} color={colors.textFaint} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <SectionTitle>園の情報</SectionTitle>
          <View style={styles.fields}>
            <View>
              <Text style={styles.label}>
                園名 <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={draft.name}
                onChangeText={(name) => set({ name })}
                placeholder="例: 舞原保育園"
                placeholderTextColor={colors.textFaint}
              />
            </View>
            <View>
              <Text style={styles.label}>住所</Text>
              <TextInput
                style={styles.input}
                value={draft.address}
                onChangeText={(address) => set({ address })}
                placeholder="例: 熊本市南区城南町舞原291-7"
                placeholderTextColor={colors.textFaint}
              />
            </View>
            <View>
              <Text style={styles.label}>電話番号</Text>
              <TextInput
                style={styles.input}
                value={draft.phone}
                onChangeText={(phone) => set({ phone })}
                keyboardType="phone-pad"
                placeholder="例: 0964-28-2121"
                placeholderTextColor={colors.textFaint}
              />
            </View>
            <View>
              <Text style={styles.label}>状況</Text>
              <SelectField
                accessibilityLabel="状況"
                options={STATUSES.map((status) => ({ value: status, label: status }))}
                value={draft.status}
                onChange={(status) => set({ status })}
                style={styles.select}
                textStyle={styles.selectText}
              />
            </View>
          </View>
        </View>

        <View>
          <SectionTitle>見学の日時</SectionTitle>
          <View style={styles.visitRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="見学の日付"
              onPress={openDatePicker}
              style={[styles.input, styles.flex]}
            >
              <Text style={visitDate ? styles.value : styles.placeholder}>
                {visitDate ? formatDateWithWeekday(visitDate) : '日付を選ぶ'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="見学の時刻"
              onPress={openTimePicker}
              style={[styles.input, styles.timeField]}
            >
              <Text style={draft.visitTime ? styles.value : styles.placeholder}>
                {draft.visitTime ?? '時刻'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            日時が決まったら、状況も「見学予約済」に変えておきましょう。
          </Text>
        </View>

        <View>
          <SectionTitle>その他のメモ</SectionTitle>
          <TextInput
            style={[styles.input, styles.memo]}
            value={draft.memo}
            onChangeText={(memo) => set({ memo })}
            placeholder="申請時期、園の雰囲気、夫婦で相談したいことなど"
            placeholderTextColor={colors.textFaint}
            multiline
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={draft.name === ''}
          onPress={() => onSubmit(draft)}
          style={[styles.submit, draft.name === '' && styles.submitDisabled]}
        >
          <Text style={styles.submitText}>{mode === 'add' ? '追加する' : '保存する'}</Text>
        </Pressable>
        {mode === 'edit' && nursery && onDelete && (
          <Pressable
            accessibilityRole="button"
            onPress={() => onDelete(nursery.id)}
            style={styles.deleteButton}
          >
            <Trash2 size={14} color={colors.danger} />
            <Text style={styles.deleteText}>削除する</Text>
          </Pressable>
        )}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  // 中身が多いときだけ縮めてスクロールさせる（flex: 1 にすると中身が少なくても枠が伸びる）。
  scroll: { flexShrink: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  content: { paddingHorizontal: 20, paddingVertical: 16, gap: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 8 },
  fields: { gap: 12 },
  label: { fontSize: 12, fontWeight: '500', color: colors.textSubtle, marginBottom: 4 },
  required: { color: colors.danger },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.textSubtle,
    backgroundColor: colors.surface,
  },
  value: { fontSize: 14, color: colors.textSubtle, fontWeight: '500' },
  placeholder: { fontSize: 14, color: colors.textFaint },
  select: { borderColor: colors.borderStrong, borderRadius: 8, minHeight: 40 },
  selectText: { flex: 1, fontWeight: '400', fontSize: 14 },
  visitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeField: { width: 96, alignItems: 'center' },
  hint: { fontSize: 10, color: colors.textFaint, marginTop: 6 },
  memo: { minHeight: 80, textAlignVertical: 'top' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submit: {
    backgroundColor: colors.navActive,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitDisabled: { backgroundColor: colors.borderStrong },
  submitText: { fontSize: 15, fontWeight: '500', color: colors.primaryText },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    marginTop: 4,
  },
  deleteText: { fontSize: 12, fontWeight: '500', color: colors.danger },
});
