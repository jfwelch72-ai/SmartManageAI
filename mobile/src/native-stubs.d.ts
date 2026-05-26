// Ambient module stubs for React Native / Expo packages that are not installed
// at the workspace root. These declarations exist solely to satisfy `tsc --build`
// (run via `npm run check` / the `typecheck` CI workflow), which type-checks the
// mobile source tree as a composite project referenced from the root tsconfig.json.
// The actual Expo / RN packages are only installed inside `mobile/` for the Expo
// build toolchain; they are intentionally absent at the root to keep the web app
// dependency surface small. Each stub exposes the minimal public API used by the
// mobile source tree — see tsconfig.mobile.json for the composite project config.

declare module "react-native" {
  import type { FC, ReactNode } from "react";
  type StyleProp<T> = T | T[] | null | undefined | false;
  interface AnyStyle { [key: string]: any; }
  interface BaseProps {
    style?: StyleProp<AnyStyle>;
    children?: ReactNode;
    testID?: string;
    [key: string]: any;
  }
  export const View: FC<BaseProps>;
  export const ScrollView: FC<BaseProps>;
  export const Text: FC<BaseProps>;
  export const Pressable: FC<BaseProps>;
  export const TextInput: FC<BaseProps>;
  export const Image: FC<BaseProps>;
  export const Modal: FC<BaseProps>;
  export const ActivityIndicator: FC<BaseProps>;
  export const RefreshControl: FC<BaseProps & { refreshing?: boolean; onRefresh?: () => void; tintColor?: string }>;
  export const KeyboardAvoidingView: FC<BaseProps>;
  export const SafeAreaView: FC<BaseProps>;
  export const TouchableOpacity: FC<BaseProps>;
  export const FlatList: FC<BaseProps>;
  export const Switch: FC<BaseProps & { value?: boolean; onValueChange?: (value: boolean) => void; disabled?: boolean }>;
  export const Alert: {
    alert(title: string, message?: string, buttons?: any[]): void;
  };
  export const StyleSheet: {
    create<T extends Record<string, any>>(styles: T): T;
    hairlineWidth: number;
    absoluteFill: any;
    absoluteFillObject: any;
    flatten(style: any): any;
  };
  export const Platform: {
    OS: "ios" | "android" | "web" | "windows" | "macos";
    select<T>(specifics: Partial<Record<"ios" | "android" | "web" | "default", T>>): T;
    Version: number | string;
  };
  export const AppState: {
    currentState: string;
    addEventListener(type: string, handler: (state: string) => void): { remove(): void };
  };
  export const Dimensions: {
    get(dim: "window" | "screen"): { width: number; height: number };
  };
  export const Linking: {
    openURL(url: string): Promise<void>;
    canOpenURL(url: string): Promise<boolean>;
  };
  export interface LayoutChangeEvent {
    nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
  }
  export interface GestureResponderEvent {
    nativeEvent: {
      locationX: number;
      locationY: number;
      pageX: number;
      pageY: number;
      [k: string]: any;
    };
  }
  export interface PanResponderInstance {
    panHandlers: Record<string, any>;
  }
  export const PanResponder: {
    create(config: Record<string, (e: GestureResponderEvent, g?: any) => boolean | void>): PanResponderInstance;
  };
}

declare module "react-native-safe-area-context" {
  import type { FC, ReactNode } from "react";
  export const SafeAreaProvider: FC<{ children?: ReactNode }>;
  export const SafeAreaView: FC<{ children?: ReactNode; style?: any }>;
  export function useSafeAreaInsets(): { top: number; bottom: number; left: number; right: number };
}

declare module "react-native-gesture-handler" {
  import type { FC, ReactNode } from "react";
  export const GestureHandlerRootView: FC<{ children?: ReactNode; style?: any }>;
  export const GestureDetector: FC<{ gesture: any; children?: ReactNode }>;
  interface GesturePoint { x: number; y: number; }
  interface PanGesture {
    onBegin(cb: (e: GesturePoint) => void): this;
    onUpdate(cb: (e: GesturePoint) => void): this;
    onEnd(cb: () => void): this;
    onFinalize(cb: () => void): this;
    minDistance(n: number): this;
    averageTouches(b: boolean): this;
    [key: string]: any;
  }
  export const Gesture: {
    Pan(): PanGesture;
    Tap(): any;
    Simultaneous(...gestures: any[]): any;
    Race(...gestures: any[]): any;
  };
}

