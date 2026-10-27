import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "./AuthContext";
import { AUTH_TIMEOUT_MS } from "@/lib/authTimeout";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), profile: vi.fn(), signIn: vi.fn(), unsubscribe: vi.fn(),
  listener: null as null | ((event: string, session: Session | null) => void),
  signal: null as AbortSignal | null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signInWithPassword: mocks.signIn,
      onAuthStateChange: (callback: typeof mocks.listener) => {
        mocks.listener = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          abortSignal: (signal: AbortSignal) => {
            mocks.signal = signal;
            return { maybeSingle: () => mocks.profile(id) };
          },
        }),
      }),
    }),
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function session(id = "parent", token = id): Session {
  return { user: { id }, access_token: token } as Session;
}
const profile = (role: string | null = "ortu") => ({ data: role ? { role, departemen_id: null } : null, error: null });
const stored = (value: Session | null) => ({ data: { session: value }, error: null });
let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return (
    <>
      <div data-testid="loading">{String(auth.isLoading)}</div>
      <div data-testid="user">{auth.user?.id ?? "none"}</div>
      <div data-testid="role">{auth.role ?? "none"}</div>
      <div data-testid="error">{auth.authError ?? "none"}</div>
      <button onClick={() => void auth.retryAuth()}>Retry</button>
    </>
  );
}
async function start() {
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => {});
}
async function event(value: Session | null, name = "SIGNED_IN") {
  await act(async () => {
    expect(mocks.listener!(name, value)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(stored(null));
  mocks.profile.mockResolvedValue(profile());
  mocks.listener = null;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("AuthProvider recovery and session ordering", () => {
  it("waits for the parent's profile before releasing the route", async () => {
    const request = deferred<ReturnType<typeof profile>>();
    mocks.getSession.mockResolvedValue(stored(session()));
    mocks.profile.mockReturnValue(request.promise);
    await start();
    expect(auth.isLoading).toBe(true);
    expect(auth.role).toBeNull();
    await act(async () => request.resolve(profile()));
    expect(auth.isLoading).toBe(false);
    expect(auth.role).toBe("ortu");
  });

  it("settles a stuck session restore and allows retry without deleting the session", async () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}));
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS); });
    expect(auth.isLoading).toBe(false);
    expect(auth.authError).toBeTruthy();
    mocks.getSession.mockResolvedValue(stored(session()));
    await act(async () => { fireEvent.click(screen.getByText("Retry")); });
    expect(auth.authError).toBeNull();
    expect(auth.role).toBe("ortu");
  });

  it("handles rejected session restore", async () => {
    mocks.getSession.mockRejectedValue(new Error("refresh failed"));
    await start();
    expect(auth.isLoading).toBe(false);
    expect(auth.authError).toBeTruthy();
  });

  it("aborts a stuck profile request and does not apply its late result", async () => {
    const request = deferred<ReturnType<typeof profile>>();
    mocks.getSession.mockResolvedValue(stored(session()));
    mocks.profile.mockReturnValue(request.promise);
    await start();
    const signal = mocks.signal;
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS); });
    expect(signal?.aborted).toBe(true);
    expect(auth.isLoading).toBe(false);
    expect(auth.authError).toBeTruthy();
    await act(async () => request.resolve(profile("admin")));
    expect(auth.role).toBeNull();
  });

  it("reports profile errors and recovers on retry", async () => {
    mocks.getSession.mockResolvedValue(stored(session()));
    mocks.profile.mockResolvedValue({ data: null, error: { message: "network unavailable" } });
    await start();
    expect(auth.authError).toBeTruthy();
    expect(auth.role).toBeNull();
    mocks.profile.mockResolvedValue(profile());
    await act(async () => { await auth.retryAuth(); });
    expect(auth.role).toBe("ortu");
    expect(auth.authError).toBeNull();
  });

  it("keeps a new Google account distinguishable from a network error", async () => {
    mocks.getSession.mockResolvedValue(stored(session("new-google")));
    mocks.profile.mockResolvedValue(profile(null));
    await start();
    expect(auth.user?.id).toBe("new-google");
    expect(auth.role).toBeNull();
    expect(auth.isLoading).toBe(false);
    expect(auth.authError).toBeNull();
  });

  it("does not restore an old profile after sign-out", async () => {
    const request = deferred<ReturnType<typeof profile>>();
    mocks.getSession.mockResolvedValue(stored(session()));
    mocks.profile.mockReturnValue(request.promise);
    await start();
    await event(null, "SIGNED_OUT");
    await act(async () => request.resolve(profile()));
    expect(auth.user).toBeNull();
    expect(auth.role).toBeNull();
    expect(auth.isLoading).toBe(false);
  });

  it("clears SPMB registration drafts on SIGNED_OUT only", async () => {
    mocks.getSession.mockResolvedValue(stored(session()));
    await start();
    localStorage.setItem("spmb-admin-draft:v1:parent", JSON.stringify({ savedAt: 1, form: {} }));
    localStorage.setItem("unrelated-key", "kept");
    await event(null, "INITIAL_SESSION");
    expect(localStorage.getItem("spmb-admin-draft:v1:parent")).not.toBeNull();
    await event(null, "SIGNED_OUT");
    expect(localStorage.getItem("spmb-admin-draft:v1:parent")).toBeNull();
    expect(localStorage.getItem("unrelated-key")).toBe("kept");
    localStorage.removeItem("unrelated-key");
  });

  it("keeps a verified portal open while the same account refreshes its token", async () => {
    mocks.getSession.mockResolvedValue(stored(session()));
    await start();
    const refresh = deferred<ReturnType<typeof profile>>();
    mocks.profile.mockReturnValue(refresh.promise);
    await event(session("parent", "refreshed-token"), "TOKEN_REFRESHED");
    expect(auth.isLoading).toBe(false);
    expect(auth.role).toBe("ortu");
    await act(async () => refresh.resolve(profile()));
    expect(auth.session?.access_token).toBe("refreshed-token");
  });

  it("ignores an older account's profile after switching accounts", async () => {
    const old = deferred<ReturnType<typeof profile>>();
    mocks.getSession.mockResolvedValue(stored(session("old")));
    mocks.profile.mockImplementation((id: string) => id === "old" ? old.promise : Promise.resolve(profile("admin_tu")));
    await start();
    await event(session("new"));
    await act(async () => old.resolve(profile("ortu")));
    expect(auth.user?.id).toBe("new");
    expect(auth.role).toBe("admin_tu");
  });

  it("ignores an old getSession result after a newer login event", async () => {
    const restore = deferred<ReturnType<typeof stored>>();
    mocks.getSession.mockReturnValue(restore.promise);
    await start();
    await event(session("new"));
    await act(async () => restore.resolve(stored(session("old"))));
    expect(auth.user?.id).toBe("new");
    expect(auth.role).toBe("ortu");
  });

  it("does not let bootstrap beat a newer deferred auth event", async () => {
    const restore = deferred<ReturnType<typeof stored>>();
    mocks.getSession.mockReturnValue(restore.promise);
    await start();
    await act(async () => {
      mocks.listener!("SIGNED_IN", session("new"));
      restore.resolve(stored(session("old")));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(auth.user?.id).toBe("new");
    expect(mocks.profile).toHaveBeenCalledTimes(1);
  });

  it("processes the latest event when multiple events arrive together", async () => {
    await start();
    await act(async () => {
      mocks.listener!("SIGNED_IN", session("old"));
      mocks.listener!("TOKEN_REFRESHED", session("new"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(auth.user?.id).toBe("new");
    expect(mocks.profile).toHaveBeenCalledTimes(1);
  });

  it("resolves password login with the role and shares a pending event lookup", async () => {
    await start();
    const next = session();
    const request = deferred<ReturnType<typeof profile>>();
    mocks.profile.mockReturnValue(request.promise);
    mocks.signIn.mockImplementation(() => {
      mocks.listener!("SIGNED_IN", next);
      return Promise.resolve({ data: { session: next, user: next.user }, error: null });
    });
    let result!: Awaited<ReturnType<typeof auth.signIn>>;
    let login!: Promise<void>;
    await act(async () => { login = auth.signIn("parent@example.com", "password").then(value => { result = value; }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); request.resolve(profile()); await login; });
    expect(result).toEqual({ error: null, role: "ortu" });
    expect(auth.isLoading).toBe(false);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
  });

  it("settles password login that never responds", async () => {
    await start();
    mocks.signIn.mockReturnValue(new Promise(() => {}));
    let result!: Awaited<ReturnType<typeof auth.signIn>>;
    await act(async () => {
      const login = auth.signIn("parent@example.com", "password").then(value => { result = value; });
      await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
      await login;
    });
    expect(result.error).toBeTruthy();
  });

  it("cancels deferred callbacks on unmount", async () => {
    const view = render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {});
    mocks.listener!("SIGNED_IN", session());
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
