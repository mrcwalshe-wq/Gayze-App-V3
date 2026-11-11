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
        CAPPluginMethod(name: "setNativeCallConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNativeCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNativeMuted", returnType: CAPPluginReturnPromise),
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
        /// Carried by native code (answered on the system call screen), not by the web view.
        var native = false
        var nativeState = "connecting"
        var muted = false
    }

    private static let ringSeconds: TimeInterval = 45
    private static let staleSeconds: TimeInterval = 70

    private var registry: PKPushRegistry?
    private var provider: CXProvider?
    private let controller = CXCallController()
    private var calls: [UUID: Ringing] = [:]
    /// Audio calls answered on the system call screen run natively, because the web view cannot run on a locked phone.
    private var nativeCalls: [UUID: NativeAudioCall] = [:]
    private var nativeAudioUsed = false
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

    /// WHO OWNS THE CALL AUDIO
    ///
    /// The call itself (microphone capture, WebRTC, playback) runs inside the web view, and WebKit runs that audio in its own
    /// process with its own audio session. This app process therefore must never take the audio for itself: every time it set a
    /// non-mixable play-and-record category or activated its own session (which it used to do when a call connected, when the
    /// system call screen was answered, and again when CallKit activated the session) it interrupted WebKit's session, and the
    /// call stayed "connected" with no sound in one or both directions.
    ///
    /// So the app's own session is only ever made MIXABLE. CallKit still activates it when a call is answered from the system
    /// call screen (that cannot be prevented), but a mixable session does not interrupt another one, so WebKit keeps the
    /// microphone and the speaker. The app never calls setActive(true) itself.
    private func yieldAudioToWebView() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.mixWithOthers, .allowBluetooth, .allowBluetoothA2DP])
    }

    /// Reports where the call sound is going. It used to switch the app's own audio session into call mode and activate it here,
    /// at the moment the call connected, which silenced the call (see yieldAudioToWebView). It now touches nothing and only reports.
    @objc func configureAudio(_ call: CAPPluginCall) {
        call.resolve(routeInfo())
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
            guard let id = call.getString("callId"), let uuid = UUID(uuidString: id), let c = self.calls[uuid] else { call.resolve(["ringing": false, "known": false]); return }
            // known: iOS has this call (ringing or already answered on its call screen), so the app must not show a second one.
            call.resolve(["ringing": !c.answered, "known": true, "answered": c.answered])
        }
    }

    /// The web layer hands over what native code needs to set a call up by itself (server address, public key, this phone's call
    /// key, relay servers). An empty call key clears it (signed out).
    @objc func setNativeCallConfig(_ call: CAPPluginCall) {
        let key = call.getString("callKey") ?? ""
        let base = call.getString("supabaseUrl") ?? ""
        let api = call.getString("apiKey") ?? ""
        if key.isEmpty || base.isEmpty || api.isEmpty {
            NativeCallSettings.clear()
            call.resolve()
            return
        }
        var servers: [[String: Any]] = []
        if let list = call.getArray("iceServers") {
            for item in list { if let server = item as? [String: Any] { servers.append(server) } }
        }
        NativeCallSettings.save(baseURL: base, apiKey: api, callKey: key, iceServers: servers)
        call.resolve()
    }

    private func nativeCallInfo(_ uuid: UUID, _ c: Ringing) -> [String: Any] {
        var data: [String: Any] = ["active": true, "callId": uuid.uuidString.lowercased(), "callerName": c.callerName, "state": c.nativeState, "muted": c.muted]
        if let v = c.conversationId { data["conversationId"] = v }
        if let v = c.callerId { data["callerId"] = v }
        return data
    }

    /// The native call in progress, if any, so the app can show it when it is opened during the call.
    @objc func getNativeCall(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            for (uuid, c) in self.calls where c.native { call.resolve(self.nativeCallInfo(uuid, c)); return }
            call.resolve(["active": false])
        }
    }

    @objc func setNativeMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        DispatchQueue.main.async {
            for (uuid, c) in self.calls where c.native {
                // Through CallKit, so the system call screen shows the same mute state.
                self.controller.request(CXTransaction(action: CXSetMutedCallAction(call: uuid, muted: muted))) { _ in }
            }
            call.resolve()
        }
    }

    private func startNativeCall(_ uuid: UUID, settings: NativeCallSettings) {
        let native = NativeAudioCall(callId: uuid, settings: settings)
        nativeCalls[uuid] = native
        native.onState = { [weak self] state in
            guard let self = self else { return }
            if var c = self.calls[uuid] {
                c.nativeState = state.rawValue
                self.calls[uuid] = c
                var data = self.nativeCallInfo(uuid, c)
                if state == .ended || state == .failed { data["active"] = false }
                self.notifyListeners("nativeCall", data: data, retainUntilConsumed: true)
            }
            if state == .ended { self.finish(uuid, reason: .remoteEnded) }
            if state == .failed { self.finish(uuid, reason: .failed) }
        }
        if let c = calls[uuid] { notifyListeners("nativeCall", data: nativeCallInfo(uuid, c), retainUntilConsumed: true) }
        native.start()
    }

    @objc func endAll(_ call: CAPPluginCall) {
        // "The call inside the app is over": never a native call, which the web layer does not run and must not end by accident.
        for uuid in Array(calls.keys) where calls[uuid]?.native != true { finish(uuid, reason: .remoteEnded) }
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
        if let native = nativeCalls.removeValue(forKey: uuid) { native.hangUp() }
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
        for (_, native) in nativeCalls { native.hangUp() }
        nativeCalls.removeAll()
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        if var c = calls[action.callUUID] {
            c.answered = true
            c.timeout?.cancel()
            // Answered from the app already: the app knows, do not tell it again (that would restart the call).
            let answeredInApp = answeredByApp.remove(action.callUUID) != nil
            if !answeredInApp, c.callType == "audio", let settings = NativeCallSettings.load() {
                // Answered on the system call screen (possibly on a locked phone): native code carries the call. The web layer is
                // NOT told to answer; it only shows the call if the app is opened.
                c.native = true
                calls[action.callUUID] = c
                nativeAudioUsed = true
                NativeAudioCall.prepareAudioSession()
                startNativeCall(action.callUUID, settings: settings)
            } else {
                calls[action.callUUID] = c
                // CallKit is about to activate this app's audio session. Make sure it is mixable first, so that activation does
                // not take the microphone and speaker away from the web view, where this call's audio runs.
                yieldAudioToWebView()
                if !answeredInApp { event("callAnswered", action.callUUID, c) }
            }
        }
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        if var c = calls[action.callUUID], c.native {
            c.muted = action.isMuted
            calls[action.callUUID] = c
            nativeCalls[action.callUUID]?.setMuted(action.isMuted)
            notifyListeners("nativeCall", data: nativeCallInfo(action.callUUID, c), retainUntilConsumed: true)
        }
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let c = calls[action.callUUID] {
            c.timeout?.cancel()
            calls[action.callUUID] = nil
            if let native = nativeCalls.removeValue(forKey: action.callUUID) {
                native.hangUp()
                var data = nativeCallInfo(action.callUUID, c)
                data["active"] = false
                data["state"] = "ended"
                notifyListeners("nativeCall", data: data, retainUntilConsumed: true)
            } else if !c.answered, let settings = NativeCallSettings.load() {
                // Declined on the system call screen: tell the server now, so the caller stops ringing even if the web view is asleep.
                NativeAudioCall.tellServerEnded(callId: action.callUUID, settings: settings)
            }
            if calls.isEmpty { endKeepAlive() }
            if !c.native { event(c.answered ? "callEnded" : "callDeclined", action.callUUID, c) }
        }
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        if nativeCalls.isEmpty {
            // The web view owns this call's audio: do not claim the session (see yieldAudioToWebView).
            yieldAudioToWebView()
        } else {
            // A native call: this is the moment the microphone and speaker may start.
            NativeAudioCall.audioSessionActivated(audioSession)
        }
    }
    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        if nativeAudioUsed { NativeAudioCall.audioSessionDeactivated(audioSession) }
    }
}
