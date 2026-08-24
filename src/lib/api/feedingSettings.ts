import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { DEFAULT_FEEDING_INTERVAL_MINUTES } from '@/lib/feedingSchedule';

type SupabaseDb = SupabaseClient<Database>;

// 「次の授乳の目安」の設定。夫婦で違う目安が出ては意味がないので家族ごとに持つ。
// 行が無い家族は既定値として扱うため、設定を触るまでDBに行は作られない。

export interface FeedingSettings {
  /** 前回の授乳から次の目安までの時間(分)。 */
  intervalMinutes: number;
  /** 目安の時刻に通知するか。オフでも画面の表示は出る。 */
  notifyEnabled: boolean;
}

export const DEFAULT_FEEDING_SETTINGS: FeedingSettings = {
  intervalMinutes: DEFAULT_FEEDING_INTERVAL_MINUTES,
  notifyEnabled: true,
};

export async function getFeedingSettings(
  supabase: SupabaseDb,
  familyId: string,
): Promise<FeedingSettings> {
  const { data, error } = await supabase
    .from('feeding_settings')
    .select('interval_minutes, notify_enabled')
    .eq('family_id', familyId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_FEEDING_SETTINGS;
  return {
    intervalMinutes: data.interval_minutes,
    notifyEnabled: data.notify_enabled,
  };
}

export async function saveFeedingSettings(
  supabase: SupabaseDb,
  familyId: string,
  settings: FeedingSettings,
): Promise<void> {
  const { error } = await supabase.from('feeding_settings').upsert(
    {
      family_id: familyId,
      interval_minutes: settings.intervalMinutes,
      notify_enabled: settings.notifyEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'family_id' },
  );
  if (error) throw error;
}
