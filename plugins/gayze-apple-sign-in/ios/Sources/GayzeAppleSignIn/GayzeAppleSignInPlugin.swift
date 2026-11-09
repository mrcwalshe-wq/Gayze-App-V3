import Foundation
import Capacitor
import AuthenticationServices

/// Native "Sign in with Apple". Returns the identity token; the web layer exchanges it with Supabase.
/// The nonce passed in must already be SHA-256 hashed (hex). Supabase gets the raw value.
@objc(GayzeAppleSignInPlugin)
public class GayzeAppleSignInPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GayzeAppleSignInPlugin"
    public let jsName = "GayzeAppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.pendingCall != nil {
                call.reject("Sign in with Apple is already in progress.")
                return
            }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            if let nonce = call.getString("nonce") { request.nonce = nonce }
            self.pendingCall = call
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }
}

extension GayzeAppleSignInPlugin: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple did not return an identity token.")
            return
        }
        call.resolve([
            "identityToken": token,
            "user": credential.user,
            "email": credential.email as Any,
            "givenName": credential.fullName?.givenName as Any,
            "familyName": credential.fullName?.familyName as Any
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        let nsError = error as NSError
        if nsError.domain == ASAuthorizationError.errorDomain && nsError.code == ASAuthorizationError.canceled.rawValue {
            call.reject("cancelled", "cancelled")
        } else {
            call.reject(error.localizedDescription)
        }
    }
}
