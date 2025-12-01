package expo.modules.viatom

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Observer
import com.jeremyliao.liveeventbus.LiveEventBus
import com.jeremyliao.liveeventbus.utils.AppUtils
import com.lepu.blepro.constants.Ble
import com.lepu.blepro.event.EventMsgConst
import com.lepu.blepro.event.InterfaceEvent
import com.lepu.blepro.ext.BleServiceHelper
import com.lepu.blepro.ext.oxy.DeviceInfo
import com.lepu.blepro.ext.oxy.OxyFile
import com.lepu.blepro.ext.oxy.OxyFile.EachData
import com.lepu.blepro.ext.oxy.RtParam
import com.lepu.blepro.objs.Bluetooth
import expo.modules.kotlin.events.EventEmitter
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

class ViatomModule : Module() {

  private var emitter: EventEmitter? = null
  private var subscribed = false
  private var serviceInitialized = false

  // Remember any scanned devices by MAC
  private val foundDevices = mutableMapOf<String, Bluetooth>()

  private var connectedModel: Int? = null
  private var connectedMac: String? = null

  // Keep references so observers can be removed cleanly
  private val liveObservers = mutableListOf<LiveObserver<*>>()

  override fun definition() = ModuleDefinition {
    Name("Viatom")

    Events(
            "onDeviceFound", // { mac, name, model }
            "onConnected", // { mac, model }
            "onDisconnected", // { mac?, model?, reason? }
            "onRealtime", // { spo2, pr, pi, motion, ts }
            "onInfo", // { battery, state, files }
            "onHistoryFile", // { csv, startTime }
            "onReadProgress", // { progress }
            "onError" // { code, message }
    )

    OnStartObserving { emitter = appContext.eventEmitter(this@ViatomModule) }
    OnStopObserving {
      emitter = null
      clearObservers()
    }
    OnDestroy { clearObservers() }

    // ------------- BASIC FUNCTIONS EXPOSED TO JS -------------

    // 1) Ask for Android permissions (call this from JS once)
    AsyncFunction("requestPermissions") {
      val act: Activity =
              appContext.activityProvider?.currentActivity ?: throw CodedException("NO_ACTIVITY")

      val missing =
              requiredPermissions().filter {
                ContextCompat.checkSelfPermission(act, it) != PackageManager.PERMISSION_GRANTED
              }

      if (missing.isEmpty()) {
        true
      } else {
        ActivityCompat.requestPermissions(act, missing.toTypedArray(), 1234)
        false
      }
    }

    // 2) Initialize listeners (call once from JS)
    AsyncFunction("initialize") {
      ensureServiceInitialized()
      subscribeIfNeeded()
      true
    }

    // 3) Start scanning for Lepu devices
    AsyncFunction("scan") {
      ensureServiceInitialized()
      subscribeIfNeeded()
      foundDevices.clear()
      BleServiceHelper.BleServiceHelper.startScan()
      true
    }

    // 4) Stop scan
    AsyncFunction("stopScan") {
      BleServiceHelper.BleServiceHelper.stopScan()
      true
    }

    // 5) Connect by MAC + model (model is one of Bluetooth.MODEL_O2RING etc)
    AsyncFunction("connect") { mac: String, model: Int ->
      ensureServiceInitialized()
      subscribeIfNeeded()

      val act: Activity =
              appContext.activityProvider?.currentActivity ?: throw CodedException("NO_ACTIVITY")

      val bt = foundDevices[mac] ?: throw CodedException("DEVICE_NOT_FOUND")

      // Set which device type we are talking to
      BleServiceHelper.BleServiceHelper.setInterfaces(model)

      // Actually connect
      BleServiceHelper.BleServiceHelper.connect(
              act.applicationContext,
              model,
              bt.device // The Android BluetoothDevice
      )

      connectedModel = model
      connectedMac = mac
      true
    }

    // 6) Disconnect current device
    AsyncFunction("disconnect") {
      val model = connectedModel
      if (model != null) {
        BleServiceHelper.BleServiceHelper.disconnect(model, false)
      } else {
        BleServiceHelper.BleServiceHelper.disconnect(false)
      }
      true
    }

    // 7) Start realtime param stream (SpO2, PR, PI, motion)
    AsyncFunction("startRealtime") {
      val model = connectedModel ?: throw CodedException("NO_DEVICE_CONNECTED")

      BleServiceHelper.BleServiceHelper.oxyGetRtParam(model)
      true
    }

    AsyncFunction("stopRealtime") {
      val model = connectedModel
      if (model != null) {
        // For Oxy devices stopping realtime is usually handled by the SDK.
      }
      true
    }

    // 8) Explicitly fetch device info (includes file list) after connecting
    AsyncFunction("getInfo") {
      val model = connectedModel ?: throw CodedException("NO_DEVICE_CONNECTED")
      BleServiceHelper.BleServiceHelper.oxyGetInfo(model)
      true
    }

    // 9) Read one history file by name (you get filenames from onInfo.files)
    AsyncFunction("readHistoryFile") { filename: String ->
      val model = connectedModel ?: throw CodedException("NO_DEVICE_CONNECTED")

      BleServiceHelper.BleServiceHelper.oxyReadFile(model, filename)
      true
    }
  }

