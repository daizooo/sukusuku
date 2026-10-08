'use client';

import { useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * モーダルの暗い部分を押したら閉じる（戻る操作と同じ onClose を渡す）。mobile版の
 * SheetModal などで暗い部分を押すと閉じるのと同じ。返り値を暗い部分の要素に足す。
 * 枠の中で押し始めて外で離した（文字を選んでいた等）ときは閉じないよう、押し始めも暗い部分か確かめる。
 */
export function useBackdropClose(onClose: () => void) {
  const pressedOnBackdrop = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      pressedOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose();
      pressedOnBackdrop.current = false;
    },
  };
}
