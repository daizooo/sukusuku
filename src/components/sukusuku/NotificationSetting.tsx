import type { ReactNode } from 'react';
import { BellRing } from 'lucide-react';

interface NotificationSettingProps {
  /** 同じ枠の中に続けて出す通知の設定（授乳の目安・検温のお知らせ）。 */
  children?: ReactNode;
}

// 通知の設定の枠。
// 通知を受け取れるのはAndroidアプリ（mobile版）だけで、Web版（PWA）には届かない
// （Web Pushは撤去した。docs/notifications.md §11）。ここに並べる授乳の間隔・検温の時刻は
// 家族で共通の設定なので、Web版からも変えられる。
export default function NotificationSetting({ children }: NotificationSettingProps) {
  return (
    <section className="bg-white rounded-2xl p-3.5 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2">
        <BellRing size={18} className="text-blue-500" />
        <h3 className="flex-1 font-extrabold text-gray-900">通知</h3>
      </div>
      <p className="text-xs text-gray-500 mt-1.5">
        通知はAndroidアプリで受け取ります。この画面では届きません。
      </p>
      {children}
    </section>
  );
}