  // --------------------------------
  // SUBSCRIBE TO GENERIC BLE EVENTS
  // --------------------------------
  private fun subscribeToBleEvents() {
    // New device found while scanning
    addObserver(EventMsgConst.Discovery.EventDeviceFound, Bluetooth::class.java) { bt ->
      val device: BluetoothDevice = bt.device
      val mac = device.address ?: return@addObserver
      foundDevices[mac] = bt

      emitter?.emit(
              "onDeviceFound",
              mapOf("mac" to mac, "name" to (device.name ?: "Unknown"), "model" to bt.model)
      )
    }

    // Service ready (SDK initialised)
    addObserver(EventMsgConst.Ble.EventServiceConnectedAndInterfaceInit, Boolean::class.java) { ok
      ->
      if (!ok) {
        emitter?.emit(
                "onError",
                mapOf(
                        "code" to "SERVICE_INIT_FAILED",
                        "message" to "Lepu BLE service failed to init"
                )
        )
      }
    }
  }

  // ------------- SUBSCRIBE TO OXY (O2Ring) EVENTS -------------

  private fun subscribeToOxyEvents() {
    // 1. Real-time param data (SpO2, PR, PI, motion)
    addObserver(InterfaceEvent.Oxy.EventOxyRtParamData, InterfaceEvent::class.java) { evt ->
      val d = evt.data as RtParam
      emitter?.emit(
              "onRealtime",
              mapOf(
                      "spo2" to d.spo2,
                      "pr" to d.pr,
                      "pi" to d.pi,
                      "motion" to d.vector,
                      "ts" to System.currentTimeMillis()
              )
      )
    }

    // 2. Device info (battery, state, file list)
    addObserver(InterfaceEvent.Oxy.EventOxyInfo, InterfaceEvent::class.java) { evt ->
      val info = evt.data as DeviceInfo
      val list = info.fileList.split(",").filter { it.isNotBlank() }

      emitter?.emit(
              "onInfo",
              mapOf("battery" to info.batteryValue, "state" to info.curState, "files" to list)
      )

      // Optional: auto start realtime after info
      val model = connectedModel
      if (model != null) {
        BleServiceHelper.BleServiceHelper.oxyGetRtParam(model)
      }
    }

    // 3. Read file progress
    addObserver(InterfaceEvent.Oxy.EventOxyReadingFileProgress, InterfaceEvent::class.java) { evt ->
      val progress = evt.data as Int
      emitter?.emit("onReadProgress", mapOf("progress" to progress))
    }

    // 4. Read file complete
    addObserver(InterfaceEvent.Oxy.EventOxyReadFileComplete, InterfaceEvent::class.java) { evt ->
      val file = evt.data as OxyFile
      val csv = convertOxyFileToCsv(file)

      emitter?.emit("onHistoryFile", mapOf("csv" to csv, "startTime" to file.startTime))
    }

    // 5. Read file error
    addObserver(InterfaceEvent.Oxy.EventOxyReadFileError, InterfaceEvent::class.java) { evt ->
      val failed = evt.data as Boolean
      if (failed) {
        emitter?.emit(
                "onError",
                mapOf("code" to "READ_FILE_ERROR", "message" to "Failed to read history file")
        )
      }
    }

    // 6. Disconnect reason
    addObserver(EventMsgConst.Ble.EventBleDeviceDisconnectReason, Int::class.java) { reason ->
      emitter?.emit(
              "onDisconnected",
              mapOf("reason" to reason, "mac" to connectedMac, "model" to connectedModel)
      )
      connectedModel = null
      connectedMac = null
    }
  }

