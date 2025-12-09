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

const REALTIME_STALE_TIMEOUT_MS = 5000;

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
  connectedDevice: DeviceItem | null;
  spo2: number | null;
  pr: number | null;
  realtimeUpdatedAt: number | null;
  isDownloadingHistory: boolean;
  downloadProgress: number;
  requestPermissions: () => Promise<boolean>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connectToDevice: (device: DeviceItem) => Promise<boolean>;
  disconnect: () => Promise<void>;
  clearDevices: () => void;
  refreshRealtime: () => Promise<boolean>;
};

const O2RingContext = createContext<O2RingContextValue | null>(null);

/**
 * Orchestrates the lifecycle of the native Viatom O2Ring module.
 * Handles scanning, connections, realtime streaming, and serialised history downloads
 * so consuming screens only have to read values from this context.
 */
export function O2RingProvider({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const [hasPermission, setHasPermission] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<DeviceItem | null>(
    null
  );
  const [serviceReady, setServiceReady] = useState(
    Platform.OS === "android" ? true : false
  );
  const [iosRealtimeReady, setIosRealtimeReady] = useState(
    Platform.OS === "android"
  );
  const [spo2, setSpo2] = useState<number | null>(null);
  const [pr, setPr] = useState<number | null>(null);
  const [realtimeUpdatedAt, setRealtimeUpdatedAt] = useState<number | null>(
    null
  );
  const [isDownloadingHistory, setIsDownloadingHistory] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [patientId, setPatientId] = useState<string | null>(null);
  const infoRetryTimer = React.useRef<NodeJS.Timeout | null>(null);
  const patientIdRef = React.useRef<string | null>(null);
  const connectedDeviceRef = React.useRef<DeviceItem | null>(null);
  const serviceReadyRef = React.useRef(serviceReady);
  const infoRetryCount = React.useRef(0);
  const syncingPatientId = React.useRef<Promise<string | null> | null>(null);
  const readQueue = React.useRef<string[]>([]);
  const currentReading = React.useRef<string | null>(null);
  const readTimeout = React.useRef<NodeJS.Timeout | null>(null);
  const realtimeStartPromise = React.useRef<Promise<boolean> | null>(null);

  // -------------------
  // Patient ID sync
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

  /**
   * Process the next file in the read queue
   */
  const processReadQueue = useCallback(() => {
    if (currentReading.current != null) return;
    const next = readQueue.current.shift();
    if (!next) {
      setIsDownloadingHistory(false);
      setDownloadProgress(0);
      return;
    }
    setIsDownloadingHistory(true);
    setDownloadProgress(0);
    currentReading.current = next;
    O2Ring.readHistoryFile(next).catch((err) => {
      console.warn("Error@O2RingProvider.tsx/readHistoryFile: ", err);
      currentReading.current = null;
      if (readTimeout.current) {
        clearTimeout(readTimeout.current);
        readTimeout.current = null;
      }
      processReadQueue();
    });

    // Failsafe: if native never returns progress/complete, advance the queue.
    if (readTimeout.current) {
      clearTimeout(readTimeout.current);
    }
    readTimeout.current = setTimeout(() => {
      console.warn("Error@O2RingProvider.tsx/read timeout: ", next);
      currentReading.current = null;
      readTimeout.current = null;
      processReadQueue();
    }, 15000);
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
      readQueue.current.push(...newOnes);
      processReadQueue();
    },
    [processReadQueue]
  );

  // Keep refs updated for listeners without rerunning setup effect
  useEffect(() => {
    patientIdRef.current = patientId;
  }, [patientId]);

  useEffect(() => {
    connectedDeviceRef.current = connectedDevice;
  }, [connectedDevice]);

  useEffect(() => {
    serviceReadyRef.current = serviceReady;
  }, [serviceReady]);

  // Once we have a patient ID and a connected device, request info so files can download.
  useEffect(() => {
    if (!connectedDevice || !patientIdRef.current) return;
    infoRetryCount.current = 0;

    if (!serviceReady) return;

    O2Ring.getInfo().catch((e) =>
      console.warn("Error@O2RingProvider.tsx/getInfo (patient sync): ", e)
    );
  }, [connectedDevice, patientId, serviceReady]);

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

  // On iOS retry bootstrap commands (realtime + info) until native responds.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!connectedDevice || !serviceReady) return;

    const attempt = () => {
      startRealtimeStream();
      O2Ring.getInfo().catch((err) =>
        console.warn("Error@O2RingProvider.tsx/getInfo (retry): ", err)
      );
    };

    attempt();
    infoRetryCount.current = 1;
    const timerId = setInterval(() => {
      infoRetryCount.current += 1;
      if (infoRetryCount.current > 10) {
        clearInterval(timerId);
        if (infoRetryTimer.current === timerId) {
          infoRetryTimer.current = null;
        }
        return;
      }
      attempt();
    }, 4000);
    infoRetryTimer.current = timerId;

    return () => {
      clearInterval(timerId);
      if (infoRetryTimer.current === timerId) {
        infoRetryTimer.current = null;
      }
    };
  }, [connectedDevice, serviceReady, startRealtimeStream]);



  // -------------------
  // O2Ring
  // -------------------
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
      });

      subDisc = O2Ring.addDisconnectedListener(() => {
        console.log("JS onDisconnected");
        setConnectedDevice(null);
        setSpo2(null);
        setPr(null);
        setRealtimeUpdatedAt(null);
        setIsDownloadingHistory(false);
        setDownloadProgress(0);
        setServiceReady(Platform.OS === "android");
        setIosRealtimeReady(Platform.OS === "android");
      });

      subInfo = O2Ring.addInfoListener(async (info) => {
        // Stop retries once we got a response
        if (infoRetryTimer.current) {
          clearTimeout(infoRetryTimer.current);
          infoRetryTimer.current = null;
          infoRetryCount.current = 0;
        }

        const patient =
          patientIdRef.current ?? (await syncPatientId().catch(() => null));

        if (!patient) {
          console.warn(
            "Error@O2RingProvider.tsx/infoListener: Info received but patient ID not loaded yet; will retry once patient ID is available."
          );
          return;
        }

        if (info.files && info.files.length > 0) {
          try {
            // Read existing CSVs and extract their 14-digit timestamps
            const existingTs = await getExistingTimestampsForPatient(patient);

            // Only download files that are NOT already stored locally
            const missing = info.files.filter((id) => !existingTs.has(id));

            if (missing.length > 0) {
              enqueueHistoryFiles(missing);
            } else {
              // Nothing new to download -> ensure modal stays hidden
              setIsDownloadingHistory(false);
              setDownloadProgress(0);
            }
          } catch (err) {
            console.warn("Error@O2RingProvider.tsx/subInfo filter: ", err);
            // Fallback: if something goes wrong, keep old behaviour
            enqueueHistoryFiles(info.files);
          }
        }
      });

      subProgress = O2Ring.addReadProgressListener((progress) => {
        if (readTimeout.current) {
          clearTimeout(readTimeout.current);
          readTimeout.current = null;
        }
        setIsDownloadingHistory(true);
        setDownloadProgress(Math.min(100, Math.max(0, progress.progress)));
      });

      subFile = O2Ring.addHistoryFileListener(async (file) => {
        const deviceForSave = connectedDeviceRef.current;

        try {
          const patient = patientIdRef.current ?? (await syncPatientId());
          if (!patient) {
            throw new Error("No patient ID available to save history file");
          }
          const serial = deviceForSave?.name ?? "O2Ring";
          await saveCsv(file.csv, file.startTime, serial, patient);
        } catch (err) {
          console.warn("Error@O2RingProvider.tsx/saveCsv: ", err);
        } finally {
          currentReading.current = null;
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
        clearTimeout(infoRetryTimer.current);
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
    if (!ok) return;

    setDevices([]);
    setIsScanning(true);
    try {
      await O2Ring.scan();
    } catch (e) {
      console.warn("Error@O2RingProvider.tsx/startScan: ", e);
      setIsScanning(false);
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
   * Connect to a given O2Ring device
   * @param device Device to connect to
   * @returns Whether realtime streaming started successfully
   */
  const connectToDevice = useCallback(
    async (device: DeviceItem) => {
      setConnecting(true);
      try {
        await O2Ring.stopScan().catch(() => undefined);
        setIsScanning(false);

        await syncPatientId();

        readQueue.current = [];
        currentReading.current = null;
        setSpo2(null);
        setPr(null);
        setRealtimeUpdatedAt(null);

        // Reset serviceReady for iOS when starting a fresh connection
        if (Platform.OS === "ios") {
          setServiceReady(false);
        }
        setIosRealtimeReady(Platform.OS === "android");

        await O2Ring.connect(device.mac, device.model);

        // Mark as connected; realtime will start when onServiceReady fires
        setConnectedDevice(device);

        return true;
      } catch (e) {
        console.warn("Error@O2RingProvider.tsx/connectToDevice: ", e);
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [syncPatientId]
  );

  /**
   * Disconnect from the current device
   */
  const disconnect = useCallback(async () => {
    try {
      await O2Ring.disconnect();
    } catch (e) {
      console.warn("Error@O2RingProvider.tsx/disconnect: ", e);
    }
    if (infoRetryTimer.current) {
      clearTimeout(infoRetryTimer.current);
      infoRetryTimer.current = null;
      infoRetryCount.current = 0;
    }
    if (readTimeout.current) {
      clearTimeout(readTimeout.current);
      readTimeout.current = null;
    }
    readQueue.current = [];
    currentReading.current = null;
    setConnectedDevice(null);
    setSpo2(null);
    setPr(null);
    setRealtimeUpdatedAt(null);
    setIsDownloadingHistory(false);
    setDownloadProgress(0);
    setServiceReady(Platform.OS === "android");
    setIosRealtimeReady(Platform.OS === "android");
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
  ) => {
    // 1. Convert all ISO timestamps in the CSV to "YYYY-MM-DD HH:mm:ss"
    const formattedCsv = csv.replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,
      (iso) => {
        const d = new Date(iso);
        const pad = (n: number) => n.toString().padStart(2, "0");
        return (
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
        );
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
      connectedDevice,
      spo2,
      pr,
      realtimeUpdatedAt,
      isDownloadingHistory,
      downloadProgress,
      requestPermissions,
      startScan,
      stopScan,
      connectToDevice,
      disconnect,
      clearDevices,
      refreshRealtime,
    }),
    [
      initializing,
      hasPermission,
      isScanning,
      connecting,
      serviceReady,
      isRealtimeReady,
      devices,
      connectedDevice,
      spo2,
      pr,
      realtimeUpdatedAt,
      isDownloadingHistory,
      downloadProgress,
      requestPermissions,
      startScan,
      stopScan,
      connectToDevice,
      disconnect,
      clearDevices,
      refreshRealtime,
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
