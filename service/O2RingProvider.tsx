import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { File as ExpoFile } from "expo-file-system";
import * as O2Ring from "@ios-app/viatom-o2ring";
import { ensureDir } from "./History";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { API_DEV, API_PROD } from "@env";
import { uploadPendingCsvs, UploadItem } from "./History";

const REALTIME_STALE_TIMEOUT_MS = 5000;
const READ_TIMEOUT_MS = 30000;
const MAX_READ_RETRIES = 2;
const HISTORY_DEVICE_KEY = "historyConnectedDevice";
const LEGACY_HISTORY_DEVICE_KEY = "historyConnectedDeviceMac";
const MAX_KNOWN_DEVICES = 5;

type DeviceItem = O2Ring.DeviceFoundEvent;

type Subscription = { remove: () => void };

type O2RingContextValue = {
  initializing: boolean;
  hasPermission: boolean;
  isScanning: boolean;
  connecting: boolean;
  serviceReady: boolean;
  isRealtimeReady: boolean;
  devices: DeviceItem[];
  battery: number | null;
  batteryState: number | null;
  connectedDevice: DeviceItem | null;
  offlineDevice: DeviceItem | null;
  knownDevices: DeviceItem[];
  spo2: number | null;
  pr: number | null;
  realtimeUpdatedAt: number | null;
  isDownloadingHistory: boolean;
  downloadProgress: number;
  downloadTotalFiles: number;
  downloadCompletedFiles: number;
  requestPermissions: () => Promise<boolean>;
  startScan: () => Promise<boolean>;
  stopScan: () => Promise<void>;
  connectToDevice: (device: DeviceItem) => Promise<boolean>;
  forgetDevice: (device: DeviceItem) => void;
  tempForgetDevice: (device: DeviceItem) => void;
  disconnect: () => Promise<void>;
  clearOfflineDevice: () => void;
  clearDevices: () => void;
  refreshRealtime: () => Promise<boolean>;
  requestHistorySync: () => Promise<boolean>;
};

const O2RingContext = createContext<O2RingContextValue | null>(null);

export function O2RingProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<DeviceItem | null>(
    null
  );
  const [offlineDevice, setOfflineDevice] = useState<DeviceItem | null>(null);
  const [knownDevices, setKnownDevices] = useState<DeviceItem[]>([]);
  const [serviceReady, setServiceReady] = useState(
    Platform.OS === "android" ? true : false
  );
  const [iosRealtimeReady, setIosRealtimeReady] = useState(
    Platform.OS === "android"
  );
  const [battery, setBattery] = useState<number | null>(null);
  const [batteryState, setBatteryState] = useState<number | null>(null);
  const [spo2, setSpo2] = useState<number | null>(null);
  const [pr, setPr] = useState<number | null>(null);
  const [realtimeUpdatedAt, setRealtimeUpdatedAt] = useState<number | null>(
    null
  );
  const [isDownloadingHistory, setIsDownloadingHistory] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadCounts, setDownloadCounts] = useState({
    total: 0,
    completed: 0,
  });
  const [patientId, setPatientId] = useState<string | null>(null);
  const infoRetryTimer = React.useRef<NodeJS.Timeout | null>(null);
  const patientIdRef = React.useRef<string | null>(null);
  const connectedDeviceRef = React.useRef<DeviceItem | null>(null);
  const serviceReadyRef = React.useRef(serviceReady);
  const infoRetryCount = React.useRef(0);
  const intentionalDisconnectRef = React.useRef(false);
  const syncingPatientId = React.useRef<Promise<string | null> | null>(null);
  const readQueue = React.useRef<string[]>([]);
  const currentReading = React.useRef<string | null>(null);
  const readTimeout = React.useRef<NodeJS.Timeout | null>(null);
  const readAttempts = React.useRef<Map<string, number>>(new Map());
  const realtimeStartPromise = React.useRef<Promise<boolean> | null>(null);
  const knownDevicesRef = React.useRef<DeviceItem[]>([]);
  const autoReconnectAttempted = React.useRef(false);
  const autoReconnectScanTimeout = React.useRef<NodeJS.Timeout | null>(null);
  const connectingRef = React.useRef(false);
  const autoConnectingRef = React.useRef(false);
  const autoReconnectEnabled = React.useRef(true);
  const isDownloadingHistoryRef = React.useRef(false);
  const totalFilesToDownload = React.useRef(0);
  const downloadedFiles = React.useRef(0);
  const rawBase = __DEV__ ? API_DEV : API_PROD;
  const baseURL = rawBase?.replace(/\/+$/, "");

  // -------------------
  // MARK: Patient ID
  // -------------------
  /**
   * Read the patient ID from storage once and keep refs/state in sync.
   */
  const syncPatientId = useCallback(async () => {
    if (syncingPatientId.current) return syncingPatientId.current;
    syncingPatientId.current = AsyncStorage.getItem("patientID")
      .then((id) => {
        patientIdRef.current = id;
        setPatientId((prev) => (prev === id ? prev : id));
        return id;
      })
      .catch((e) => {
        console.warn("Error@O2RingProvider.tsx/syncPatientId:", e);
        return null;
      })
      .finally(() => {
        syncingPatientId.current = null;
      });

    return syncingPatientId.current;
  }, []);

  // Load patient ID from AsyncStorage (same key used elsewhere)
  useEffect(() => {
    syncPatientId();
  }, [syncPatientId]);

  // Keep refs updated for listeners without rerunning setup effect
  useEffect(() => {
    patientIdRef.current = patientId;
  }, [patientId]);

  // -------------------
  // MARK: History Download Queue
  // -------------------
  /**
   * Process the next file in the read queue
   */
