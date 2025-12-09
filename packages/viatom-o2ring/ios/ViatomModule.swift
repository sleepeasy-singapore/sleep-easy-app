import ExpoModulesCore
import CoreBluetooth
import VTO2Lib

struct ViatomException: CodedError {
  let code: String
  let description: String
}

private struct DiscoveredDevice {
  let peripheral: CBPeripheral
  let name: String
  let model: Int
}

@MainActor
final class ViatomManager: NSObject, CBCentralManagerDelegate, VTO2CommunicateDelegate {
  typealias EventSink = (String, [String: Any]) -> Void

  var eventSink: EventSink?

  private var central: CBCentralManager?
  private var communicator: VTO2Communicate?
  private var discoveredDevices: [UUID: DiscoveredDevice] = [:]
  private var permissionContinuations: [CheckedContinuation<Bool, Never>] = []
  private var pendingPowerOnContinuations: [CheckedContinuation<Void, Error>] = []
  private let supportedViatomNameTokens: [String] = [
    "o2ring",
    "o2 ring",
  ]
  private var isScanning = false
  private var isServiceReady = false
  private var connectedPeripheral: CBPeripheral?
  private var connectedIdentifier: UUID?
  private var connectedModel: Int?
  private var pendingConnectModels: [UUID: Int] = [:]
  private lazy var isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  override init() {
    super.init()
  }

  func initialize() {
    ensureCentral()
  }

