// 計測中の睡眠だけを端末内に控えておく。
// 育児記録はまだ画面上の状態でしか持っていないため、リロードや再訪で計測が消えないようにする。
// （記録全体のDB保存は別作業）

const STORAGE_KEY = 'sukusuku:activeSleep';

export interface StoredActiveSleep {
  id: number;
  startedAt: number;
  user: string;
}

export const loadActiveSleep = (): StoredActiveSleep | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredActiveSleep>;
    if (!Number.isFinite(parsed.id) || !Number.isFinite(parsed.startedAt)) return null;
    return {
      id: parsed.id as number,
      startedAt: parsed.startedAt as number,
      user: parsed.user ?? 'あなた',
    };
  } catch (err) {
    console.error('Failed to read active sleep:', err);
    return null;
  }
};

export const saveActiveSleep = (value: StoredActiveSleep): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (err) {
    console.error('Failed to save active sleep:', err);
  }
};

export const clearActiveSleep = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear active sleep:', err);
  }
};
