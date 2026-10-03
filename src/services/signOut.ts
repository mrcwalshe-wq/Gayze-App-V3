interface SignOutOperations {
  releasePush(): Promise<unknown> | unknown;
  clearLocalSession(): void;
  signOut(): Promise<unknown> | unknown;
  reload(): void;
}

function settleWithin(work: () => Promise<unknown> | unknown, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    Promise.resolve().then(work).then(finish, finish);
  });
}

export async function finishSignOut(operations: SignOutOperations, timeoutMs = 1500): Promise<void> {
  try {
    try {
      void Promise.resolve(operations.releasePush()).catch(() => {});
    } catch {
      // Push revocation is best-effort and never gates sign-out.
    }

    try {
      operations.clearLocalSession();
    } catch {
      // The signed-out UI and reload still proceed if browser storage is unavailable.
    }

    await settleWithin(operations.signOut, timeoutMs);
  } finally {
    operations.reload();
  }
}
