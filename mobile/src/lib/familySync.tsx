import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { getMyMembership } from '@/lib/api/me';
import type { Database } from '@/types/supabase';
import { hasChanged, pickStamps, toStamps, type Stamps } from '@/lib/familySyncStamps';

// 他の端末での変更を、画面へ漏れなく・必要な分だけの読み直しで届ける仕組み。
//
// 困りごと: 妻が記録した授乳が夫の画面に出ない。タブは一度開くと残り、読み込みは起動時の
// 1回きりだったので、パートナーの端末での変更に気づく手段が無かった。
//
// 仕組み（DB側は supabase/migrations/0078_family_sync.sql、設計は docs/sync.md）:
//   - 家族ごとに1行の変更台帳 family_sync を持つ。{表名: 最後に変わった時刻}
//   - 共有表への書き込みのたびに、その表の時刻がDBのトリガで更新される
//   - ここ（FamilySyncProvider）は、その1行だけを見張る。
//       Realtime で届く / 前面へ戻ったときに1回読む / つながり直したときに1回読む
//     のどれでも同じ形で最新の台帳が分かる（行の中身は流れず、時刻だけ）
//   - 各画面は useFamilyRefresh で「自分が読んでいる表」を宣言する。その表の時刻が前と変わった
//     ときだけ、その画面が読み直す。家計は家計の表が変わったときだけ読み直す
//
// 新しい画面を作るときは、読み込みを関数にして useFamilyRefresh に渡す（CLAUDE.md「読み込みの作り方」）。
// 渡し忘れは scripts/check-family-sync.mjs（npm run check:family-sync）が見つける。

/** 台帳に載る表の名前。存在しない名前はコンパイルで弾く。 */
export type FamilyTable = keyof Database['public']['Tables'];

interface FamilySyncState {
  /** 最新の台帳。まだ読めていなければ null。 */
  stamps: Stamps | null;
  /** 前面へ戻った・つながり直したたびに増える。 */
  resumeCount: number;
}

const FamilySyncContext = createContext<FamilySyncState>({ stamps: null, resumeCount: 0 });

/** Realtime がつながらないときに、台帳を取りに行く間隔。 */
const FALLBACK_POLL_MS = 30_000;

