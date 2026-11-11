import Foundation
import AVFoundation
import WebRTC

/// What the web layer hands over while the app is open, kept on the phone, so that a call can be set up while the web view is
/// asleep (phone locked): where the server is, the public API key, this phone's call key, and relay servers.
struct NativeCallSettings {
    let baseURL: String
    let apiKey: String
    let callKey: String
    let iceServers: [[String: Any]]

    private static let defaultsKey = "gayze.nativeCallSettings"

    static func load() -> NativeCallSettings? {
        guard let stored = UserDefaults.standard.dictionary(forKey: defaultsKey) else { return nil }
        let base = stored["baseURL"] as? String ?? ""
        let api = stored["apiKey"] as? String ?? ""
        let key = stored["callKey"] as? String ?? ""
        if base.isEmpty || api.isEmpty || key.isEmpty { return nil }
        let servers = stored["iceServers"] as? [[String: Any]] ?? []
        return NativeCallSettings(baseURL: base, apiKey: api, callKey: key, iceServers: servers)
    }

    static func save(baseURL: String, apiKey: String, callKey: String, iceServers: [[String: Any]]) {
        // Only plain strings and string lists are kept, so the dictionary is always storable.
        var clean: [[String: Any]] = []
        for server in iceServers {
            var urls: [String] = []
            if let list = server["urls"] as? [String] { urls = list } else if let one = server["urls"] as? String { urls = [one] }
            if urls.isEmpty { continue }
            var entry: [String: Any] = ["urls": urls]
            if let username = server["username"] as? String { entry["username"] = username }
            if let credential = server["credential"] as? String { entry["credential"] = credential }
            clean.append(entry)
        }
        let value: [String: Any] = ["baseURL": baseURL, "apiKey": apiKey, "callKey": callKey, "iceServers": clean]
        UserDefaults.standard.set(value, forKey: defaultsKey)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
    }

    func rtcIceServers() -> [RTCIceServer] {
        var out: [RTCIceServer] = []
        for server in iceServers {
            guard let urls = server["urls"] as? [String], !urls.isEmpty else { continue }
            let username = server["username"] as? String
            let credential = server["credential"] as? String
            out.append(RTCIceServer(urlStrings: urls, username: username, credential: credential))
        }
        if out.isEmpty { out.append(RTCIceServer(urlStrings: ["stun:stun.cloudflare.com:3478"])) }
        return out
    }
}

/// One audio call carried entirely by native code: microphone, WebRTC and playback, with CallKit owning the audio session.
///
/// It exists because the web view cannot do this on a locked phone: WebKit will not start the microphone for a page that is not
/// visible, and the web view is put to sleep moments after the call is answered. Call setup uses the server's call mailbox over
/// plain HTTPS (see the native_call_* functions): say "answered", read the caller's offer, leave the answer. The other phone can
/// be this same native code or the web app; both speak the same mailbox.
final class NativeAudioCall: NSObject, RTCPeerConnectionDelegate {
    enum State: String { case connecting, connected, ended, failed }

    let callId: UUID
    /// Called on the main queue.
    var onState: ((State) -> Void)?

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()

    private let settings: NativeCallSettings
    private let work = DispatchQueue(label: "co.gayze.nativecall")
    private var pc: RTCPeerConnection?
    private var audioTrack: RTCAudioTrack?
    private var poll: DispatchSourceTimer?
    private var state: State = .connecting
    private var finished = false
    private var answering = false
    private var fetchingOffer = false
    private var checkingStatus = false
    private var lastOfferId: Int64 = 0
    private var ticks = 0
    private var connectedOnce = false
    private var unhealthySince: Date?
    private let startedAt = Date()

    init(callId: UUID, settings: NativeCallSettings) {
        self.callId = callId
        self.settings = settings
        super.init()
    }

    // MARK: Audio session (CallKit owns it; WebRTC must not start audio by itself)