declare module "react-native-svg" {
  import type { FC, ReactNode } from "react";
  const Svg: FC<{
    children?: ReactNode;
    width?: number | string;
    height?: number | string;
    viewBox?: string;
    [key: string]: any;
  }>;
  export default Svg;
  export const Path: FC<{ d?: string; stroke?: string; strokeWidth?: number; fill?: string; [key: string]: any }>;
  export const Circle: FC<any>;
  export const Rect: FC<any>;
  export const G: FC<{ children?: ReactNode; [key: string]: any }>;
}

declare module "expo" {
  export function registerRootComponent(component: any): void;
}

declare module "expo/config" {
  export interface ExpoConfig {
    name: string;
    slug: string;
    version?: string;
    [key: string]: any;
  }
}

declare module "expo-status-bar" {
  import type { FC } from "react";
  export const StatusBar: FC<{ style?: "auto" | "light" | "dark"; [key: string]: any }>;
}

declare module "expo-constants" {
  interface ExpoConfig { extra?: Record<string, any>; [key: string]: any; }
  interface Manifest2 { extra?: Record<string, any>; [key: string]: any; }
  const Constants: {
    expoConfig?: ExpoConfig | null;
    manifest2?: Manifest2 | null;
    isDevice: boolean;
    platform?: Record<string, any>;
    [key: string]: any;
  };
  export default Constants;
}

declare module "expo-sqlite" {
  export interface SQLiteDatabase {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, params?: (string | number | null | undefined)[]): Promise<void>;
    getAllAsync<T>(sql: string, params?: (string | number | null | undefined)[]): Promise<T[]>;
    getFirstAsync<T>(sql: string, params?: (string | number | null | undefined)[]): Promise<T | undefined>;
  }
  export function openDatabaseAsync(name: string): Promise<SQLiteDatabase>;
}

declare module "expo-network" {
  export interface NetworkState {
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
    type?: string;
  }
  export function getNetworkStateAsync(): Promise<NetworkState>;
}

declare module "expo-file-system" {
  export const documentDirectory: string | null;
  export const cacheDirectory: string | null;
  export const EncodingType: { Base64: string; UTF8: string };
  export const FileSystemUploadType: { BINARY_CONTENT: number; MULTIPART: number };
  export interface UploadResult {
    status: number;
    headers: Record<string, string>;
    body: string;
  }
  export function uploadAsync(url: string, fileUri: string, options?: Record<string, any>): Promise<UploadResult>;
  export function downloadAsync(uri: string, fileUri: string, options?: Record<string, any>): Promise<{ uri: string; status: number }>;
  export function writeAsStringAsync(fileUri: string, contents: string, options?: Record<string, any>): Promise<void>;
  export function getInfoAsync(fileUri: string): Promise<{ exists: boolean; isDirectory: boolean; size?: number; uri: string }>;
  export function deleteAsync(fileUri: string, options?: { idempotent?: boolean }): Promise<void>;
  export function makeDirectoryAsync(fileUri: string, options?: { intermediates?: boolean }): Promise<void>;
}

declare module "expo-application" {
  export const nativeApplicationVersion: string | null;
  export const nativeBuildVersion: string | null;
  export const applicationId: string | null;
  export function getAndroidId(): string | null;
  export function getIosIdForVendorAsync(): Promise<string | null>;
}

declare module "expo-device" {
  export const modelName: string | null;
  export const deviceName: string | null;
  export const osName: string | null;
  export const osVersion: string | null;
  export const brand: string | null;
  export const isDevice: boolean;
  export const DeviceType: Record<string, number>;
  export function getDeviceTypeAsync(): Promise<number>;
}

declare module "expo-background-fetch" {
  export enum BackgroundFetchResult {
    NewData = 1,
    NoData = 2,
    Failed = 3,
  }
  export interface BackgroundFetchOptions {
    minimumInterval?: number;
    stopOnTerminate?: boolean;
    startOnBoot?: boolean;
  }
  export function registerTaskAsync(taskName: string, options?: BackgroundFetchOptions): Promise<void>;
  export function unregisterTaskAsync(taskName: string): Promise<void>;
  export function getStatusAsync(): Promise<number | null>;
}

