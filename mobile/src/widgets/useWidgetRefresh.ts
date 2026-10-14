import { useEffect } from 'react';
import { AppState } from 'react-native';
import { refreshWidgets } from './refreshWidgets';

/**
 * アプリを背面へ回すたびに、ホーム画面のウィジェットを描き直す（docs/widgets.md §3.3）。
 * 記録してからホーム画面へ戻ったときに、ウィジェットがもう新しい中身になっているようにする。
 * ログイン・ログアウトしたときも、背面へ回せばウィジェットがそれに合わせて描き直される。
 */
export function useWidgetRefresh(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') void refreshWidgets();
    });
    return () => subscription.remove();
  }, []);
}
