// 成長記録(身長・体重)の入力値の検証と単位換算。
//
// 以前は入力欄の文字列をそのままDBへ送っていたため、体重をg（例: 3200）で入力すると
// Postgres が numeric field overflow を返し、「追加に失敗しました」としか出ずに原因が分からなかった。
// 保存前にここで単位を揃え、範囲外の値は理由の分かる日本語で突き返す。

// 呼び出し側へ渡す値。身長はcm・体重はkg・生後ヶ月は整数（未入力はnull）に揃える。
export interface GrowthRecordDraft {
  recordedDate: string;
  monthAge: number | null;
  height: number | null;
  weight: number | null;
}

export type WeightUnit = 'kg' | 'g';

// 母子手帳の記録として現実的な上限。単位や桁の取り違えをここで止める。
export const MAX_HEIGHT_CM = 200;
export const MAX_WEIGHT_KG = 50;
export const MAX_MONTH_AGE = 120;

export const maxWeightFor = (unit: WeightUnit): number => (unit === 'kg' ? MAX_WEIGHT_KG : MAX_WEIGHT_KG * 1000);

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** 入力された体重をkgへ換算する。空欄や数値でない場合は null。 */
export const toWeightKg = (value: string, unit: WeightUnit): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return round2(unit === 'kg' ? parsed : parsed / 1000);
};

export interface GrowthRecordFormValues {
  recordedDate: string;
  monthAge: string;
  height: string;
  weight: string;
  weightUnit: WeightUnit;
}

export type GrowthRecordValidation =
  | { ok: true; draft: GrowthRecordDraft }
  | { ok: false; message: string };

export const validateGrowthRecordForm = (values: GrowthRecordFormValues): GrowthRecordValidation => {
  const fail = (message: string): GrowthRecordValidation => ({ ok: false, message });

  if (!values.recordedDate) return fail('記録日を入力してください。');
  if (values.height.trim() === '' && values.weight.trim() === '') {
    return fail('身長か体重のどちらかを入力してください。');
  }

  let height: number | null = null;
  if (values.height.trim() !== '') {
    const parsed = Number(values.height);
    if (!Number.isFinite(parsed)) return fail('身長は数値で入力してください。');
    if (parsed <= 0 || parsed > MAX_HEIGHT_CM) {
      return fail(`身長は0より大きく${MAX_HEIGHT_CM}cm以下で入力してください。`);
    }
    height = round2(parsed);
  }

  let weight: number | null = null;
  if (values.weight.trim() !== '') {
    const parsed = Number(values.weight);
    if (!Number.isFinite(parsed)) return fail('体重は数値で入力してください。');
    const max = maxWeightFor(values.weightUnit);
    if (parsed <= 0 || parsed > max) {
      return fail(
        values.weightUnit === 'kg'
          ? `体重は0より大きく${MAX_WEIGHT_KG}kg以下で入力してください。g（グラム）で記録する場合は単位を「g」に切り替えてください。`
          : `体重は0より大きく${max}g以下で入力してください。`,
      );
    }
    weight = round2(values.weightUnit === 'kg' ? parsed : parsed / 1000);
  }

  let monthAge: number | null = null;
  if (values.monthAge.trim() !== '') {
    const parsed = Number(values.monthAge);
    if (!Number.isInteger(parsed)) return fail('生後ヶ月は整数で入力してください。');
    if (parsed < 0 || parsed > MAX_MONTH_AGE) {
      return fail(`生後ヶ月は0〜${MAX_MONTH_AGE}の範囲で入力してください。`);
    }
    monthAge = parsed;
  }

  return { ok: true, draft: { recordedDate: values.recordedDate, monthAge, height, weight } };
};