    /// Call before CallKit activates the session for a native call.
    static func prepareAudioSession() {
        let rtc = RTCAudioSession.sharedInstance()
        rtc.useManualAudio = true
        rtc.isAudioEnabled = false
        let config = RTCAudioSessionConfiguration.webRTC()
        config.category = AVAudioSession.Category.playAndRecord.rawValue
        config.mode = AVAudioSession.Mode.voiceChat.rawValue
        config.categoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
        RTCAudioSessionConfiguration.setWebRTC(config)
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP])
    }

    static func audioSessionActivated(_ session: AVAudioSession) {
        let rtc = RTCAudioSession.sharedInstance()
        rtc.audioSessionDidActivate(session)
        rtc.isAudioEnabled = true
    }

    static func audioSessionDeactivated(_ session: AVAudioSession) {
        let rtc = RTCAudioSession.sharedInstance()
        rtc.audioSessionDidDeactivate(session)
        rtc.isAudioEnabled = false
    }

    // MARK: Lifecycle

    func start() {
        work.async { self.begin() }
    }

    /// The person hung up on this phone.
    func hangUp() {
        work.async { self.finish(.ended, tellServer: true, why: "hung up on this phone") }
    }

    func setMuted(_ muted: Bool) {
        work.async {
            self.audioTrack?.isEnabled = !muted
            self.log(muted ? "native: microphone muted" : "native: microphone on")
        }
    }

    private func begin() {
        log("native: answering on the system call screen")
        rpc("native_call_answer", ["p_call_id": callId.uuidString.lowercased(), "p_key": settings.callKey]) { result in
            self.work.async {
                if self.finished { return }
                guard let status = result as? String else {
                    self.finish(.failed, tellServer: false, why: "the server did not accept this phone for the call")
                    return
                }
                if status == "ended" {
                    self.finish(.ended, tellServer: false, why: "the caller had already hung up")
                    return
                }
                self.makeConnection()
            }
        }
    }

    private func makeConnection() {
        let config = RTCConfiguration()
        config.iceServers = settings.rtcIceServers()
        config.sdpSemantics = .unifiedPlan
        config.bundlePolicy = .maxBundle
        config.rtcpMuxPolicy = .require
        config.continualGatheringPolicy = .gatherOnce
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let created: RTCPeerConnection? = NativeAudioCall.factory.peerConnection(with: config, constraints: constraints, delegate: self)
        guard let connection = created else {
            finish(.failed, tellServer: true, why: "could not create the connection")
            return
        }
        pc = connection

        let source = NativeAudioCall.factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let track = NativeAudioCall.factory.audioTrack(with: source, trackId: "gayze-audio")
        audioTrack = track
        _ = connection.add(track, streamIds: ["gayze"])
        log("native: connection ready, waiting for the offer")

        let timer = DispatchSource.makeTimerSource(queue: work)
        timer.schedule(deadline: .now(), repeating: .milliseconds(700))
        timer.setEventHandler { self.tick() }
        poll = timer
        timer.resume()
    }

    private func tick() {
        if finished { return }
        ticks += 1
        // Before the call is up, keep looking for the offer. Afterwards only when the connection is in trouble (the caller sends
        // a fresh offer to repair it).
        if !answering && !fetchingOffer && (state != .connected || unhealthySince != nil) { fetchOffer() }
        if ticks % 3 == 0 && !checkingStatus { checkStatus() }
        if !connectedOnce && Date().timeIntervalSince(startedAt) > 60 {
            finish(.failed, tellServer: true, why: "could not connect within a minute")
            return
        }
        if let since = unhealthySince, Date().timeIntervalSince(since) > 30 {
            finish(.failed, tellServer: true, why: "the connection was lost for 30 seconds")
        }
    }

    private func checkStatus() {
        checkingStatus = true
        rpc("native_call_status", ["p_call_id": callId.uuidString.lowercased(), "p_key": settings.callKey]) { result in
            self.work.async {
                self.checkingStatus = false
                if self.finished { return }
                if let status = result as? String, status == "ended" {
                    self.finish(.ended, tellServer: false, why: "the other person hung up")
                }
            }
        }
    }

    private func fetchOffer() {
        fetchingOffer = true
        let args: [String: Any] = ["p_call_id": callId.uuidString.lowercased(), "p_key": settings.callKey, "p_kind": "offer", "p_after": lastOfferId]
        rpc("native_call_get_signal", args) { result in
            self.work.async {
                self.fetchingOffer = false
                if self.finished || self.answering { return }
                guard let rows = result as? [[String: Any]], let row = rows.first else { return }
                guard let idNumber = row["id"] as? NSNumber,
                      let payload = row["payload"] as? [String: Any],
                      let description = payload["sdp"] as? [String: Any],
                      let sdp = description["sdp"] as? String else { return }
                self.answer(offerId: idNumber.int64Value, sdp: sdp)
            }
        }
    }

    private func answer(offerId: Int64, sdp: String) {
        guard let connection = pc else { return }
        answering = true
        lastOfferId = offerId
        log("native: got offer (from the call mailbox)")
        let offer = RTCSessionDescription(type: .offer, sdp: sdp)
        connection.setRemoteDescription(offer) { error in
            self.work.async {
                if let error = error {
                    self.log("native: offer rejected: \(error.localizedDescription)")
                    self.answering = false
                    return
                }
                let constraints = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true"], optionalConstraints: nil)
                connection.answer(for: constraints) { description, error in
                    self.work.async {
                        guard let description = description else {
                            self.log("native: could not make an answer: \(error?.localizedDescription ?? "unknown")")
                            self.answering = false
                            return
                        }
                        connection.setLocalDescription(description) { error in
                            self.work.async {
                                if let error = error {
                                    self.log("native: answer rejected locally: \(error.localizedDescription)")
                                    self.answering = false
                                    return
                                }
                                self.sendAnswerWhenRoutesAreKnown(connection, waited: 0)
                            }
                        }
                    }
                }
            }
        }
    }

    /// The answer carries every network route found, because there is no live channel to send them one by one afterwards.
    private func sendAnswerWhenRoutesAreKnown(_ connection: RTCPeerConnection, waited: Double) {
        if finished { return }
        if connection.iceGatheringState != .complete && waited < 3.0 {
            work.asyncAfter(deadline: .now() + 0.15) { self.sendAnswerWhenRoutesAreKnown(connection, waited: waited + 0.15) }
            return
        }
        guard let local = connection.localDescription else {
            answering = false
            return
        }
        let payload: [String: Any] = ["sdp": ["type": "answer", "sdp": local.sdp]]
        let args: [String: Any] = ["p_call_id": callId.uuidString.lowercased(), "p_key": settings.callKey, "p_kind": "answer", "p_payload": payload]
        rpc("native_call_post_signal", args) { result in
            self.work.async {
                self.answering = false
                self.log(result == nil ? "native: the answer could not be left in the mailbox" : "native: send answer")
            }
        }
    }

    private func finish(_ final: State, tellServer: Bool, why: String) {
        if finished { return }
        finished = true
        state = final
        poll?.cancel()
        poll = nil
        log("native: call \(final.rawValue) (\(why))")
        if tellServer {
            rpc("native_call_end", ["p_call_id": callId.uuidString.lowercased(), "p_key": settings.callKey]) { _ in }
        }
        pc?.close()
        pc = nil
        audioTrack = nil
        let callback = onState
        DispatchQueue.main.async { callback?(final) }
    }

    // MARK: Server (plain HTTPS; the call key is the credential)

    /// Declined or ended from the system call screen before a native call object existed.
    static func tellServerEnded(callId: UUID, settings: NativeCallSettings) {
        post(settings: settings, function: "native_call_end", args: ["p_call_id": callId.uuidString.lowercased(), "p_key": settings.callKey]) { _ in }
    }

    private func rpc(_ function: String, _ args: [String: Any], done: @escaping (Any?) -> Void) {
        NativeAudioCall.post(settings: settings, function: function, args: args, done: done)
    }

    /// Calls done with the decoded JSON reply (a string, a list, a number...) or nil when the request failed or returned null.
    private static func post(settings: NativeCallSettings, function: String, args: [String: Any], done: @escaping (Any?) -> Void) {
        guard let url = URL(string: settings.baseURL + "/rest/v1/rpc/" + function),
              let body = try? JSONSerialization.data(withJSONObject: args, options: []) else {
            done(nil)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(settings.apiKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer " + settings.apiKey, forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let http = response as? HTTPURLResponse, http.statusCode >= 200, http.statusCode < 300, let data = data, !data.isEmpty else {
                done(nil)
                return
            }
            let decoded = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            if decoded is NSNull { done(nil) } else { done(decoded) }
        }
        task.resume()
    }

    /// Short step names only (never the connection description or the key), written to the same call log the app writes to.
    private func log(_ event: String) {
        NSLog("[GAYZE] %@", event)
        let args: [String: Any] = ["p_call_id": callId.uuidString.lowercased(), "p_key": settings.callKey, "p_event": String(event.prefix(160))]
        NativeAudioCall.post(settings: settings, function: "native_call_log", args: args) { _ in }
    }

    // MARK: RTCPeerConnectionDelegate

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        work.async {
            if self.finished { return }
            switch newState {
            case .connected, .completed:
                self.unhealthySince = nil
                if self.state != .connected {
                    self.state = .connected
                    self.connectedOnce = true
                    self.log("native: ice connected")
                    let callback = self.onState
                    DispatchQueue.main.async { callback?(.connected) }
                }
            case .disconnected, .failed:
                if self.unhealthySince == nil {
                    self.unhealthySince = Date()
                    self.log(newState == .failed ? "native: ice failed" : "native: ice disconnected")
                }
            default:
                break
            }
        }
    }
}
