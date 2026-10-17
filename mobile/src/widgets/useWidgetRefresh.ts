import { useEffect } from 'react';
import { AppState } from 'react-native';
import { refreshWidgets } from './refreshWidgets';

/**
 * アプリを開いたとき・前面へ戻したとき・背面へ回したときに、ホーム画面のウィジェットを描き直す（docs/widgets.md §3.3）。
 * 記録してからホーム画面へ戻ったときに、ウィジェットがもう新しい中身になっているようにする。
 * 背面へ回した瞬間の描き直しは、裏で止められて終わらないことがある（2026-10-17、「読めません」のまま戻らなかった）ので、
 * アプリが前面にいる間にも描き直す。ログイン・ログアウトしたときも、これでウィジェットがそれに合わせて描き直される。
 */
export function useWidgetRefresh(): void {
  useEffect(() => {
    void refreshWidgets();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background') void refreshWidgets();
    });
    return () => subscription.remove();
  }, []);
}