const processReadQueue = useCallback(() => {
    // If a file is already being read, don't start another one.
    if (currentReading.current != null) return;

    const next = readQueue.current.shift();

    // No more files to read → cleanup and exit.
    if (!next) {
      setIsDownloadingHistory(false);
      setDownloadProgress(0);
      totalFilesToDownload.current = 0;
      downloadedFiles.current = 0;
      setDownloadCounts({ total: 0, completed: 0 });
      readAttempts.current.clear();
      return;
    }

    if (!readAttempts.current.has(next)) {
      readAttempts.current.set(next, 0);
    }

    // Begin reading this file.
    setIsDownloadingHistory(true);
    setDownloadProgress(0);
    currentReading.current = next;

    // Clear any old timeout before starting a new read
    if (readTimeout.current) {
      clearTimeout(readTimeout.current);
      readTimeout.current = null;
    }

    // Start the initial timeout.
    // If device sends no progress at all for READ_TIMEOUT_MS → timeout.
    readTimeout.current = setTimeout(() => {
      const stuckFile = currentReading.current;
      console.warn("Error@O2RingProvider.tsx/read timeout:", stuckFile);
      if (stuckFile) {
        const attempts = readAttempts.current.get(stuckFile) ?? 0;
        const nextAttempts = attempts + 1;
        if (nextAttempts <= MAX_READ_RETRIES) {
          readAttempts.current.set(stuckFile, nextAttempts);
          readQueue.current.push(stuckFile);
        } else {
          readAttempts.current.delete(stuckFile);
        }
      }
      currentReading.current = null;
      readTimeout.current = null;
      processReadQueue();
    }, READ_TIMEOUT_MS);

    // Kick off native read.
    O2Ring.readHistoryFile(next).catch((err) => {
      console.warn("Error@O2RingProvider.tsx/readHistoryFile:", err);

      const failed = currentReading.current;
      if (failed) {
        const attempts = readAttempts.current.get(failed) ?? 0;
        const nextAttempts = attempts + 1;
        if (nextAttempts <= MAX_READ_RETRIES) {
          readAttempts.current.set(failed, nextAttempts);
          readQueue.current.push(failed);
        } else {
          readAttempts.current.delete(failed);
        }
      }

      currentReading.current = null;

      if (readTimeout.current) {
        clearTimeout(readTimeout.current);
        readTimeout.current = null;
      }

      // Skip this file and move to the next.
      processReadQueue();
    });
  }, []);

  /**
   * Enqueue history files to read
   */
  const enqueueHistoryFiles = useCallback(
    (files: string[]) => {
      const newOnes = files.filter(
        (f) => !readQueue.current.includes(f) && currentReading.current !== f
      );
      if (newOnes.length === 0) return;
      newOnes.forEach((f) => {
        if (!readAttempts.current.has(f)) {
          readAttempts.current.set(f, 0);
        }
      });
      const additional = newOnes.length;
      const isFreshBatch =
        !isDownloadingHistoryRef.current &&
        !currentReading.current &&
        readQueue.current.length === 0;

      if (isFreshBatch) {
        totalFilesToDownload.current = additional;
        downloadedFiles.current = 0;
      } else {
        totalFilesToDownload.current += additional;
      }
      setDownloadCounts({
        total: totalFilesToDownload.current,
        completed: downloadedFiles.current,
      });
      readQueue.current.push(...newOnes);
      processReadQueue();
    },
    [processReadQueue]
  );

  // -------------------
  // MARK: O2Ring Connection & Realtime
  // -------------------
  useEffect(() => {
    connectedDeviceRef.current = connectedDevice;
  }, [connectedDevice]);

  useEffect(() => {
    if (connectedDevice && autoReconnectScanTimeout.current) {
      clearTimeout(autoReconnectScanTimeout.current);
      autoReconnectScanTimeout.current = null;
    }
  }, [connectedDevice]);

  useEffect(() => {
    connectingRef.current = connecting;
  }, [connecting]);

  useEffect(() => {
    knownDevicesRef.current = knownDevices;
  }, [knownDevices]);

  useEffect(() => {
    serviceReadyRef.current = serviceReady;
  }, [serviceReady]);

  useEffect(() => {
    isDownloadingHistoryRef.current = isDownloadingHistory;
  }, [isDownloadingHistory]);

  /**
   * Persist and update known devices list (most recent first, unique by MAC)
   */
  const rememberDevice = useCallback((device: DeviceItem) => {
    if (!device?.mac) return;

    setKnownDevices((prev) => {
      const filtered = prev.filter((d) => d.mac !== device.mac);
      const next = [device, ...filtered].slice(0, MAX_KNOWN_DEVICES);
      AsyncStorage.multiSet([
        [HISTORY_DEVICE_KEY, JSON.stringify(next)],
        [LEGACY_HISTORY_DEVICE_KEY, device.mac],
      ]).catch(() => undefined);
      return next;
    });
  }, []);

  const forgetDevice = useCallback((device: DeviceItem) => {
    setKnownDevices((prev) => {
      const filtered = prev.filter((d) => d.mac !== device.mac);

      // Persist removal (clears legacy key too when no devices left)
      const ops: Promise<unknown>[] = [];
      ops.push(
        filtered.length > 0
          ? AsyncStorage.setItem(HISTORY_DEVICE_KEY, JSON.stringify(filtered))
          : AsyncStorage.removeItem(HISTORY_DEVICE_KEY)
      );
      ops.push(
        filtered.length > 0
          ? AsyncStorage.setItem(LEGACY_HISTORY_DEVICE_KEY, filtered[0].mac)
          : AsyncStorage.removeItem(LEGACY_HISTORY_DEVICE_KEY)
      );
      Promise.all(ops).catch(() => undefined);

      return filtered;
    });
  }, []);

  const tempForgetDevice = useCallback((device: DeviceItem) => {
    setKnownDevices((prev) => {
      const filtered = prev.filter((d) => d.mac !== device.mac);
      return filtered;
    });
  }, []);

  // Once connected, keep polling getInfo until native responds so history download always kicks in.
  useEffect(() => {
    if (!connectedDevice || !serviceReady) return;

    let stopped = false;

    const clearTimer = () => {
      if (infoRetryTimer.current) {
        clearInterval(infoRetryTimer.current);
        infoRetryTimer.current = null;
      }
    };

    const attempt = async (label: string) => {
      try {
        // Ensure patient ID is loaded so we can persist files once info arrives.
        await syncPatientId().catch(() => null);
        await startRealtimeStream();
        await O2Ring.getInfo();
      } catch (e) {
        console.warn(`Error@O2RingProvider.tsx/getInfo (${label}): `, e);
      }
    };

    clearTimer();
    infoRetryCount.current = 0;
    attempt("initial");

    const timerId = setInterval(() => {
      if (stopped || !connectedDeviceRef.current) {
        clearTimer();
        return;
      }
      infoRetryCount.current += 1;
      if (infoRetryCount.current > 10) {
        clearTimer();
        return;
      }
      attempt(`retry ${infoRetryCount.current}`);
    }, 4000);
    infoRetryTimer.current = timerId;

    return () => {
      stopped = true;
      clearTimer();
    };
  }, [connectedDevice, serviceReady, startRealtimeStream, syncPatientId]);

  const requestPermissions = useCallback(async () => {
    try {
      const granted = await O2Ring.requestPermissions();
      setHasPermission(!!granted);
      return !!granted;
    } catch (e) {
      console.warn("Error@O2RingProvider.tsx/requestPermissions: ", e);
      setHasPermission(false);
      return false;
    }
  }, []);

  /**
   * Start realtime streaming with retries. BLE can easily stall when the system is busy,
   * so we ensure that only one attempt is active and back off between retries.
   */
  const startRealtimeStream = useCallback(async () => {
    if (realtimeStartPromise.current) {
      return realtimeStartPromise.current;
    }

    // Must have a device
    if (!connectedDeviceRef.current) {
      console.warn("startRealtime: no connected device yet");
      return Promise.resolve(false);
    }

    // On iOS, must wait for serviceReady
    if (Platform.OS === "ios" && !serviceReadyRef.current) {
      console.warn("startRealtime: service not ready yet");
      return Promise.resolve(false);
    }

    if (Platform.OS === "ios") {
      setIosRealtimeReady(false);
    }

    const attempt = async (count: number): Promise<boolean> => {
      try {
        await O2Ring.startRealtime();
        return true;
      } catch (e) {
        console.warn(
          `Error@O2RingProvider.tsx/startRealtime attempt ${count}: `,
          e
        );
        if (count >= 10) return false;
        await new Promise((resolve) => setTimeout(resolve, 500 * count));
        return attempt(count + 1);
      }
    };

    const promise = attempt(1).finally(() => {
      realtimeStartPromise.current = null;
    });

    realtimeStartPromise.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const sub = O2Ring.addServiceReadyListener(() => {
      serviceReadyRef.current = true;
      setServiceReady(true);
      startRealtimeStream();
      syncPatientId()
        .catch(() => null)
        .finally(() => {
          O2Ring.getInfo().catch((err) =>
            console.warn(
              "Error@O2RingProvider.tsx/getInfo (service ready): ",
              err
            )
          );
        });
    });

    return () => sub.remove();
  }, [startRealtimeStream, syncPatientId]);

  useEffect(() => {
    if (Platform.OS === "ios") {
      if (connectedDevice && serviceReady) {
        startRealtimeStream();
      }
    }
  }, [connectedDevice, serviceReady, startRealtimeStream]);

  // -------------------
  // MARK: O2Ring
  // -------------------
  /**
   * Load last connected device (legacy + new format) for auto-reconnect.
   */
  useEffect(() => {
    const loadLastDevice = async () => {
      try {
        const stored = await AsyncStorage.getItem(HISTORY_DEVICE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            const valid = parsed.filter((p) => p?.mac) as DeviceItem[];
            if (valid.length > 0) {
              setKnownDevices(valid.slice(0, MAX_KNOWN_DEVICES));
              return;
            }
          } else if (parsed?.mac) {
            setKnownDevices([parsed as DeviceItem]);
            return;
          }
        }

        const legacyMac = await AsyncStorage.getItem(LEGACY_HISTORY_DEVICE_KEY);
        if (legacyMac) {
          const legacyDevice = { mac: legacyMac, name: "O2Ring", model: 0 };
          setKnownDevices([legacyDevice]);
        }
      } catch (e) {
        console.warn("Error@O2RingProvider.tsx/loadLastDevice: ", e);
      }
    };

    loadLastDevice();

    return () => {
      if (autoReconnectScanTimeout.current) {
        clearTimeout(autoReconnectScanTimeout.current);
        autoReconnectScanTimeout.current = null;
      }
    };
  }, []);

  // Initialize native module + listeners once.
  // Everything inside the setup callback deals with native events so we centralize
  // cleanup logic here as well.
  useEffect(() => {
    let subRt: Subscription | null = null;
    let subErr: Subscription | null = null;
    let subDev: Subscription | null = null;
    let subDisc: Subscription | null = null;
    let subInfo: Subscription | null = null;
    let subProgress: Subscription | null = null;
    let subFile: Subscription | null = null;

    const setup = async () => {
      try {
        await O2Ring.initialize();
      } catch (e) {
        console.warn(
          "Error@O2RingProvider.tsx/initialize: Viatom Initialization Error",
          e
        );
      } finally {
        setInitializing(false);
      }

      subRt = O2Ring.addRealtimeListener((rt) => {
        setSpo2(rt.spo2);
        setPr(rt.pr);
        setRealtimeUpdatedAt(Date.now());
        if (Platform.OS === "ios") {
          setIosRealtimeReady((prev) => (prev ? prev : true));
        }
      });

      subErr = O2Ring.addErrorListener((err) => {
        console.log("Error@O2RingProvider.tsx/error: Viatom error", err);
        if (err?.code === "READ_FILE_ERROR") {
          const failed = currentReading.current;
          if (failed) {
            const attempts = readAttempts.current.get(failed) ?? 0;
            const nextAttempts = attempts + 1;
            if (nextAttempts <= MAX_READ_RETRIES) {
              readAttempts.current.set(failed, nextAttempts);
              readQueue.current.push(failed);
            } else {
              readAttempts.current.delete(failed);
            }
          }
          currentReading.current = null;
          processReadQueue();
        }
        if (
          Platform.OS === "ios" &&
          (err?.code === "COMMAND_SEND_FAILED" ||
            err?.code === "SERVICE_NOT_READY")
        ) {
          setIosRealtimeReady(false);
        }
      });

      subDev = O2Ring.addDeviceFoundListener((dev) => {
        setDevices((prev) => {
          const exists = prev.some((item) => item.mac === dev.mac);
          return exists ? prev : [...prev, dev];
        });

        const target = knownDevicesRef.current.find((d) => d.mac === dev.mac);
        if (
          target &&
          !connectedDeviceRef.current &&
          !connectingRef.current &&
          !autoConnectingRef.current &&
          autoReconnectEnabled.current
        ) {
          autoConnectingRef.current = true;
          connectToDevice(dev)
            .catch((err) =>
              console.warn(
                "Error@O2RingProvider.tsx/autoConnect previous device: ",
                err
              )
            )
            .finally(() => {
              autoConnectingRef.current = false;
            });
        }
      });

      subDisc = O2Ring.addDisconnectedListener(() => {
        const prevDevice = connectedDeviceRef.current;
        const wasIntentional = intentionalDisconnectRef.current;
        const isConnecting = connectingRef.current;
        if (!wasIntentional && !isConnecting && prevDevice) {
          setOfflineDevice(prevDevice);
        } else {
          setOfflineDevice(null);
        }
        intentionalDisconnectRef.current = false;
        setConnectedDevice(null);
        setSpo2(null);
        setPr(null);
        setBattery(null);
        setBatteryState(null);
        setRealtimeUpdatedAt(null);
        readQueue.current = [];
        currentReading.current = null;
        readAttempts.current.clear();
        setIsDownloadingHistory(false);
        setDownloadProgress(0);
        totalFilesToDownload.current = 0;
        downloadedFiles.current = 0;
        setDownloadCounts({ total: 0, completed: 0 });
        setServiceReady(Platform.OS === "android");
        setIosRealtimeReady(Platform.OS === "android");
      });

      subInfo = O2Ring.addInfoListener(async (info) => {
        // Stop retries once we got a response
        if (infoRetryTimer.current) {
          clearInterval(infoRetryTimer.current);
          infoRetryTimer.current = null;
          infoRetryCount.current = 0;
        }

        setBattery(
          (() => {
            const parsed =
              typeof info.battery === "number" && Number.isFinite(info.battery)
                ? info.battery
                : typeof info.battery === "string"
                ? parseInt(info.battery.match(/-?\d+/)?.[0] ?? "", 10)
                : null;

            return typeof parsed === "number" && !Number.isNaN(parsed)
              ? Math.max(0, Math.min(100, parsed))
              : null;
          })()
        );

        setBatteryState(
          (() => {
            const parsed =
              typeof info.batteryState === "number" &&
              Number.isFinite(info.batteryState)
                ? info.batteryState
                : typeof info.batteryState === "string"
                ? parseInt(info.batteryState.match(/-?\d+/)?.[0] ?? "", 10)
                : null;

            return typeof parsed === "number" && !Number.isNaN(parsed)
              ? Math.max(0, Math.min(3, parsed))
              : null;
          })()
        );

        const patient =
          patientIdRef.current ?? (await syncPatientId().catch(() => null));

        if (!patient) {
          console.warn(
            "Error@O2RingProvider.tsx/infoListener: Info received but patient ID not loaded yet; will retry once patient ID is available."
          );
          return;
        }

        // Normalize file IDs to avoid whitespace or empty entries breaking downloads
        const fileIds = Array.from(
          new Set(
            (info.files ?? [])
              .map((id) => (typeof id === "string" ? id.trim() : ""))
              .filter(Boolean)
          )
        );

        if (fileIds.length > 0) {
          try {
            // Read existing CSVs and extract their 14-digit timestamps
            const existingTs = await getExistingTimestampsForPatient(patient);

            // Only download files that are NOT already stored locally
            const missing = fileIds.filter((id) => !existingTs.has(id));

            if (missing.length > 0) {
              enqueueHistoryFiles(missing);
            } else {
              // Nothing new to download -> ensure modal stays hidden
              setIsDownloadingHistory(false);
              setDownloadProgress(0);
              totalFilesToDownload.current = 0;
              downloadedFiles.current = 0;
              setDownloadCounts({ total: 0, completed: 0 });
            }
          } catch (err) {
            console.warn("Error@O2RingProvider.tsx/subInfo filter: ", err);
            // Fallback: if something goes wrong, keep old behaviour
            enqueueHistoryFiles(info.files);
          }
        }
      });

      subProgress = O2Ring.addReadProgressListener((progress) => {
        // Any progress means "we're alive" → reset timeout
        if (readTimeout.current) {
          clearTimeout(readTimeout.current);
          readTimeout.current = null;
        }

        setIsDownloadingHistory(true);
        setDownloadProgress(Math.min(100, Math.max(0, progress.progress)));

        // Start a fresh "no-progress" timeout tied to the current file
        const current = currentReading.current;
        if (current) {
          readTimeout.current = setTimeout(() => {
            console.warn("Error@O2RingProvider.tsx/read timeout:", current);
            currentReading.current = null;
            readTimeout.current = null;
            processReadQueue();
          }, READ_TIMEOUT_MS);
        }
      });

      subFile = O2Ring.addHistoryFileListener(async (file) => {
        const deviceForSave = connectedDeviceRef.current;

        try {
          const patient = patientIdRef.current ?? (await syncPatientId());
          if (!patient) {
            throw new Error("No patient ID available to save history file");
          }
          const serial = deviceForSave?.name ?? "O2Ring";
          const saved = await saveCsv(
            file.csv,
            file.startTime,
            serial,
            patient
          );

          // Attempt immediate upload for newly downloaded file (best-effort; falls back to History screen auto-upload)
          if (baseURL) {
            const uploaded = await uploadPendingCsvs({
              patientId: patient,
              items: saved ? [saved] : [],
              baseURL,
            });
            if (uploaded.length === 0) {
              console.warn("O2RingProvider: auto-upload skipped or failed");
            }
          }
        } catch (err) {
          console.warn("Error@O2RingProvider.tsx/saveCsv: ", err);
        } finally {
          const finished = currentReading.current;
          if (finished) {
            readAttempts.current.delete(finished);
          }
          currentReading.current = null;
          downloadedFiles.current += 1;
          setDownloadCounts({
            total: totalFilesToDownload.current,
            completed: downloadedFiles.current,
          });
          setDownloadProgress(100);
          if (readTimeout.current) {
            clearTimeout(readTimeout.current);
            readTimeout.current = null;
          }
          processReadQueue();
        }
      });
    };

    setup();

    return () => {
      subRt?.remove();
      subErr?.remove();
      subDev?.remove();
      subDisc?.remove();
      subInfo?.remove();
      subProgress?.remove();
      subFile?.remove();
      if (infoRetryTimer.current) {
        clearInterval(infoRetryTimer.current);
        infoRetryTimer.current = null;
      }
      if (readTimeout.current) {
        clearTimeout(readTimeout.current);
        readTimeout.current = null;
      }
    };
  }, []);

  /**
   * Start scanning for O2Ring devices
   */
  const startScan = useCallback(async () => {
    const ok = hasPermission ? true : await requestPermissions();
    if (!ok) return false;

    setDevices([]);
    setIsScanning(true);
    try {
      await O2Ring.scan();
      return true;
    } catch (e) {
      console.warn("Error@O2RingProvider.tsx/startScan: ", e);
      setIsScanning(false);
      return false;
    }
  }, [hasPermission, requestPermissions]);

  const stopScan = useCallback(async () => {
    setIsScanning(false);
    try {
      await O2Ring.stopScan();
    } catch (e) {
      console.warn("Error@O2RingProvider.tsx/stopScan: ", e);
    }
  }, []);

  /**
   * Auto-scan once for the last connected device and attempt reconnect.
   */
  useEffect(() => {
    if (knownDevices.length === 0) return;
    if (connectedDeviceRef.current || connectingRef.current) return;
    if (autoReconnectAttempted.current) return;

    autoReconnectAttempted.current = true;

    const run = async () => {
      const started = await startScan();
      if (!started) return;

      if (autoReconnectScanTimeout.current) {
        clearTimeout(autoReconnectScanTimeout.current);
      }

      autoReconnectScanTimeout.current = setTimeout(() => {
        autoReconnectScanTimeout.current = null;
        stopScan();
      }, 10000);
    };

    run();
  }, [knownDevices, startScan, stopScan]);

  /**
   * Connect to a given O2Ring device
   * @param device Device to connect to
   * @returns Whether realtime streaming started successfully
   */
    const connectToDevice = useCallback(
      async (device: DeviceItem) => {
        // Any manual connect should re-enable auto-reconnect until the user explicitly disconnects again.
        autoReconnectEnabled.current = true;
        setConnecting(true);
        connectingRef.current = true;
        try {
          await O2Ring.stopScan().catch(() => undefined);
          setIsScanning(false);

          const current = connectedDeviceRef.current;
          const switchingDevice = current?.mac && current.mac !== device.mac;

          if (switchingDevice) {
            try {
              intentionalDisconnectRef.current = true;
              await O2Ring.disconnect();
            } catch (err) {
              console.warn(
                "Error@O2RingProvider.tsx/connectToDevice pre-disconnect: ",
                err
              );
              intentionalDisconnectRef.current = false;
            }
          }

          await syncPatientId();
          setOfflineDevice(null);

          readQueue.current = [];
          currentReading.current = null;
          readAttempts.current.clear();
          setSpo2(null);
        setPr(null);
        setBattery(null);
        setRealtimeUpdatedAt(null);

        // Reset serviceReady for iOS when starting a fresh connection
        if (Platform.OS === "ios") {
          setServiceReady(false);
        }
        setIosRealtimeReady(Platform.OS === "android");

        await O2Ring.connect(device.mac, device.model);

        // Mark as connected; realtime will start when onServiceReady fires
        setConnectedDevice(device);
        rememberDevice(device);

          return true;
        } catch (e) {
          console.warn("Error@O2RingProvider.tsx/connectToDevice: ", e);
          return false;
        } finally {
          setConnecting(false);
          connectingRef.current = false;
        }
      },
      [syncPatientId]
    );

  /**
   * Disconnect from the current device
   */
  const disconnect = useCallback(async () => {
    try {
      intentionalDisconnectRef.current = true;
      await O2Ring.disconnect();
    } catch (e) {
      console.warn("Error@O2RingProvider.tsx/disconnect: ", e);
      intentionalDisconnectRef.current = false;
    }
    // Disable auto-reconnect after an explicit user disconnect.
    autoReconnectEnabled.current = false;
    if (infoRetryTimer.current) {
      clearInterval(infoRetryTimer.current);
      infoRetryTimer.current = null;
      infoRetryCount.current = 0;
    }
    if (readTimeout.current) {
      clearTimeout(readTimeout.current);
      readTimeout.current = null;
    }
    readQueue.current = [];
    currentReading.current = null;
    readAttempts.current.clear();
    setConnectedDevice(null);
    setSpo2(null);
    setPr(null);
    setRealtimeUpdatedAt(null);
    setIsDownloadingHistory(false);
    setDownloadProgress(0);
    totalFilesToDownload.current = 0;
    downloadedFiles.current = 0;
    setDownloadCounts({ total: 0, completed: 0 });
    setServiceReady(Platform.OS === "android");
    setIosRealtimeReady(Platform.OS === "android");
    setOfflineDevice(null);
  }, []);

  /**
   * Manually restart realtime streaming if the UI needs a fresh feed
   */
  const refreshRealtime = useCallback(async () => {
    if (!connectedDeviceRef.current) return false;

    const now = Date.now();
    if (
      realtimeUpdatedAt &&
      now - realtimeUpdatedAt < REALTIME_STALE_TIMEOUT_MS
    ) {
      return true;
    }

    if (Platform.OS === "ios" && iosRealtimeReady) {
      setIosRealtimeReady(false);
    }

    return startRealtimeStream();
  }, [iosRealtimeReady, realtimeUpdatedAt, startRealtimeStream]);

  const clearDevices = useCallback(() => setDevices([]), []);
  const clearOfflineDevice = useCallback(
    () => setOfflineDevice(null),
    []
  );

  /**
   * Manually trigger a history sync (pull-to-refresh in History screen)
   */
  const requestHistorySync = useCallback(async () => {
    if (!connectedDeviceRef.current) {
      console.warn("requestHistorySync: no connected device");
      return false;
    }
    if (Platform.OS === "ios" && !serviceReadyRef.current) {
      console.warn("requestHistorySync: service not ready yet");
      return false;
    }
    try {
      await syncPatientId().catch(() => null);
      await startRealtimeStream();
      await O2Ring.getInfo();
      return true;
    } catch (e) {
      console.warn("Error@O2RingProvider.tsx/requestHistorySync: ", e);
      return false;
    }
  }, [startRealtimeStream, syncPatientId]);

  // MARK: Helper
  /**
   * Helper to save a CSV file for a given patient
   * @param csv CSV content
   * @param startTime Unix timestamp (seconds)
   * @param serial Device serial number
   * @param patientId Patient Id
   */
  const saveCsv = async (
    csv: string,
    startTime: number,
    serial: string,
    patientId: string
  ): Promise<UploadItem | null> => {
    // 1. Convert all ISO timestamps in the CSV to match ViHealth export format: "HH:MM:SS Mon DD YYYY"
    const formattedCsv = csv.replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,
      (iso) => {
        const d = new Date(iso);
        const pad = (n: number) => n.toString().padStart(2, "0");
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        const ss = pad(d.getSeconds());
        const mon = months[d.getMonth()];
        const dd = pad(d.getDate());
        const yyyy = d.getFullYear();
        return `${hh}:${mm}:${ss} ${mon} ${dd} ${yyyy}`;
      }
    );

    // 2. Build filename
    const last4 = serial.slice(-4);
    const ts = new Date(startTime * 1000);
    const pad = (n: number) => n.toString().padStart(2, "0");
    const fileName = `O2Ring ${last4}_${ts.getFullYear()}${pad(
      ts.getMonth() + 1
    )}${pad(ts.getDate())}${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(
      ts.getSeconds()
    )}.csv`;

    const dir = await ensureDir(patientId);
    const file = new ExpoFile(dir, fileName);

    if (file.exists) await file.delete();

    // 3. Write the modified CSV instead of original
    await file.write(formattedCsv, { encoding: "utf8" });

    return { id: fileName, uri: file.uri };
  };

  const isRealtimeReady =
    Platform.OS === "android"
      ? !!connectedDevice
      : serviceReady && iosRealtimeReady && !!connectedDevice;

  const value = useMemo(
    () => ({
      initializing,
      hasPermission,
      isScanning,
      connecting,
      serviceReady,
      isRealtimeReady,
      devices,
      battery,
      batteryState,
      connectedDevice,
      offlineDevice,
      knownDevices,
      spo2,
      pr,
      realtimeUpdatedAt,
      isDownloadingHistory,
      downloadProgress,
      downloadTotalFiles: downloadCounts.total,
      downloadCompletedFiles: downloadCounts.completed,
      requestPermissions,
      startScan,
      stopScan,
      connectToDevice,
      forgetDevice,
      tempForgetDevice,
      disconnect,
      clearOfflineDevice,
      clearDevices,
      refreshRealtime,
      requestHistorySync,
    }),
    [
      initializing,
      hasPermission,
      isScanning,
      connecting,
      serviceReady,
      isRealtimeReady,
      devices,
      battery,
      batteryState,
      connectedDevice,
      offlineDevice,
      knownDevices,
      spo2,
      pr,
      realtimeUpdatedAt,
      isDownloadingHistory,
      downloadProgress,
      downloadCounts.total,
      downloadCounts.completed,
      requestPermissions,
      startScan,
      stopScan,
      connectToDevice,
      forgetDevice,
      tempForgetDevice,
      disconnect,
      clearOfflineDevice,
      clearDevices,
      refreshRealtime,
      requestHistorySync,
    ]
  );

  return (
    <O2RingContext.Provider value={value}>{children}</O2RingContext.Provider>
  );
}

