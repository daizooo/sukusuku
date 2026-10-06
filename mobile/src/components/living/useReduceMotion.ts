import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// 端末の「視差効果を減らす／アニメーションを減らす」が入っているか。補助くじの演出を止めるのに使う
// （PWA版は CSS の prefers-reduced-motion で止めている）。
export default function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (isMounted) setReduce(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}
