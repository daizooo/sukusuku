import * as Linking from 'expo-linking';
import type { EmailOtpType } from '@supabase/supabase-js';

// サインアップ確認メールのリンクの受け口。
//
// PWA版はVercelのURL（`/auth/confirm`、src/app/auth/confirm/route.ts）で受けていた。
// ネイティブ版はアプリ自身のスキームで受けるので、Vercelを畳んだあとも新規登録ができる
// （docs/native-app-rewrite.md §7の条件C・§9）。
//
// **確かめる順序と扱いはPWA版と同じにしてある。** 出るものが違うと、どちらが正しいのか
// 分からなくなるため（ルートの CLAUDE.md）。
//
//   error / error_code … 検証そのものが失敗（無効・期限切れ・使用済み）
//   code               … PKCEの引き換え。登録した端末でだけ通る
//   token_hash + type  … verifyOtp。端末に依存しない（メールのテンプレートを変えたとき）

/**
 * 確認リンクの飛び先。**Supabaseの Authentication > URL Configuration の
 * Redirect URLs に登録した値と一致していないと、リンクはここへ戻ってこない。**
 *
 * 入れた`.apk`では `sukusuku:///auth/confirm`、開発中は `exp://…/--/auth/confirm` と
 * 形が変わるので、登録するのは `sukusuku://**` のような形にしておく
 * （mobile/README.md「新規登録を使えるようにする」）。
 */
export const confirmRedirectUrl = (): string => Linking.createURL('/auth/confirm');

type Param = string | string[] | undefined;

/** Expo Routerのパラメータは同じ名前が複数来ることがあるので、先頭だけを見る。 */
const first = (value: Param): string | null => {
  const found = Array.isArray(value) ? value[0] : value;
  return found !== undefined && found !== '' ? found : null;
};

/** 確認リンクを開いたときに何をするか。 */
export type ConfirmAction =
  | { kind: 'failed' }
  | { kind: 'exchange'; code: string }
  | { kind: 'verify'; tokenHash: string; type: EmailOtpType };

export const confirmActionOf = (params: Record<string, Param>): ConfirmAction => {
  // 検証に失敗したとき、Supabaseの /auth/v1/verify はこれらを付けて戻してくる。
  if (first(params.error_code) ?? first(params.error)) return { kind: 'failed' };

  const code = first(params.code);
  if (code) return { kind: 'exchange', code };

  const tokenHash = first(params.token_hash);
  const type = first(params.type) as EmailOtpType | null;
  if (tokenHash && type) return { kind: 'verify', tokenHash, type };

  return { kind: 'failed' };
};
