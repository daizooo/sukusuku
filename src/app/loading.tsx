// トップページはSupabaseでの認証・プロフィール取得を待つ間サーバー側で保留になる。
// loading.tsxを置くとその間にこのスケルトンが即座にストリーミングされ、
// 真っ白な画面で待たされる状態をなくせる。
// SukusukuApp本体と同じ外枠（md以上はサイドバー、モバイルはボトムナビ）を描いておき、
// 実データに差し替わったときの画面の飛びを最小限にする。
const NAV_SLOTS = [0, 1, 2, 3, 4];

export default function Loading() {
  return (
    <div className="flex flex-col flex-1 bg-gray-50">
      <div className="w-full h-svh relative bg-gray-50 flex font-sans overflow-hidden" aria-busy="true" aria-label="読み込み中">
        <nav className="hidden md:flex md:flex-col md:w-56 lg:w-64 flex-none bg-white border-r border-gray-200 px-3 py-6">
          <h1 className="font-bold text-gray-800 tracking-wide text-lg px-3 mb-8">すくすく手帳</h1>
          <div className="flex flex-col space-y-1">
            {NAV_SLOTS.map((i) => (
              <div key={i} className="flex items-center space-x-3 px-3 py-2.5">
                <div className="w-5 h-5 rounded bg-gray-200 animate-pulse shrink-0" />
                <div className="h-3 w-20 rounded bg-gray-200 animate-pulse" />
              </div>
            ))}
          </div>
        </nav>

        <div className="flex flex-col flex-1 min-w-0 relative pt-[env(safe-area-inset-top)]">
          <main className="flex-1 overflow-hidden p-4 space-y-4">
            <div className="h-24 rounded-2xl bg-gray-200 animate-pulse" />
            <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
            <div className="space-y-2.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-white border border-gray-100 shadow-sm flex items-center px-4 space-x-3">
                  <div className="w-5 h-5 rounded-full bg-gray-200 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-gray-200 animate-pulse" />
                    <div className="h-2.5 w-1/3 rounded bg-gray-100 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </main>

          <nav className="flex-none bg-white border-t border-gray-200 w-full z-30 pb-[env(safe-area-inset-bottom)] md:hidden">
            <div className="flex justify-around items-center h-16 px-1">
              {NAV_SLOTS.map((i) => (
                <div key={i} className="flex flex-col items-center justify-center w-full h-full space-y-1">
                  <div className="w-5.5 h-5.5 rounded bg-gray-200 animate-pulse" />
                  <div className="h-2.5 w-7 rounded bg-gray-200 animate-pulse" />
                </div>
              ))}
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
