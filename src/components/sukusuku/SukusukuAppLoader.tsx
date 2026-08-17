'use client';

import dynamic from 'next/dynamic';
import type { LoginRole, Task } from '@/types/app';

interface SukusukuAppLoaderProps {
  familyId: string;
  userId: string;
  role: LoginRole;
  // サーバー側で取得できたタスクの初期値。取得に失敗した場合はnull（クライアント側で取り直す）。
  initialTasks: Task[] | null;
}

// SukusukuAppはローカル日時(new Date())に依存する状態を多数持つため、
// サーバー/クライアントでのレンダリング差異(hydration mismatch)を避けるためSSRを無効化する。
// next/dynamic の ssr:false はクライアントコンポーネント内でのみ使用できるため、
// このラッパーを経由してサーバーコンポーネントの page.tsx から呼び出す。
const SukusukuApp = dynamic(() => import('./SukusukuApp'), {
  ssr: false,
});

export default function SukusukuAppLoader({ familyId, userId, role, initialTasks }: SukusukuAppLoaderProps) {
  return <SukusukuApp familyId={familyId} userId={userId} role={role} initialTasks={initialTasks} />;
}