  // Convert OxyFile to CSV aligned with historical format
  private fun convertOxyFileToCsv(file: OxyFile): String {
    val dataPoints: List<EachData> = file.data ?: emptyList()
    val recordingTime = file.recordingTime
    if (dataPoints.isEmpty() || recordingTime <= 0) {
      return "Time,Oxygen Level,Pulse Rate,Motion,O2 Reminder,PR Reminder"
    }

    // The legacy format samples every 4 seconds across the full recording
    val totalPoints = (recordingTime / 4).coerceAtLeast(1)
    val sdf = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US)
    val sb = StringBuilder()
    sb.append("Time,Oxygen Level,Pulse Rate,Motion,O2 Reminder,PR Reminder\n")

    for (idx in 0 until totalPoints) {
      val targetSeconds = idx * 4
      val percent = if (totalPoints > 1) idx.toFloat() / (totalPoints - 1).toFloat() else 0f
      val rec = getDataAtPercent(percent, dataPoints)

      // Only emit rows with plausible vitals (match legacy guard)
      if ((rec.spo2 in 1..149) || (rec.pr in 1..349)) {
        val tsMillis = (file.startTime * 1000L) + targetSeconds * 1000L
        val timeStr = sdf.format(java.util.Date(tsMillis))
        sb.append(timeStr)
                .append(',')
                .append(rec.spo2)
                .append(',')
                .append(rec.pr)
                .append(',')
                .append(rec.vector)
                .append(',')
                .append(if (rec.isWarningSignSpo2) 1 else 0)
                .append(',')
                .append(if (rec.isWarningSignPr) 1 else 0)
                .append('\n')
      }
    }

    return sb.toString().trimEnd()
  }

  // Pick a data point along the recording based on percentage position
  private fun getDataAtPercent(percent: Float, dataPoints: List<EachData>): EachData {
    if (dataPoints.isEmpty()) throw IllegalArgumentException("No data points available")
    val clamped = percent.coerceIn(0f, 1f)
    val idx =
            ((dataPoints.size - 1) * clamped)
                    .toDouble()
                    .roundToInt()
                    .coerceIn(0, dataPoints.size - 1)
    return dataPoints[idx]
  }

  private fun ensureServiceInitialized() {
    if (serviceInitialized) return

    val app =
            appContext.reactContext?.applicationContext as? android.app.Application
                    ?: appContext.activityProvider?.currentActivity?.application
                            ?: throw CodedException("NO_APPLICATION")

    // LiveEventBus needs Application set explicitly (we removed reflection fallback)
    AppUtils.init(app)

    BleServiceHelper.BleServiceHelper.initService(app)
    serviceInitialized = true
  }

  private fun subscribeIfNeeded() {
    if (subscribed) return
    subscribeToBleEvents()
    subscribeToOxyEvents()
    subscribed = true
  }

  private fun requiredPermissions(): Array<String> =
          arrayOf(
                  Manifest.permission.BLUETOOTH_SCAN,
                  Manifest.permission.BLUETOOTH_CONNECT,
                  Manifest.permission.ACCESS_FINE_LOCATION,
                  Manifest.permission.ACCESS_COARSE_LOCATION
          )

  private fun <T> addObserver(key: String, clazz: Class<T>, block: (T) -> Unit) {
    val observer = Observer<T> { block(it) }
    runOnMain {
      LiveEventBus.get(key, clazz).observeForever(observer)
      liveObservers.add(LiveObserver(key, clazz, observer))
    }
  }

  private fun clearObservers() {
    runOnMain {
      liveObservers.forEach { entry ->
        @Suppress("UNCHECKED_CAST") val obs = entry.observer as Observer<Any>
        LiveEventBus.get(entry.key, entry.clazz as Class<Any>).removeObserver(obs)
      }
      liveObservers.clear()
      subscribed = false
    }
  }

  private data class LiveObserver<T>(
          val key: String,
          val clazz: Class<T>,
          val observer: Observer<T>
  )

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      Handler(Looper.getMainLooper()).post { block() }
    }
  }
}
