import { useEffect, useRef } from 'react';

// ブラウザの戻る操作（スマホの戻るボタン・スワイプを含む）で「1つ前の画面」へ戻すための決まりごと。
// mobile版（Android）で戻る操作が1つ前のタブ・画面へ戻るのと同じ振る舞いにそろえる。
//
// 履歴に積むものは2種類。
// - nav   : いま開いているタブと予定タブの面（月/日/リスト）。切り替えるたびに1つ積む
// - layer : 開いているモーダル。開くときに1つ積み、閉じると取り除く
//
// 戻る操作で一番上のモーダルを閉じ、モーダルが無ければ nav を1つ前の状態へ戻す。
// アプリの状態から履歴を組み立てるだけで、状態のほうを履歴から読み直す場面は
// 「戻る操作が起きたとき」に限る。
//
// 積む・戻すは Next.js のルーターが差し込んだ window.history の上書きを通す
// （ルーターの内部の印を引き継ぐため。docs: linking-and-navigating の Native History API）。

/** 履歴に積んだ、開いているタブと面。 */
export interface NavSnapshot {
  tab: string;
  view: string;
}

type NavState = { sk: 'nav' } & NavSnapshot;
type LayerState = { sk: 'layer'; id: number };

interface Layer {
  id: number;
  onBack: () => void;
  /** 履歴へ積み終えたか。積む前に閉じられたときに、あとから積まないための印。 */
  pushed: boolean;
}

const layers: Layer[] = [];
let nextLayerId = 1;

// history.back() は非同期で、戻り終えるまでの間に積むと「いま積んだもの」を戻してしまう。
// 自分で戻した数を数え、戻り終えるまで積む処理を後ろへ回す。
let pendingPops = 0;
const deferred: (() => void)[] = [];

let currentNav: NavSnapshot | null = null;
let navListener: ((snapshot: NavSnapshot) => void) | null = null;
let isListening = false;

const isNavState = (state: unknown): state is NavState =>
  typeof state === 'object' && state !== null && (state as { sk?: unknown }).sk === 'nav';

const isLayerState = (state: unknown): state is LayerState =>
  typeof state === 'object' && state !== null && (state as { sk?: unknown }).sk === 'layer';

const whenIdle = (task: () => void) => {
  if (pendingPops > 0) deferred.push(task);
  else task();
};

const popProgrammatically = () => {
  pendingPops += 1;
  window.history.back();
};

const onPopState = (event: PopStateEvent) => {
  // 自分で戻した分。状態は変えず、後ろへ回していた積む処理を流す。
  if (pendingPops > 0) {
    pendingPops -= 1;
    if (pendingPops === 0) {
      const tasks = deferred.splice(0);
      tasks.forEach((task) => task());
    }
    return;
  }

  // 戻る操作でモーダルが開いていれば、一番上の1つだけを閉じる。
  const top = layers[layers.length - 1];
  if (top) {
    layers.pop();
    top.onBack();
    return;
  }

  if (isNavState(event.state)) {
    currentNav = { tab: event.state.tab, view: event.state.view };
    navListener?.(currentNav);
    return;
  }

  // 閉じたはずのモーダルの履歴に行き当たったとき（進む操作など）は、さらに1つ戻して飛ばす。
  if (isLayerState(event.state)) popProgrammatically();
};

const ensureListening = () => {
  if (isListening) return;
  isListening = true;
  window.addEventListener('popstate', onPopState);
};

/**
 * 開いているタブ・面を履歴へ反映する。変わっていれば1つ積み、変わっていなければ積まない
 * （URLだけ変わるときは同じ履歴の URL を置き換える）。
 *
 * @param snapshot いまのタブと面
 * @param url 履歴に持たせるURL。更新したときに同じタブのまま戻ってこられるようにするためのもの
 */
export function syncNav(snapshot: NavSnapshot, url: URL): void {
  ensureListening();
  const state: NavState = { sk: 'nav', ...snapshot };
  const current = window.history.state as unknown;

  // 最初の読み込み。この履歴を出発点にする（更新した直後は前の状態が残っているので置き換える）。
  if (currentNav === null) {
    currentNav = snapshot;
    window.history.replaceState(state, '', url);
    return;
  }

  const isSame = currentNav.tab === snapshot.tab && currentNav.view === snapshot.view;
  if (isSame) {
    // 同じ画面のまま URL だけ変わるとき（通知から開いた入力画面の印を消すなど）。
    if (url.href !== window.location.href) {
      const own: NavState | LayerState = isLayerState(current) ? { sk: 'layer', id: current.id } : state;
      window.history.replaceState(own, '', url);
    }
    return;
  }

  currentNav = snapshot;
  whenIdle(() => window.history.pushState(state, '', url));
}

/** 戻る・進む操作でタブ・面が変わったときに呼ばれる関数を登録する。登録は1つだけ。 */
export function onNavPop(listener: (snapshot: NavSnapshot) => void): () => void {
  ensureListening();
  navListener = listener;
  return () => {
    if (navListener === listener) navListener = null;
  };
}

/**
 * モーダルなどを開いている間だけ、戻る操作をそのモーダルを閉じる操作にする。
 * 戻る操作で onBack が呼ばれる。画面のボタンで閉じたときは履歴も1つ戻して取り除く。
 *
 * 開いたときに1つ積み、閉じたときに取り除くので、モーダルの中身が「開いている間だけ
 * 描画される」作りのものはその中で呼べばよい。開いていないときも描画される作りなら
 * enabled に開いているかどうかを渡す。
 */
export function useBackLayer(onBack: () => void, enabled = true): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    ensureListening();
    const layer: Layer = { id: nextLayerId, onBack: () => latest.current(), pushed: false };
    nextLayerId += 1;
    layers.push(layer);
    whenIdle(() => {
      // 積む前に閉じられていたなら積まない。
      if (!layers.includes(layer)) return;
      window.history.pushState({ sk: 'layer', id: layer.id } satisfies LayerState, '');
      layer.pushed = true;
    });

    return () => {
      const index = layers.indexOf(layer);
      // 戻る操作で閉じた場合は、すでに履歴も取り除かれている。
      if (index === -1) return;
      layers.splice(index, 1);
      const current = window.history.state as unknown;
      if (layer.pushed && isLayerState(current) && current.id === layer.id) popProgrammatically();
    };
  }, [enabled]);
}
