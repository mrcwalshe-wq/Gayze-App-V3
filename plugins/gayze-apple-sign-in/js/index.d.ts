export interface AppleAuthResult { identityToken: string; user: string; email?: string | null; givenName?: string | null; familyName?: string | null }
export interface GayzeAppleSignInPlugin { authorize(options: { nonce: string }): Promise<AppleAuthResult>; }
export declare const GayzeAppleSignIn: GayzeAppleSignInPlugin;
