import { EventEmitter, requireNativeModule } from "expo-modules-core";

type NativeViatomModule = {
  requestPermissions(): Promise<boolean>;
  initialize(): Promise<boolean>;
  scan(): Promise<boolean>;
  stopScan(): Promise<boolean>;
  connect(mac: string, model: number): Promise<boolean>;
  disconnect(): Promise<boolean>;
  startRealtime(): Promise<boolean>;
  stopRealtime(): Promise<boolean>;
  getInfo(): Promise<boolean>;
  readHistoryFile(filename: string): Promise<boolean>;
};

const Native: NativeViatomModule = requireNativeModule("Viatom");
const emitter = new EventEmitter(Native as any);

// ----- Types for events from Kotlin -----

export type DeviceFoundEvent = {
  mac: string;
  name: string;
  model: number;
};

export type ConnectedEvent = {
  mac?: string;
  model?: number;
};

export type DisconnectedEvent = {
  mac?: string | null;
  model?: number | null;
  reason?: number;
};

export type ServiceReadyEvent = {
  mac? : string;
}

export type RealtimeEvent = {
  spo2: number;
  pr: number;
  pi: number;
  motion: number;
  ts: number;
};

export type InfoEvent = {
  battery: number;
  state: number;
  files: string[];
};

export type HistoryFileEvent = {
  csv: string;
  startTime: number;
};

export type ReadProgressEvent = {
  progress: number;
};

export type ErrorEvent = {
  code: string;
  message: string;
};

// ----- Simple function wrappers -----

export function requestPermissions() {
  return Native.requestPermissions();
}

export function initialize() {
  return Native.initialize();
}

export function scan() {
  return Native.scan();
}

export function stopScan() {
  return Native.stopScan();
}

export function connect(mac: string, model: number) {
  return Native.connect(mac, model);
}

export function disconnect() {
  return Native.disconnect();
}

export function startRealtime() {
  return Native.startRealtime();
}

export function stopRealtime() {
  return Native.stopRealtime();
}

export function getInfo() {
  return Native.getInfo();
}

export function readHistoryFile(filename: string) {
  return Native.readHistoryFile(filename);
}

// ----- Event listener helpers -----

export function addDeviceFoundListener(
  listener: (e: DeviceFoundEvent) => void
) {
  return emitter.addListener<DeviceFoundEvent>("onDeviceFound", listener);
}

export function addConnectedListener(listener: (e: ConnectedEvent) => void) {
  return emitter.addListener<ConnectedEvent>("onConnected", listener);
}

export function addDisconnectedListener(
  listener: (e: DisconnectedEvent) => void
) {
  return emitter.addListener<DisconnectedEvent>("onDisconnected", listener);
}

export function addServiceReadyListener(
  listener: (e: ServiceReadyEvent) => void
) {
  return emitter.addListener<ServiceReadyEvent>("onServiceReady", listener);
}

export function addRealtimeListener(listener: (e: RealtimeEvent) => void) {
  return emitter.addListener<RealtimeEvent>("onRealtime", listener);
}

export function addInfoListener(listener: (e: InfoEvent) => void) {
  return emitter.addListener<InfoEvent>("onInfo", listener);
}

export function addHistoryFileListener(
  listener: (e: HistoryFileEvent) => void
) {
  return emitter.addListener<HistoryFileEvent>("onHistoryFile", listener);
}

export function addReadProgressListener(
  listener: (e: ReadProgressEvent) => void
) {
  return emitter.addListener<ReadProgressEvent>("onReadProgress", listener);
}

export function addErrorListener(listener: (e: ErrorEvent) => void) {
  return emitter.addListener<ErrorEvent>("onError", listener);
}