export function FamilySyncProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [stamps, setStamps] = useState<Stamps | null>(null);
  const [resumeCount, setResumeCount] = useState(0);

  // 所属は1回の問い合わせで取って使い回している（src/lib/api/me.ts）。
  useEffect(() => {
    if (!userId) {
      setFamilyId(null);
      setStamps(null);
      return;
    }
    let isMounted = true;
    getMyMembership(supabase, userId)
      .then((membership) => {
        if (isMounted) setFamilyId(membership.familyId);
      })
      .catch(() => {
        // 読めなければ見張らない（各画面は起動時の読み込みで出せる）。次にログイン状態が変わったとき取り直す。
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!familyId) return;
    let isCancelled = false;
    let hasConnected = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    /** 台帳の1行を読む。行がまだ無い家族（まだ何も書かれていない）は空の台帳として扱う。 */
    const read = async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('family_sync')
        .select('changed')
        .eq('family_id', familyId)
        .maybeSingle();
      if (isCancelled || error) return false;
      setStamps(toStamps(data?.changed));
      return true;
    };
    const markResumed = () => setResumeCount((count) => count + 1);

    const stopPolling = () => {
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
    };
    // Realtime がつながらない間も追いつけるよう、一定間隔で台帳を取りに行く（つながったら止める）。
    const startPolling = () => {
      if (pollTimer === null) pollTimer = setInterval(() => void read(), FALLBACK_POLL_MS);
    };

    const channel = supabase
      .channel(`family-sync:${familyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'family_sync', filter: `family_id=eq.${familyId}` },
        (payload) => {
          const next = (payload.new as { changed?: unknown } | null)?.changed;
          if (next !== undefined) setStamps(toStamps(next));
        },
      )
      .subscribe((status) => {
        if (isCancelled) return;
        if (status === 'SUBSCRIBED') {
          stopPolling();
          // つながった（つなぎ直した）時点までに取りこぼした分を、台帳1回で拾う。
          void read().then((ok) => {
            if (ok && hasConnected) markResumed();
            hasConnected = true;
          });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startPolling();
        }
      });

    // 裏にいる間は Realtime が切れていることがある。前面へ戻ったところで台帳を読み直す。
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void read().then((ok) => ok && markResumed());
    });

    return () => {
      isCancelled = true;
      stopPolling();
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, [familyId]);

  const value = useMemo(() => ({ stamps, resumeCount }), [stamps, resumeCount]);
  return <FamilySyncContext.Provider value={value}>{children}</FamilySyncContext.Provider>;
}

/** 変更を受けてから読み直すまで待つ時間。続けて変わったとき（まとめて保存など）を1回にまとめる。 */
const REFRESH_DEBOUNCE_MS = 400;

/** 前面復帰の読み直し（onResume）を続けてやらない間隔。 */
const RESUME_MIN_INTERVAL_MS = 30_000;

/**
 * 台帳を最初に受け取ったのが画面を出した直後なら、その時点の画面は最新とみなす
 * （起動時の読み込みと同時に台帳が届いただけなので、読み直さない）。
 * それより後に初めて台帳が読めたとき（圏外で起動して、あとでつながったなど）は、
 * 画面を出してから変わった分があり得るので、1回読み直す。
 */
const BASELINE_GRACE_MS = 5_000;

interface FamilyRefreshOptions {
  /**
   * アプリが前面へ戻った・つながり直したときも読み直す（表の変更がなくても）。
   * 端末内に溜めた書き込みを送る画面（育児の記録）など、変更の通知を待てない画面だけ指定する。
   */
  onResume?: boolean;
}

/**
 * 画面が読んでいる表（tables）が他の端末で変わったときに、読み直す（refresh を呼ぶ）。
 *
 * - 読み直すのは、いま見ている画面だけ。見ていない間に変わった分は、開いたときに1回読み直す
 * - 自分の端末での保存でも台帳は変わる。保存後にもう一度読み直すだけで、結果は同じになる
 * - 起動時の読み込みは、これまでどおり画面自身が行う（ここは「後から変わった分」を拾う）
 * - 読み込み中の表示には戻さず、届いたら差し替える作りの refresh を渡すこと
 *
 * @param tables この画面が読む表。API関数が読む表を漏れなく並べる（check:family-sync が確かめる）。
 * @param refresh 読み直す処理。毎回の描画で作り直してもよい。失敗しても画面を止めない作りにする。
 */
export function useFamilyRefresh(
  tables: readonly FamilyTable[],
  refresh: () => void,
  options: FamilyRefreshOptions = {},
): void {
  const { stamps, resumeCount } = useContext(FamilySyncContext);
  const tablesKey = tables.join(',');
  const onResume = options.onResume === true;

  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  /** 画面を出した時刻。最初の台帳を受け取ったのが直後かどうかの判定に使う。 */
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  /** 画面が最後に読んだ（と見なす）時点での、自分の表の時刻。まだ台帳を受け取っていなければ null。 */
  const seen = useRef<Stamps | null>(null);
  const isFocused = useRef(false);
  /** 見ていない間に変わった（開いたときに読み直す）。 */
  const isDirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(() => {
    isDirty.current = false;
    latest.current();
  }, []);

  /** 読み直しを予約する。続けて呼ばれたら1回にまとめ、見ていなければ開いたときに回す。 */
  const schedule = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (isFocused.current) run();
      else isDirty.current = true;
    }, REFRESH_DEBOUNCE_MS);
  }, [run]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      isFocused.current = true;
      if (isDirty.current) run();
      return () => {
        isFocused.current = false;
      };
    }, [run]),
  );

  // 台帳が変わったとき: 自分の表の時刻が前と違えば読み直す。
  useEffect(() => {
    if (stamps === null) return;
    const mine = tablesKey === '' ? [] : tablesKey.split(',');
    if (seen.current === null) {
      seen.current = pickStamps(mine, stamps);
      // 画面を出してからだいぶ後に初めて台帳が読めた場合は、取りこぼしがあり得るので1回読み直す。
      if (Date.now() - mountedAt.current > BASELINE_GRACE_MS) schedule();
      return;
    }
    if (hasChanged(mine, seen.current, stamps)) {
      seen.current = pickStamps(mine, stamps);
      schedule();
    }
  }, [stamps, tablesKey, schedule]);

  // 前面復帰・つながり直し: 変更の通知を待てない画面だけ、表の変更がなくても読み直す（間引きあり）。
  const handledResume = useRef(resumeCount);
  const lastResumeRun = useRef(0);
  useEffect(() => {
    if (resumeCount === handledResume.current) return;
    handledResume.current = resumeCount;
    if (!onResume) return;
    if (Date.now() - lastResumeRun.current < RESUME_MIN_INTERVAL_MS) return;
    lastResumeRun.current = Date.now();
    schedule();
  }, [resumeCount, onResume, schedule]);
}
