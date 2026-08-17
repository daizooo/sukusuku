import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listTasks } from '@/lib/api/tasks';
import SukusukuAppLoader from '@/components/sukusuku/SukusukuAppLoader';

export default async function Home() {
  const supabase = await createClient();

  // middlewareでも未ログインは/loginへ流しているが、念のためここでも保険をかける。
  // getUser()はAuthサーバーへの往復を必ず伴うため、JWTの署名検証だけで済む
  // getClaims()を使う（getSession()と違い署名を検証するので認可判断に使ってよい）。
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  if (!userId) {
    redirect('/login');
  }

  const { data: profile } = await supabase.from('users').select('family_id, role').eq('id', userId).single();

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

  return (
    <div className="flex flex-col flex-1 bg-gray-50">
      <SukusukuAppLoader
        familyId={profile.family_id}
        userId={userId}
        role={profile.role === 'papa' || profile.role === 'mama' ? profile.role : null}
        initialTasks={initialTasks}
      />
    </div>
  );
}