  func requestPermissions() async -> Bool {
    ensureCentral()

    if #available(iOS 13.1, *) {
      switch CBCentralManager.authorization {
      case .allowedAlways:
        return true
      case .denied, .restricted:
        return false
      case .notDetermined:
        return await withCheckedContinuation { cont in
          permissionContinuations.append(cont)
        }
      @unknown default:
        return false
      }
    } else {
      return true
    }
  }

  func scan() async throws -> Bool {
    try await ensurePoweredOn()
    discoveredDevices.removeAll()

    central?.scanForPeripherals(
      withServices: nil,
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
    )

    isScanning = true
    return true
  }

  func stopScan() -> Bool {
    guard isScanning else { return true }
    central?.stopScan()
    isScanning = false
    return true
  }

  func connect(mac: String, model: Int) throws -> Bool {
    ensureCentral()
    isServiceReady = false

    guard let identifier = UUID(uuidString: mac) else {
      throw ViatomException(code: "INVALID_DEVICE", description: "Invalid device identifier")
    }

    let peripheral = discoveredDevices[identifier]?.peripheral ?? central?.retrievePeripherals(withIdentifiers: [identifier]).first

    guard let target = peripheral else {
      throw ViatomException(code: "DEVICE_NOT_FOUND", description: "Unable to find peripheral with identifier \(mac)")
    }

    pendingConnectModels[identifier] = model
    central?.connect(target, options: nil)
    discoveredDevices[identifier] = DiscoveredDevice(peripheral: target, name: target.name ?? "O2Ring", model: model)
    return true
  }

  func disconnect() -> Bool {
    if let peripheral = connectedPeripheral {
      central?.cancelPeripheralConnection(peripheral)
    }
    cleanupConnection()
    return true
  }

  func startRealtime() throws -> Bool {
    guard connectedPeripheral != nil else {
      throw ViatomException(code: "NO_DEVICE_CONNECTED", description: "No active O2Ring connection")
    }
    guard isServiceReady, let communicator = communicator else {
      throw ViatomException(code: "SERVICE_NOT_READY", description: "Service not ready yet")
    }
    communicator.beginGetRealData()
    return true
  }

  func stopRealtime() -> Bool {
    return true
  }

  func getInfo() throws -> Bool {
    guard connectedPeripheral != nil else {
      throw ViatomException(code: "NO_DEVICE_CONNECTED", description: "No active O2Ring connection")
    }
    guard isServiceReady, let communicator = communicator else {
      throw ViatomException(code: "SERVICE_NOT_READY", description: "Service not ready yet")
    }
    communicator.beginGetInfo()
    return true
  }

  func readHistory(fileName: String) throws -> Bool {
    guard connectedPeripheral != nil else {
      throw ViatomException(code: "NO_DEVICE_CONNECTED", description: "No active O2Ring connection")
    }
    guard isServiceReady, let communicator = communicator else {
      throw ViatomException(code: "SERVICE_NOT_READY", description: "Service not ready yet")
    }
    communicator.beginReadFile(withFileName: fileName)
    emit("onReadProgress", ["progress": 0])
    return true
  }

  // MARK: - CBCentralManagerDelegate

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    resolvePermissionContinuationsIfPossible()

    switch central.state {
    case .poweredOn:
      completePendingPowerOn(with: .success(()))
    case .poweredOff:
      completePendingPowerOn(with: .failure(ViatomException(code: "BLUETOOTH_OFF", description: "Bluetooth is powered off")))
      if isScanning {
        central.stopScan()
        isScanning = false
      }
    case .unauthorized:
      completePendingPowerOn(with: .failure(ViatomException(code: "BLUETOOTH_UNAUTHORIZED", description: "Bluetooth permission denied")))
    case .unsupported:
      completePendingPowerOn(with: .failure(ViatomException(code: "BLUETOOTH_UNSUPPORTED", description: "Bluetooth unsupported on this device")))
    default:
      break
    }
  }

  func centralManager(_ central: CBCentralManager,
                      didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any],
                      rssi RSSI: NSNumber) {
    guard let name = viatomDeviceName(for: peripheral, advertisementData: advertisementData) else {
      return
    }

    let existingModel = discoveredDevices[peripheral.identifier]?.model ?? 0
    let model = existingModel != 0 ? existingModel : guessModel(from: advertisementData)

    discoveredDevices[peripheral.identifier] = DiscoveredDevice(
      peripheral: peripheral,
      name: name,
      model: model
    )

    emit("onDeviceFound", [
      "mac": peripheral.identifier.uuidString,
      "name": name,
      "model": model
    ])
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    connectedPeripheral = peripheral
    connectedIdentifier = peripheral.identifier
    connectedModel = pendingConnectModels[peripheral.identifier] ?? discoveredDevices[peripheral.identifier]?.model
    pendingConnectModels[peripheral.identifier] = nil

    let util = VTO2Communicate.sharedInstance()
    util.delegate = self
    util.a5Delegate = nil
    util.timeout = 10000
    util.peripheral = peripheral
    communicator = util

    emit("onConnected", [
      "mac": peripheral.identifier.uuidString,
      "model": connectedModel ?? 0
    ])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    sendError(code: "CONNECT_FAILED", message: error?.localizedDescription ?? "Failed to connect to device")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let wasCurrent = connectedIdentifier == peripheral.identifier
    let modelValue = wasCurrent ? (connectedModel ?? discoveredDevices[peripheral.identifier]?.model ?? 0) : (discoveredDevices[peripheral.identifier]?.model ?? 0)

    if wasCurrent {
      cleanupConnection()
    }

    let nsError = error as NSError?
    emit("onDisconnected", [
      "mac": peripheral.identifier.uuidString,
      "model": modelValue,
      "reason": nsError?.code ?? 0
    ])
  }

  // MARK: - VTO2CommunicateDelegate

  @objc(serviceDeployed:)
  func serviceDeployed(_ completed: Bool) {
    guard completed else {
      sendError(code: "SERVICE_INIT_FAILED", message: "Failed to initialise device services")
      return
    }
    isServiceReady = true
    bootstrapAfterServiceReady()
    emit("onServiceReady", [
      "mac": connectedIdentifier?.uuidString ?? ""
    ])
  }

  @objc(getInfoWithResultData:)
  func getInfo(withResultData infoData: Data!) {
    guard let infoData = infoData else {
      sendError(code: "INFO_ERROR", message: "Device info response was empty")
      return
    }
    let info = VTO2Parser.parseO2Info(with: infoData)

    let files = info.fileList
      .split { $0 == "," || $0 == ";" || $0.isNewline }
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }

    let battery = parseInteger(from: info.curBattery) ?? 0
    let state = parseInteger(from: info.curState) ?? 0

    emit("onInfo", [
      "battery": battery,
      "state": state,
      "files": files
    ])
  }

  @objc(postCurrentReadProgress:)
  func postCurrentReadProgress(_ progress: Double) {
    let normalized = progress <= 1.0 ? progress * 100.0 : progress
    let percent = max(0, min(100, Int(normalized.rounded())))
    emit("onReadProgress", ["progress": percent])
  }

  @objc(realDataCallBackWithData:)
  func realDataCallBack(with data: Data!) {
    guard let data = data else {
      return
    }
    let realData = VTO2Parser.parseO2RealObject(with: data)

    emit("onRealtime", [
      "spo2": Int(realData.spo2),
      "pr": Int(realData.hr),
      "pi": Int(realData.pi),
      "motion": Int(realData.vector),
      "ts": Int(Date().timeIntervalSince1970 * 1000)
    ])
  }

  @objc(realDataCallBackWithData:originalData:)
  func realDataCallBack(with data: Data!, originalData: Data!) {
    realDataCallBack(with: data)
  }

  @objc(readCompleteWithData:)
  func readComplete(with data: VTFileToRead!) {
    guard let file = data else {
      sendError(code: "READ_FILE_ERROR", message: "History file response was empty")
      return
    }

    guard file.enLoadResult == VTFileLoadResultSuccess else {
      sendError(code: "READ_FILE_ERROR", message: "Failed to read history file (code: \(file.enLoadResult.rawValue))")
      return
    }

    guard let buffer = file.fileData as Data? else {
      sendError(code: "READ_FILE_ERROR", message: "History file buffer missing")
      return
    }

    do {
      let result = try convertHistoryFile(buffer)
      emit("onHistoryFile", [
        "csv": result.csv,
        "startTime": result.startTime
      ])
    } catch {
      sendError(code: "READ_FILE_ERROR", message: error.localizedDescription)
    }
  }

  @objc(writeDataErrorCode:)
  func writeDataErrorCode(_ errorCode: Int) {
    sendError(code: "COMMAND_FAILED", message: "Command failed with code \(errorCode)")
  }

  // MARK: - Helpers

  private func ensureCentral() {
    if central == nil {
      central = CBCentralManager(delegate: self, queue: nil)
    }
  }

  private func bootstrapAfterServiceReady() {
    guard connectedPeripheral != nil, let communicator = communicator else {
      return
    }
    communicator.beginGetInfo()
    communicator.beginGetRealData()
  }

  private func cleanupConnection() {
    connectedPeripheral = nil
    connectedIdentifier = nil
    connectedModel = nil
    isServiceReady = false
    communicator?.delegate = nil
    communicator?.a5Delegate = nil
    communicator = nil
  }

  private func ensurePoweredOn() async throws {
    ensureCentral()
    guard let central = central else {
      throw ViatomException(code: "BLUETOOTH_UNAVAILABLE", description: "Bluetooth manager unavailable")
    }

    switch central.state {
    case .poweredOn:
      return
    case .poweredOff:
      throw ViatomException(code: "BLUETOOTH_OFF", description: "Bluetooth is powered off")
    case .unauthorized:
      throw ViatomException(code: "BLUETOOTH_UNAUTHORIZED", description: "Bluetooth permission denied")
    case .unsupported:
      throw ViatomException(code: "BLUETOOTH_UNSUPPORTED", description: "Bluetooth unsupported on this device")
    default:
      break
    }

    try await withCheckedThrowingContinuation { cont in
      pendingPowerOnContinuations.append(cont)
    }
  }

  private func completePendingPowerOn(with result: Result<Void, Error>) {
    guard !pendingPowerOnContinuations.isEmpty else { return }
    let continuations = pendingPowerOnContinuations
    pendingPowerOnContinuations.removeAll()

    for cont in continuations {
      switch result {
      case .success:
        cont.resume(returning: ())
      case .failure(let error):
        cont.resume(throwing: error)
      }
    }
  }

  private func resolvePermissionContinuationsIfPossible() {
    guard !permissionContinuations.isEmpty else { return }

    if #available(iOS 13.1, *) {
      let auth = CBCentralManager.authorization
      if auth == .notDetermined {
        return
      }
      let granted = auth == .allowedAlways
      permissionContinuations.forEach { $0.resume(returning: granted) }
      permissionContinuations.removeAll()
    } else {
      permissionContinuations.forEach { $0.resume(returning: true) }
      permissionContinuations.removeAll()
    }
  }

  private func guessModel(from advertisementData: [String: Any]) -> Int {
    return 0
  }

  private func viatomDeviceName(for peripheral: CBPeripheral, advertisementData: [String: Any]) -> String? {
    var candidates: [String] = []
    if let name = peripheral.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
      candidates.append(name)
    }
    if let localName = (advertisementData[CBAdvertisementDataLocalNameKey] as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines),
       !localName.isEmpty {
      candidates.append(localName)
    }

    for name in candidates {
      if matchesViatomName(name) {
        return name
      }
    }

    return nil
  }

  private func matchesViatomName(_ rawName: String) -> Bool {
    let normalized = rawName
      .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
      .lowercased()

    guard !normalized.isEmpty else {
      return false
    }

    for token in supportedViatomNameTokens {
      if normalized.contains(token) {
        return true
      }
    }

    return false
  }

  private func parseInteger(from raw: String?) -> Int? {
    guard let raw = raw else { return nil }
    if let value = Int(raw.trimmingCharacters(in: .whitespacesAndNewlines)) {
      return value
    }
    let digits = raw.compactMap { $0.isNumber || $0 == "-" ? $0 : nil }
    guard !digits.isEmpty else { return nil }
    return Int(String(digits))
  }

  private func convertHistoryFile(_ data: Data) throws -> (csv: String, startTime: Int) {
    let object = VTO2Parser.parseO2Object(with: data)

    guard let startDate = historyStartDate(from: object) else {
      throw ViatomException(code: "READ_FILE_ERROR", description: "Invalid history timestamp")
    }

    let waves = VTO2Parser.parseO2WaveObjectArray(withWave: object.waveData) ?? []
    let durationSeconds = Int(object.recordTime)
    let totalSeconds = durationSeconds > 0 ? durationSeconds : max(waves.count * 4, 0)
    let totalPoints = max(totalSeconds / 4, 1)

    var builder = "Time,Oxygen Level,Pulse Rate,Motion,O2 Reminder,PR Reminder\n"

    if waves.isEmpty || totalPoints <= 0 {
      return (builder.trimmingCharacters(in: .whitespacesAndNewlines), Int(startDate.timeIntervalSince1970))
    }

    for idx in 0..<totalPoints {
      let percent = totalPoints > 1 ? Double(idx) / Double(totalPoints - 1) : 0
      let sample = sampleWave(at: percent, from: waves)
      if (1...149).contains(sample.spo2) || (1...349).contains(sample.hr) {
        let timestamp = startDate.addingTimeInterval(Double(idx * 4))
        builder += "\(isoFormatter.string(from: timestamp)),\(sample.spo2),\(sample.hr),\(sample.ac_v_s),\(sample.spo2Mark != 0 ? 1 : 0),\(sample.hrMark != 0 ? 1 : 0)\n"
      }
    }

    return (
      builder.trimmingCharacters(in: .whitespacesAndNewlines),
      Int(startDate.timeIntervalSince1970)
    )
  }

  private func historyStartDate(from object: VTO2Object) -> Date? {
    var components = DateComponents()
    components.year = Int(object.year)
    components.month = Int(object.month)
    components.day = Int(object.day)
    components.hour = Int(object.hour)
    components.minute = Int(object.minute)
    components.second = Int(object.second)
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone.current
    return calendar.date(from: components)
  }

  private func sampleWave(at percent: Double, from waves: [VTO2WaveObject]) -> VTO2WaveObject {
    guard !waves.isEmpty else {
      return VTO2WaveObject()
    }
    let clamped = min(max(percent, 0), 1)
    let index = Int((Double(waves.count - 1) * clamped).rounded())
    let safeIndex = min(max(index, 0), waves.count - 1)
    return waves[safeIndex]
  }

  private func emit(_ name: String, _ payload: [String: Any?]) {
    guard let sink = eventSink else { return }
    var body: [String: Any] = [:]
    payload.forEach { key, value in
      if let value = value {
        body[key] = value
      }
    }
    sink(name, body)
  }

  private func sendError(code: String, message: String) {
    emit("onError", ["code": code, "message": message])
  }
}

