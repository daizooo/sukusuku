import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * react-native の KeyboardAvoidingView（behavior="padding"）の差し替え。
 * キーボードが出たらその分だけ下に余白を足して中身を縮める、という動きは同じ。
 *
 * 差し替えているのは、Androidでキーボードを閉じたあとに余白が残るのを防ぐため。
 * RN本体は閉じたときのイベント（keyboardDidHide）の screenY に「表示領域の高さ」を入れて送る。
 * edge-to-edge の画面では、これは画面の高さより「上の帯＋下のナビゲーションバー」のぶん小さい。
 * KeyboardAvoidingView はその差を「まだキーボードが重なっている」と数え、閉じたあとも
 * 下に同じ高さの余白（その裏は黒い地）を残してしまう。記録の入力でキーボードを出すと、
 * 閉じたあとに画面の下に黒い帯が出たのはこれ。
 * 閉じたときは重なりを0にする。出たときの計算は RN本体と同じ。
 *
 * iOSはイベントが正しいので、そのまま RN本体を使う。
 */
interface KeyboardAvoidingViewProps {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

export default function KeyboardAvoidingView({ style, children }: KeyboardAvoidingViewProps) {
  if (Platform.OS !== 'android') {
    return (
      <RNKeyboardAvoidingView style={style} behavior="padding">
        {children}
      </RNKeyboardAvoidingView>
    );
  }
  return <AndroidKeyboardAvoidingView style={style}>{children}</AndroidKeyboardAvoidingView>;
}

function AndroidKeyboardAvoidingView({ style, children }: KeyboardAvoidingViewProps) {
  const frame = useRef<{ y: number; height: number } | null>(null);
  // キーボードの上端（画面の上からの位置）。出ていないときは null。
  const keyboardTop = useRef<number | null>(
    Keyboard.isVisible() ? (Keyboard.metrics()?.screenY ?? null) : null,
  );
  const [bottom, setBottom] = useState(0);

  const update = useCallback(() => {
    if (!frame.current || keyboardTop.current === null) {
      setBottom(0);
      return;
    }
    setBottom(Math.max(frame.current.y + frame.current.height - keyboardTop.current, 0));
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardTop.current = event.endCoordinates.screenY;
      update();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      update();
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [update]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      frame.current = event.nativeEvent.layout;
      update();
    },
    [update],
  );

  return (
    <View style={[style, { paddingBottom: bottom }]} onLayout={onLayout}>
      {children}
    </View>
  );
}
