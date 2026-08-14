'use client';

import dynamic from 'next/dynamic';
import type { LoginRole } from '@/types/app';

interface SukusukuAppLoaderProps {
  familyId: string;
  userId: string;
  role: LoginRole;
}

// SukusukuAppはローカル日時(new Date())に依存する状態を多数持つため、
// サーバー/クライアントでのレンダリング差異(hydration mismatch)を避けるためSSRを無効化する。
// next/dynamic の ssr:false はクライアントコンポーネント内でのみ使用できるため、
// このラッパーを経由してサーバーコンポーネントの page.tsx から呼び出す。
const SukusukuApp = dynamic(() => import('./SukusukuApp'), {
  ssr: false,
});

export default function SukusukuAppLoader({ familyId, userId, role }: SukusukuAppLoaderProps) {
  return <SukusukuApp familyId={familyId} userId={userId} role={role} />;
}
