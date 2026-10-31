import { Modal as RNModal, StyleSheet, type ModalProps } from 'react-native';
import KeyboardAvoidingView from './KeyboardAvoidingView';

/**
 * react-native の Modal の差し替え。全画面（transparent でない）のモーダルは、キーボードが出たら
 * その分だけ中身を縮める。Modal は別ウィンドウで開くので、OSの windowSoftInputMode が効かず、
 * そのままだと下の入力欄がキーボードの裏に隠れ、スクロールしても届かない。
 *
 * 使い方は react-native の Modal と同じ（import 元を変えるだけ）。transparent の枠
 * （SheetModal・RecurrenceModal など）は、各自の KeyboardAvoidingView で
 * 枠の位置まで考えて避けているので、ここでは何も足さない。
 *
 * 全画面のモーダルは、statusBarTranslucent・navigationBarTranslucent で画面の端（上の帯・下の操作バーの裏）まで広げる。
 * アプリは edge-to-edge なのに、付けないと Modal のウィンドウだけが上の帯の下から始まり、下の操作バーの手前で終わる。
 * 中身は useSafeAreaInsets（アプリ本体の値）で上下を空けているので、余白が二重になり、下の端に下の画面がのぞいていた
 * （2026-10-31。transparent の枠は #362 で同じように直した）。
 */
export default function Modal({ children, ...props }: ModalProps) {
  if (props.transparent) return <RNModal {...props}>{children}</RNModal>;
  return (
    <RNModal statusBarTranslucent navigationBarTranslucent {...props}>
      <KeyboardAvoidingView style={styles.fill}>
        {children}
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
