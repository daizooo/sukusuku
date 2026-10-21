import { KeyboardAvoidingView, Modal as RNModal, StyleSheet, type ModalProps } from 'react-native';

/**
 * react-native の Modal の差し替え。全画面（transparent でない）のモーダルは、キーボードが出たら
 * その分だけ中身を縮める。Modal は別ウィンドウで開くので、OSの windowSoftInputMode が効かず、
 * そのままだと下の入力欄がキーボードの裏に隠れ、スクロールしても届かない。
 *
 * 使い方は react-native の Modal と同じ（import 元を変えるだけ）。transparent の枠
 * （SheetModal・RecurrenceModal など）は、各自の KeyboardAvoidingView で
 * 枠の位置まで考えて避けているので、ここでは何も足さない。
 */
export default function Modal({ children, ...props }: ModalProps) {
  if (props.transparent) return <RNModal {...props}>{children}</RNModal>;
  return (
    <RNModal {...props}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        {children}
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