declare module "expo-task-manager" {
  export function defineTask(taskName: string, task: (params: any) => any): void;
  export function isTaskRegisteredAsync(taskName: string): Promise<boolean>;
  export function unregisterAllTasksAsync(): Promise<void>;
}

declare module "expo-notifications" {
  export interface NotificationContent {
    title?: string;
    body?: string;
    data?: Record<string, any>;
    [key: string]: any;
  }
  export interface Notification {
    request: { content: NotificationContent };
  }
  export interface NotificationHandler {
    handleNotification(notification: Notification): Promise<{
      shouldShowAlert: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }
  export function setNotificationHandler(handler: NotificationHandler): void;
  export function getExpoPushTokenAsync(options?: { projectId?: string }): Promise<{ data: string }>;
  export function getPermissionsAsync(): Promise<{ status: string; granted: boolean }>;
  export function requestPermissionsAsync(): Promise<{ status: string; granted: boolean }>;
  export interface NotificationResponse {
    notification: Notification;
    actionIdentifier?: string;
  }
  export interface Subscription { remove(): void }
  export function addNotificationReceivedListener(listener: (notification: Notification) => void): Subscription;
  export function addNotificationResponseReceivedListener(listener: (response: NotificationResponse) => void): Subscription;
  export function addPushTokenListener(listener: (ev: { data: string; type?: string }) => void): Subscription;
  export function getLastNotificationResponseAsync(): Promise<NotificationResponse | null>;
  export const AndroidImportance: Record<string, number>;
  export function setNotificationChannelAsync(channelId: string, channel: Record<string, any>): Promise<void>;
}

declare module "expo-secure-store" {
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(key: string, value: string): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}

declare module "expo-image-picker" {
  export interface ImagePickerAsset {
    uri: string;
    width: number;
    height: number;
    type?: "image" | "video";
    fileName?: string;
    fileSize?: number;
    base64?: string;
    mimeType?: string;
  }
  export type ImagePickerResult =
    | { canceled: true; assets: null }
    | { canceled: false; assets: ImagePickerAsset[] };
  export function launchImageLibraryAsync(options?: Record<string, any>): Promise<ImagePickerResult>;
  export function launchCameraAsync(options?: Record<string, any>): Promise<ImagePickerResult>;
  export function requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  export function requestCameraPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  export const MediaTypeOptions: Record<string, string>;
}

declare module "expo-av" {
  export interface AVPlaybackStatus {
    isLoaded: boolean;
    [key: string]: any;
  }
  export interface Recording {
    prepareToRecordAsync(options?: any): Promise<void>;
    startAsync(): Promise<void>;
    stopAndUnloadAsync(): Promise<AVPlaybackStatus>;
    getURI(): string | undefined;
  }
  export namespace Audio {
    class Recording {
      prepareToRecordAsync(options?: any): Promise<void>;
      startAsync(): Promise<void>;
      stopAndUnloadAsync(): Promise<AVPlaybackStatus>;
      getURI(): string | undefined;
      static createAsync(options?: any): Promise<{ recording: Recording }>;
    }
    const RecordingOptionsPresets: Record<string, any>;
    function requestPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
    function setAudioModeAsync(mode: Record<string, any>): Promise<void>;
  }
}

declare module "expo-camera" {
  import type { FC, ReactNode } from "react";
  export interface BarcodeScanningResult {
    type: string;
    data: string;
    cornerPoints?: Array<{ x: number; y: number }>;
    bounds?: { origin: { x: number; y: number }; size: { width: number; height: number } };
  }
  export interface CameraPermissionResponse {
    granted: boolean;
    status: string;
    canAskAgain: boolean;
  }
  export function useCameraPermissions(): [CameraPermissionResponse | null, () => Promise<CameraPermissionResponse>];
  export const CameraView: FC<{
    children?: ReactNode;
    style?: any;
    facing?: "front" | "back";
    onBarcodeScanned?: (result: BarcodeScanningResult) => void;
    barcodeScannerSettings?: Record<string, any>;
    [key: string]: any;
  }>;
}

declare module "expo-location" {
  export interface LocationObject {
    coords: {
      latitude: number;
      longitude: number;
      altitude?: number | null;
      accuracy?: number | null;
      speed?: number | null;
      heading?: number | null;
    };
    timestamp: number;
  }
  export function requestForegroundPermissionsAsync(): Promise<{ granted: boolean; status: string }>;
  export function getCurrentPositionAsync(options?: Record<string, any>): Promise<LocationObject>;
}

declare module "expo-sharing" {
  export function shareAsync(url: string, options?: Record<string, any>): Promise<void>;
  export function isAvailableAsync(): Promise<boolean>;
}

declare module "react-native-pdf" {
  import type { FC } from "react";
  interface PdfProps {
    source: { uri: string; cache?: boolean; headers?: Record<string, string> };
    style?: any;
    onLoadComplete?: (numberOfPages: number, filePath: string) => void;
    onPageChanged?: (page: number, numberOfPages: number) => void;
    onError?: (err: unknown) => void;
    trustAllCerts?: boolean;
    enablePaging?: boolean;
    enableAnnotationRendering?: boolean;
    [key: string]: any;
  }
  const Pdf: FC<PdfProps>;
  export default Pdf;
}

declare module "expo-linking" {
  export function openURL(url: string): Promise<void>;
  export function canOpenURL(url: string): Promise<boolean>;
  export function createURL(path: string, options?: Record<string, any>): string;
  export function parse(url: string): { path: string | null; queryParams: Record<string, string> };
  export function addEventListener(type: string, handler: (event: { url: string }) => void): { remove(): void };
  export const useURL: () => string | null;
}

declare module "expo-web-browser" {
  export interface WebBrowserAuthSessionResult {
    type: "success" | "cancel" | "dismiss" | "locked";
    url?: string;
  }
  export function openAuthSessionAsync(url: string, redirectUrl?: string): Promise<WebBrowserAuthSessionResult>;
  export function openBrowserAsync(url: string): Promise<{ type: string }>;
  export function dismissBrowser(): void;
  export function maybeCompleteAuthSession(options?: Record<string, any>): { type: string };
}

declare module "@react-navigation/native" {
  import type { FC, ReactNode } from "react";
  export type NavigationProp<T extends Record<string, any> = Record<string, never>> = {
    navigate(name: keyof T, params?: any): void;
    goBack(): void;
    setOptions(options: Record<string, any>): void;
    canGoBack(): boolean;
    getState(): any;
    isReady?(): boolean;
  };
  export type NavigationContainerRef<T extends Record<string, any> = Record<string, any>> = NavigationProp<T> & {
    isReady(): boolean;
    current?: any;
  };
  export function useNavigationContainerRef<T extends Record<string, any> = Record<string, any>>(): NavigationContainerRef<T>;
  export type RouteProp<T extends Record<string, any>, K extends keyof T = keyof T> = {
    key: string;
    name: K;
    params: T[K];
  };
  export function useNavigation<T = NavigationProp>(): T;
  export function useFocusEffect(effect: () => (() => void) | void): void;
  export function useRoute<T = RouteProp<Record<string, any>>>(): T;
  export const NavigationContainer: FC<{ children?: ReactNode; [key: string]: any }>;
}

declare module "@react-navigation/native-stack" {
  import type { FC } from "react";
  interface StackNavigator {
    Navigator: FC<{ children?: any; screenOptions?: any; [key: string]: any }>;
    Screen: FC<{ name: string; component: any; options?: any }>;
  }
  export function createNativeStackNavigator<T extends Record<string, any> = Record<string, undefined>>(): StackNavigator;
}

declare module "@react-navigation/bottom-tabs" {
  import type { FC } from "react";
  interface TabNavigator {
    Navigator: FC<{ children?: any; screenOptions?: any; [key: string]: any }>;
    Screen: FC<{ name: string; component: any; options?: any }>;
  }
  export function createBottomTabNavigator<T extends Record<string, any> = Record<string, undefined>>(): TabNavigator;
}

declare module "@sentry/react-native" {
  export function init(options: { dsn: string; tracesSampleRate?: number; [key: string]: any }): void;
  export function wrap<T>(component: T): T;
  export function captureException(exception: any, hint?: any): string;
  export function captureMessage(message: string, level?: string): string;
}
