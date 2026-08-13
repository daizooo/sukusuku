import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SukusukuAppLoader from '@/components/sukusuku/SukusukuAppLoader';

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middlewareでも未ログインは/loginへ流しているが、念のためここでも保険をかける
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase.from('users').select('family_id, role').eq('id', user.id).single();

  if (!profile?.family_id) {
    redirect('/family-setup');
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-gray-100">
      <SukusukuAppLoader familyId={profile.family_id} userId={user.id} role={profile.role === 'papa' || profile.role === 'mama' ? profile.role : null} />
    </div>
  );
}
