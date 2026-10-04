import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_QUIET_HOURS, type QuietHours } from '@/lib/wakeAlarmPlan';

// 夜間の起床アラームの設定（docs/night-wake-alarm.md §2）。
//
// **この端末だけの設定**で、家族では共有しない（夜に授乳する側の端末だけでオンにするため）。
// だから DB には置かず、端末に控える。既定はオフ。

export interface WakeAlarmSettings {
  /** 起床アラームを鳴らすか。 */
  enabled: boolean;
  /** おやすみ時間。0:00からの分（日本時間）。 */
  quiet: QuietHours;
}

export const DEFAULT_WAKE_ALARM_SETTINGS: WakeAlarmSettings = {
  enabled: false,
  quiet: DEFAULT_QUIET_HOURS,
};

const STORAGE_KEY = 'sukusuku.wakeAlarm.settings';

const isMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 24 * 60;

/** 控えを読む。壊れていたり無かったりしたら既定値（オフ）。 */
export async function loadWakeAlarmSettings(): Promise<WakeAlarmSettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WAKE_ALARM_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<WakeAlarmSettings> | null;
    const start = parsed?.quiet?.startMinutes;
    const end = parsed?.quiet?.endMinutes;
    return {
      enabled: parsed?.enabled === true,
      quiet:
        isMinutes(start) && isMinutes(end)
          ? { startMinutes: start, endMinutes: end }
          : DEFAULT_QUIET_HOURS,
    };
  } catch {
    return DEFAULT_WAKE_ALARM_SETTINGS;
  }
}

type Listener = (settings: WakeAlarmSettings) => void;
const listeners = new Set<Listener>();

/** 設定を保存し、聞いている側（予約の組み直し・設定画面）へ知らせる。 */
export async function saveWakeAlarmSettings(settings: WakeAlarmSettings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  listeners.forEach((listener) => listener(settings));
}

/** 設定が変わったときの受け手を登録する。戻り値で解除。 */
export const onWakeAlarmSettingsChange = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 設定画面用。読み込み前は null。 */
export function useWakeAlarmSettings(): {
  settings: WakeAlarmSettings | null;
  update: (next: WakeAlarmSettings) => Promise<void>;
} {
  const [settings, setSettings] = useState<WakeAlarmSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWakeAlarmSettings().then((loaded) => {
      if (!cancelled) setSettings(loaded);
    });
    const unsubscribe = onWakeAlarmSettingsChange(setSettings);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const update = useCallback((next: WakeAlarmSettings) => saveWakeAlarmSettings(next), []);
  return { settings, update };
}
