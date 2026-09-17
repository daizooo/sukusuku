import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { NurseryCheckGrade } from '@/types/app';
import { NURSERY_CHECK_GRADES } from '@/lib/nurseryChecklist';
import { colors } from '@/lib/theme';

// 見学チェックリストの1項目。Web版の `tabs/HokatsuTab.tsx` の中にある
// CheckItemCard を置き換えたもの。
//
// メモは打つたびに保存すると重いので、入力中は手元で持ち、
// 入力を終えた（focusが外れた）ときにだけ保存する。
// 園を切り替えたときに前の園のメモが残らないよう、呼び出し側で key に園のidを含める。

// 選んだ評価の色。A(良い)は緑、B(ふつう)は青、C(気になる)は橙にして、
// あとから一覧を見たときに気になった園がすぐ分かるようにする。
const GRADE_COLOR: Record<NurseryCheckGrade, string> = {
  A: colors.gradeGood,
  B: colors.navActive,
  C: colors.gradeWatch,
};

interface CheckItemCardProps {
  number: number;
  title: string;
  point: string;
  /** この園だけで確認する項目のときの園名（例: '和光のみ'） */
  targetLabel?: string;
  /** チェックの代わりにA/B/Cで評価する項目か */
  graded?: boolean;
  grade?: NurseryCheckGrade;
  checked: boolean;
  memo: string;
  onToggle: () => void;
  /** 同じ評価をもう一度押したら選び直せるよう、undefinedも渡ってくる */
  onSelectGrade: (grade: NurseryCheckGrade | undefined) => void;
  onCommitMemo: (memo: string) => void;
}

export default function CheckItemCard({
  number,
  title,
  point,
  targetLabel,
  graded,
  grade,
  checked,
  memo,
  onToggle,
  onSelectGrade,
  onCommitMemo,
}: CheckItemCardProps) {
  const [draftMemo, setDraftMemo] = useState(memo);

  return (
    <View
      style={[
        styles.card,
        // 評価する項目は選んだボタンの色で済んでいるので、カードは塗り分けない。
        // A(良い)もC(気になる)も同じ緑になると、評価の中身が読み取れなくなるため。
        !graded && checked && styles.cardChecked,
      ]}
    >
      {graded ? (
        // 評価する項目はチェックボックスを出さず、A/B/Cのボタン自体をチェックとして扱う。
        <View>
          <Text style={styles.title}>
            <Text style={styles.number}>{number}. </Text>
            {title}
          </Text>
          <Text style={styles.point}>{point}</Text>
          <View style={styles.grades}>
            {NURSERY_CHECK_GRADES.map(({ id, label }) => {
              const selected = grade === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelectGrade(selected ? undefined : id)}
                  style={[
                    styles.grade,
                    selected && { backgroundColor: GRADE_COLOR[id], borderColor: GRADE_COLOR[id] },
                  ]}
                >
                  <Text style={[styles.gradeId, selected && styles.gradeSelectedText]}>
                    {id}
                    <Text style={styles.gradeLabel}> {label}</Text>
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={onToggle} style={styles.checkRow}>
          <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
            <Check size={14} strokeWidth={3} color={checked ? colors.primaryText : 'transparent'} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.title}>
              <Text style={styles.number}>{number}. </Text>
              {title}
            </Text>
            {targetLabel && (
              <View style={styles.target}>
                <Text style={styles.targetText}>{targetLabel}</Text>
              </View>
            )}
            <Text style={styles.point}>{point}</Text>
          </View>
        </Pressable>
      )}
      <TextInput
        style={styles.memo}
        value={draftMemo}
        onChangeText={setDraftMemo}
        onBlur={() => {
          if (draftMemo !== memo) onCommitMemo(draftMemo);
        }}
        placeholder="聞いたこと・気になったこと"
        placeholderTextColor={colors.textFaint}
        multiline
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.surface,
  },
  cardChecked: { backgroundColor: colors.gradeGoodSurface, borderColor: colors.gradeGoodBorder },
  title: { fontSize: 14, fontWeight: '700', color: colors.textSubtle, lineHeight: 19 },
  number: { color: colors.textFaint },
  point: { fontSize: 11, color: colors.textMuted, lineHeight: 17, marginTop: 4 },
  grades: { flexDirection: 'row', gap: 6, marginTop: 8 },
  grade: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  gradeId: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  gradeLabel: { fontWeight: '500' },
  gradeSelectedText: { color: colors.primaryText },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  checkBox: {
    width: 20,
    height: 20,
    marginTop: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: colors.gradeGood, borderColor: colors.gradeGood },
  target: {
    alignSelf: 'flex-start',
    backgroundColor: colors.temperatureSurface,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
  },
  targetText: { fontSize: 10, fontWeight: '700', color: colors.temperature },
  memo: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    color: colors.textSubtle,
    backgroundColor: colors.surface,
    minHeight: 56,
    textAlignVertical: 'top',
  },
});
