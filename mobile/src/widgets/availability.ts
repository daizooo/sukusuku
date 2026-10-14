import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * ホーム画面のウィジェットが使えるか。Androidの `.apk` だけ（docs/widgets.md §1）。
 * Expo Go には部品（react-native-android-widget のネイティブ側）が入っておらず、読み込むだけで落ちるので、
 * ウィジェットの部品はこれを確かめてから require する。
 */
export const widgetsAvailable =
  Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
