import Foundation
import Capacitor
import PushKit
import CallKit
import AVFoundation
import AVKit
import UIKit

/// Shows an incoming GAYZE call as a real iPhone call: full screen on the lock screen, system ringtone,
/// Answer / Decline. iOS wakes the app with a VoIP push (PushKit); the app MUST report the call to CallKit
/// straight away, or iOS stops delivering VoIP pushes to it. Answering opens the app and hands the call id to the web layer.
@objc(GayzeCallKitPlugin)
public class GayzeCallKitPlugin: CAPPlugin, CAPBridgedPlugin, PKPushRegistryDelegate, CXProviderDelegate {
    public let identifier = "GayzeCallKitPlugin"
    public let jsName = "GayzeCallKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setUser", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "answerCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "systemCallRinging", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAudioRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showRoutePicker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise)
    ]

    private struct Ringing {
        var callerName: String
        var callType: String
        var conversationId: String?
        var callerId: String?
        var answered = false
        var timeout: DispatchWorkItem?
    }

    private static let ringSeconds: TimeInterval = 45
    private static let staleSeconds: TimeInterval = 70

    private var registry: PKPushRegistry?
    private var provider: CXProvider?
    private let controller = CXCallController()
    private var calls: [UUID: Ringing] = [:]
    private var token: String?
    private var routePicker: AVRoutePickerView?
    /// Asks iOS to keep the app running while a call is ringing or on, so answering from the lock screen is not followed by being suspended.
    private var keepAlive: UIBackgroundTaskIdentifier = .invalid
    private func beginKeepAlive() {
        guard keepAlive == .invalid else { return }
        keepAlive = UIApplication.shared.beginBackgroundTask(withName: "gayze-call") { [weak self] in self?.endKeepAlive() }
    }
    private func endKeepAlive() {
        guard keepAlive != .invalid else { return }
        UIApplication.shared.endBackgroundTask(keepAlive)
        keepAlive = .invalid
    }
    /// Calls the app answered itself (from its own answer button): the system call screen is answered to match, without telling the app again.
    private var answeredByApp = Set<UUID>()

    /// Who is signed in on this phone. Kept on the device so a call push that arrives while the app is closed
    /// can still tell that the phone belongs to the caller (never ring the person who is calling).
    private static let userKey = "gayze.currentUserId"
    private var deviceId: String { UIDevice.current.identifierForVendor?.uuidString.lowercased() ?? "" }

    #if DEBUG
    private let environment = "sandbox"
    #else
    private let environment = "production"
    #endif

    override public func load() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        let p = CXProvider(configuration: config)
        p.setDelegate(self, queue: nil)
        provider = p

        // Created as early as the bridge loads, which iOS does when it launches the app for a call push.
        let r = PKPushRegistry(queue: DispatchQueue.main)
        r.delegate = self
        r.desiredPushTypes = [.voIP]
        registry = r

        // Tell the web layer when the call audio moves (AirPods connect, car takes over, speaker chosen).
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.notifyListeners("audioRoute", data: self.routeInfo())
        }
    }

    /// Where the sound is going right now.
    private func routeInfo() -> [String: Any] {
        let out = AVAudioSession.sharedInstance().currentRoute.outputs.first
        var kind = "other"
        switch out?.portType {
        case .builtInSpeaker?: kind = "speaker"
        case .builtInReceiver?: kind = "receiver"
        case .bluetoothA2DP?, .bluetoothHFP?, .bluetoothLE?: kind = "bluetooth"
        case .headphones?, .usbAudio?: kind = "headphones"
        case .carAudio?: kind = "car"
        default: kind = "other"
        }
        return ["kind": kind, "name": out?.portName ?? ""]
    }

    /// Phone-call audio mode: voice processing, Bluetooth headsets and car kits allowed, speaker by default for video.
    /// Only the category is set here. While iOS's call screen owns the call, iOS activates the session itself.
    private func applyCallCategory(video: Bool) throws {
        var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
        if video { options.insert(.defaultToSpeaker) }
        try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: video ? .videoChat : .voiceChat, options: options)
    }

    @objc func configureAudio(_ call: CAPPluginCall) {
        let video = call.getBool("video") ?? false
        do {
            try applyCallCategory(video: video)
            // Activate it ourselves only when iOS's call screen is not in charge (in-app calls).
            if calls.isEmpty { try AVAudioSession.sharedInstance().setActive(true) }
            call.resolve(routeInfo())
        } catch {
            call.reject("Could not set up the call audio.")
        }
    }

    @objc func getAudioRoute(_ call: CAPPluginCall) {
        call.resolve(routeInfo())
    }

    /// Opens iOS's own audio output picker (iPhone, Speaker, AirPods, car...).
    @objc func showRoutePicker(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else { call.resolve(); return }
            self.routePicker?.removeFromSuperview()
            let picker = AVRoutePickerView(frame: CGRect(x: -200, y: -200, width: 44, height: 44))
            picker.alpha = 0.02
            host.addSubview(picker)
            self.routePicker = picker
            picker.subviews.compactMap { $0 as? UIButton }.first?.sendActions(for: .touchUpInside)
            call.resolve()
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
                if self?.routePicker === picker { picker.removeFromSuperview(); self?.routePicker = nil }
            }
        }
    }

    @objc func register(_ call: CAPPluginCall) {
        var out: [String: Any] = [:]
        if let token = token { out["token"] = token; out["environment"] = environment }
        out["deviceId"] = deviceId
        call.resolve(out)
    }

    @objc func setUser(_ call: CAPPluginCall) {
        let id = (call.getString("userId") ?? "").lowercased()
        if id.isEmpty { UserDefaults.standard.removeObject(forKey: Self.userKey) }
        else { UserDefaults.standard.set(id, forKey: Self.userKey) }
        call.resolve()
    }

    @objc func endCall(_ call: CAPPluginCall) {
        if let id = call.getString("callId"), let uuid = UUID(uuidString: id) { finish(uuid, reason: .remoteEnded) }
        call.resolve()
    }

    /// The person answered inside the app. Answer the system call screen too: it switches the call audio on, and it stops ringing.
    @objc func answerCall(_ call: CAPPluginCall) {
        guard let id = call.getString("callId"), let uuid = UUID(uuidString: id), let c = calls[uuid], !c.answered else { call.resolve(); return }
        answeredByApp.insert(uuid)
        controller.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { [weak self] error in
            if error != nil { DispatchQueue.main.async { self?.answeredByApp.remove(uuid) } }
            call.resolve()
        }
    }

    /// Is iOS's own call screen (or banner) showing this call right now? The app uses it to avoid putting up a second, identical
    /// Answer / Decline screen on top of the system one.
    @objc func systemCallRinging(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = call.getString("callId"), let uuid = UUID(uuidString: id), let c = self.calls[uuid] else { call.resolve(["ringing": false]); return }
            call.resolve(["ringing": !c.answered])
        }
    }

    @objc func endAll(_ call: CAPPluginCall) {
        for uuid in Array(calls.keys) { finish(uuid, reason: .remoteEnded) }
        call.resolve()
    }

    // MARK: PushKit

    public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        token = hex
        notifyListeners("voipToken", data: ["token": hex, "environment": environment, "deviceId": deviceId], retainUntilConsumed: true)
    }

    public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        token = nil
    }

    public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP else { completion(); return }
        let d = payload.dictionaryPayload
        let name = (d["callerName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Gayze member"
        let callType = (d["callType"] as? String) == "audio" ? "audio" : "video"
        let startedAt = (d["startedAt"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
        let stale = startedAt.map { Date().timeIntervalSince($0) > Self.staleSeconds } ?? false
        // This phone is the caller's: iOS still needs the push reported, but it must not ring.
        let mine = UserDefaults.standard.string(forKey: Self.userKey)
        let ownCall = (mine != nil) && ((d["callerId"] as? String)?.lowercased() == mine)

        var uuid = (d["callId"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()
        let duplicate = calls[uuid] != nil
        if duplicate { uuid = UUID() }   // iOS still requires every push to be reported

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: name)
        update.localizedCallerName = name
        update.hasVideo = callType == "video"
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false

        beginKeepAlive()
        calls[uuid] = Ringing(callerName: name, callType: callType,
                              conversationId: d["conversationId"] as? String, callerId: d["callerId"] as? String)
        let id = uuid
        provider?.reportNewIncomingCall(with: id, update: update) { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self else { completion(); return }
                if error != nil || duplicate || stale || ownCall {
                    self.finish(id, reason: error != nil ? .failed : (ownCall ? .remoteEnded : .unanswered))
                } else {
                    let item = DispatchWorkItem { [weak self] in
                        guard let self = self, let c = self.calls[id], !c.answered else { return }
                        self.finish(id, reason: .unanswered)
                    }
                    self.calls[id]?.timeout = item
                    DispatchQueue.main.asyncAfter(deadline: .now() + Self.ringSeconds, execute: item)
                }
                completion()
            }
        }
    }

    // MARK: CallKit

    private func finish(_ uuid: UUID, reason: CXCallEndedReason) {
        guard let c = calls[uuid] else { return }
        c.timeout?.cancel()
        calls[uuid] = nil
        if calls.isEmpty { endKeepAlive() }
        provider?.reportCall(with: uuid, endedAt: Date(), reason: reason)
    }

    private func event(_ name: String, _ uuid: UUID, _ c: Ringing) {
        var data: [String: Any] = ["callId": uuid.uuidString.lowercased(), "callerName": c.callerName, "callType": c.callType]
        if let v = c.conversationId { data["conversationId"] = v }
        if let v = c.callerId { data["callerId"] = v }
        notifyListeners(name, data: data, retainUntilConsumed: true)
    }

    public func providerDidReset(_ provider: CXProvider) {
        for (_, c) in calls { c.timeout?.cancel() }
        calls.removeAll()
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        if var c = calls[action.callUUID] {
            // Set the audio mode before the web layer opens the microphone; iOS activates the session for us.
            try? applyCallCategory(video: c.callType == "video")
            c.answered = true
            c.timeout?.cancel()
            calls[action.callUUID] = c
            // Answered from the app already: the app knows, do not tell it again (that would restart the call).
            if answeredByApp.remove(action.callUUID) == nil { event("callAnswered", action.callUUID, c) }
        }
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let c = calls[action.callUUID] {
            c.timeout?.cancel()
            calls[action.callUUID] = nil
            if calls.isEmpty { endKeepAlive() }
            event(c.answered ? "callEnded" : "callDeclined", action.callUUID, c)
        }
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        let video = calls.values.contains { $0.answered && $0.callType == "video" }
        try? applyCallCategory(video: video)
    }
    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}