public final class ViatomModule: Module {
  @MainActor
  private var managerInstance: ViatomManager?

  private func withManager<T>(_ block: @MainActor (ViatomManager) async throws -> T) async rethrows -> T {
    let manager = await MainActor.run { self.getOrCreateManager() }
    return try await block(manager)
  }

  @MainActor
  private func getOrCreateManager() -> ViatomManager {
    if let manager = managerInstance {
      return manager
    }
    let manager = ViatomManager()
    managerInstance = manager
    return manager
  }

  public func definition() -> ModuleDefinition {
    Name("Viatom")

    Events(
      "onDeviceFound",
      "onConnected",
      "onDisconnected",
      "onServiceReady",
      "onRealtime",
      "onInfo",
      "onHistoryFile",
      "onReadProgress",
      "onError"
    )

    OnStartObserving {
      Task { @MainActor [weak self] in
        guard let self = self else { return }
        let manager = self.getOrCreateManager()
        manager.eventSink = { [weak self] name, payload in
          self?.sendEvent(name, payload)
        }
      }
    }

    OnStopObserving {
      Task { @MainActor [weak self] in
        guard let self = self else { return }
        self.managerInstance?.eventSink = nil
      }
    }

    AsyncFunction("requestPermissions") {
      return await self.withManager { manager in
        await manager.requestPermissions()
      }
    }

    AsyncFunction("initialize") {
      return await self.withManager { manager in
        manager.initialize()
        return true
      }
    }

    AsyncFunction("scan") {
      return try await self.withManager { manager in
        try await manager.scan()
      }
    }

    AsyncFunction("stopScan") {
      return await self.withManager { manager in
        manager.stopScan()
      }
    }

    AsyncFunction("connect") { (mac: String, model: Int) in
      return try await self.withManager { manager in
        try manager.connect(mac: mac, model: model)
      }
    }

    AsyncFunction("disconnect") {
      return await self.withManager { manager in
        manager.disconnect()
      }
    }

    AsyncFunction("startRealtime") {
      return try await self.withManager { manager in
        try manager.startRealtime()
      }
    }

    AsyncFunction("stopRealtime") {
      return await self.withManager { manager in
        manager.stopRealtime()
      }
    }

    AsyncFunction("getInfo") {
      return try await self.withManager { manager in
        try manager.getInfo()
      }
    }

    AsyncFunction("readHistoryFile") { (fileName: String) in
      return try await self.withManager { manager in
        try manager.readHistory(fileName: fileName)
      }
    }
  }
}
