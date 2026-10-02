import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listTasks } from '@/lib/api/tasks';
import { toDateStringInTimeZone } from '@/lib/dateUtils';
import { OPEN_LOG_PARAM, TAB_PARAM, parseLogType, parseTabId } from '@/lib/appLinks';
import { START_TAB_TO_TAB_ID, toStartTab } from '@/lib/api/me';
import SukusukuApp from '@/components/sukusuku/SukusukuApp';

interface HomeProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const supabase = await createClient();

  // middlewareでも未ログインは/loginへ流しているが、念のためここでも保険をかける。
  // getUser()はAuthサーバーへの往復を必ず伴うため、JWTの署名検証だけで済む
  // getClaims()を使う（getSession()と違い署名を検証するので認可判断に使ってよい）。
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  if (!userId) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('users')
    .select('family_id, start_tab')
    .eq('id', userId)
    .single();

  if (!profile?.family_id) {
    redirect('/family-setup');
  }

  // クライアント側のhydration後にウォーターフォールで取りに行かず済むよう、
  // familyIdが分かった時点でここ(サーバー側)でも並行してtasksを取得しておく。
  // 失敗時はクライアント側の再取得に委ねる（初期値なしとして渡す）。
  const initialTasks = await listTasks(supabase, profile.family_id).catch((err) => {
    console.error('Failed to load initial tasks:', err);
    return null;
  });

  // 「今日」をサーバー側で確定させてクライアントへ渡す。
  // クライアント側で new Date() を独自に評価すると、サーバーとクライアントで
  // 「今日」がずれてhydration mismatchになるため（SukusukuApp側で詳細をコメント）。
  // サーバーのローカルタイムはUTCなので、日本時間基準で日付を出す
  // （そのままだと日本の 0:00〜9:00 の間は前の日が「今日」になってしまう）。
  const todayDateString = toDateStringInTimeZone(new Date());

  // 開く場所をURLから決める。画面を更新したときに見ていたタブへ戻すのと、
  // 通知のタップからその用件の画面へ直接開くのを、同じ仕組みでまかなう。
  // クライアント側で読むとホームを描いたあとに切り替わってちらつくため、ここで確定させる。
  const params = await searchParams;

  return (
    <div className="flex flex-col flex-1 bg-gray-50">
      <SukusukuApp
        familyId={profile.family_id}
        userId={userId}
        initialTasks={initialTasks}
        todayDateString={todayDateString}
        // URLにタブが無ければ、設定タブで選んだ「最初に開くタブ」から始める。
        initialTab={parseTabId(params[TAB_PARAM]) ?? START_TAB_TO_TAB_ID[toStartTab(profile.start_tab)]}
        initialLogType={parseLogType(params[OPEN_LOG_PARAM])}
      />
    </div>
  );
}
