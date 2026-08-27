import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type SupabaseDb = SupabaseClient<Database>;

// 検温のお知らせの設定。「毎日決まった時刻に測る」は夫婦で揃っていないと
// 平熱の比べる相手にならないため、端末やユーザーではなく家族ごとに持つ。
// 行が無い家族は既定値として扱うので、設定を触るまでDBに行は作られない。

export interface TemperatureReminderSettings {
  /** 朝・夕の時刻にお知らせするか。オフでも体温の記録はいつでもできる。 */
  enabled: boolean;
  /** 朝の検温の時刻 'HH:mm'(日本時間)。 */
  morningTime: string;
  /** 夕方の検温の時刻 'HH:mm'(日本時間)。 */
  eveningTime: string;
}

export const DEFAULT_TEMPERATURE_REMINDER_SETTINGS: TemperatureReminderSettings = {
  enabled: true,
  morningTime: '06:00',
  eveningTime: '18:00',
};

/** DBの time 型は '06:00:00' の形で返るため、入力欄が扱う 'HH:mm' に切り詰める。 */
const toHhMm = (value: string): string => value.slice(0, 5);

/** DBへ入れる時刻。'HH:mm' のままでも time として解釈されるが、形を揃えておく。 */
const toDbTime = (value: string): string => `${toHhMm(value)}:00`;

export async function getTemperatureReminderSettings(
  supabase: SupabaseDb,
  familyId: string,
): Promise<TemperatureReminderSettings> {
  const { data, error } = await supabase
    .from('temperature_reminder_settings')
    .select('enabled, morning_time, evening_time')
    .eq('family_id', familyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_TEMPERATURE_REMINDER_SETTINGS;
  return {
    enabled: data.enabled,
    morningTime: toHhMm(data.morning_time),
    eveningTime: toHhMm(data.evening_time),
  };
}

export async function saveTemperatureReminderSettings(
  supabase: SupabaseDb,
  familyId: string,
  settings: TemperatureReminderSettings,
): Promise<void> {
  const { error } = await supabase.from('temperature_reminder_settings').upsert(
    {
      family_id: familyId,
      enabled: settings.enabled,
      morning_time: toDbTime(settings.morningTime),
      evening_time: toDbTime(settings.eveningTime),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'family_id' },
  );
  if (error) throw error;
}