export function useO2Ring() {
  const ctx = useContext(O2RingContext);
  if (!ctx) {
    throw new Error("useO2Ring must be used inside O2RingProvider");
  }
  return ctx;
}

export type { DeviceItem };

/**
 * Helper to get existing history timestamps for a given patient
 * @param patientId patient Id
 * @returns The last 14-digit timestamps extracted from existing CSV filenames for the given patient
 */
const getExistingTimestampsForPatient = async (patientId: string) => {
  try {
    const dir = await ensureDir(patientId);
    const entries = await dir.list();
    const files = entries.filter((e): e is ExpoFile => e instanceof ExpoFile);

    const existing = new Set<string>();

    for (const f of files) {
      if (!f.name.toLowerCase().endsWith(".csv")) continue;

      // Same logic as formatFileName() in History screen
      const base = f.name.replace(/\.csv$/i, "");
      const parts = base.split("_");
      const coreRaw = parts[parts.length - 1] ?? base;
      const core = coreRaw.trim();

      // We only care about filenames that end with a 14-digit timestamp
      if (/^\d{14}$/.test(core)) {
        existing.add(core); // e.g. "20251126132744"
      }
    }

    return existing;
  } catch (e) {
    console.warn(
      "Error@O2RingProvider.tsx/getExistingTimestampsForPatient: ",
      e
    );
    return new Set<string>();
  }
};
