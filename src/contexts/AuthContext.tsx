import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { withAuthTimeout } from "@/lib/authTimeout";
import { clearAllSpmbAdminDrafts } from "@/lib/spmbAdminDraft";

export type UserRole = "admin" | "admin_tu" | "kepala_sekolah" | "guru" | "keuangan" | "siswa" | "pustakawan" | "kasir" | "ortu" | "sekretaris_yayasan";
type SignInResult = { error: string | null; role?: UserRole | null };
interface AuthState {
  user: User | null;
  session: Session | null;
  role: UserRole | null;
  departemenId: string | null;
  isLoading: boolean;
  authError: string | null;
}
interface AuthContextType extends AuthState {
  retryAuth: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  signInWithGoogle: (redirectTo: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<{ error: string | null }>;
}
const emptyState: AuthState = {
  user: null, session: null, role: null, departemenId: null, isLoading: false, authError: null,
};
const connectionError = "Akun belum berhasil diperiksa. Periksa koneksi internet lalu coba lagi.";
const missingRoleError = "Akses akun belum tersedia. Silakan coba lagi atau hubungi admin sekolah.";
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...emptyState, isLoading: true });
  const active = useRef(false);
  const revision = useRef(0);
  const profileRequest = useRef<AbortController | null>(null);
  const pending = useRef<{ key: string; promise: Promise<SignInResult> } | null>(null);

  const resolveSession = useCallback((nextSession: Session | null): Promise<SignInResult> => {
    const key = nextSession ? nextSession.user.id + ":" + nextSession.access_token : "";
    if (nextSession && pending.current?.key === key) return pending.current.promise;
    const requestRevision = ++revision.current;
    profileRequest.current?.abort();
    pending.current = null;
    if (!nextSession) {
      if (active.current) setState(emptyState);
      return Promise.resolve({ error: null, role: null });
    }

    const controller = new AbortController();
    profileRequest.current = controller;
    if (active.current) {
      setState(previous => ({
        ...previous,
        session: nextSession,
        user: nextSession.user,
        role: previous.user?.id === nextSession.user.id ? previous.role : null,
        departemenId: previous.user?.id === nextSession.user.id ? previous.departemenId : null,
        // Revalidation of the same verified account must not unmount open forms.
        isLoading: previous.isLoading || previous.user?.id !== nextSession.user.id || !previous.role || !!previous.authError,
        authError: null,
      }));
    }
    const promise = (async (): Promise<SignInResult> => {
      try {
        const { data, error } = await withAuthTimeout(
          supabase.from("users_profile").select("role, departemen_id")
            .eq("id", nextSession.user.id).abortSignal(controller.signal).maybeSingle(),
          () => controller.abort(),
        );
        if (error) throw error;
        if (!active.current || revision.current !== requestRevision) {
          return { error: "Sesi berubah. Silakan coba lagi." };
        }
        const nextRole = data?.role ? data.role as UserRole : null;
        setState({
          session: nextSession, user: nextSession.user,
          role: nextRole, departemenId: data?.departemen_id || null,
          isLoading: false, authError: null,
        });
        // Missing profiles remain distinguishable from network failures:
        // new Google accounts may still need to complete parent registration.
        return { error: nextRole ? null : missingRoleError, role: nextRole };
      } catch {
        if (active.current && revision.current === requestRevision) {
          setState({
            session: nextSession, user: nextSession.user, role: null,
            departemenId: null, isLoading: false, authError: connectionError,
          });
        }
        return { error: connectionError };
      } finally {
        if (revision.current === requestRevision) {
          pending.current = null;
          profileRequest.current = null;
        }
      }
    })();
    pending.current = { key, promise };
    return promise;
  }, []);

  const retryAuth = useCallback(async () => {
    const requestRevision = ++revision.current;
    profileRequest.current?.abort();
    pending.current = null;
    if (active.current) setState(previous => ({ ...previous, role: null, departemenId: null, isLoading: true, authError: null }));
    try {
      const { data, error } = await withAuthTimeout(supabase.auth.getSession());
      if (!active.current || revision.current !== requestRevision) return;
      if (error) throw error;
      await resolveSession(data.session);
    } catch {
      if (active.current && revision.current === requestRevision) {
        setState(previous => ({ ...previous, role: null, departemenId: null, isLoading: false, authError: connectionError }));
      }
    }
  }, [resolveSession]);

  useEffect(() => {
    active.current = true;
    let eventSerial = 0;
    const deferred = new Set<ReturnType<typeof setTimeout>>();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const serial = ++eventSerial;
      // Return synchronously and defer profile queries until the auth lock is released.
      // Sign-out invalidates old profile requests immediately.
      if (!nextSession) {
        // Draf SPMB berisi data pribadi calon murid; jangan tertinggal di komputer bersama setelah logout.
        if (_event === "SIGNED_OUT") clearAllSpmbAdminDrafts();
        void resolveSession(null);
        return;
      }
      const key = nextSession.user.id + ":" + nextSession.access_token;
      if (pending.current?.key === key) return;
      // Invalidate old bootstrap/profile results before deferring the query.
      const eventRevision = ++revision.current;
      profileRequest.current?.abort();
      pending.current = null;
      const timer = setTimeout(() => {
        deferred.delete(timer);
        if (active.current && eventSerial === serial && revision.current === eventRevision) void resolveSession(nextSession);
      }, 0);
      deferred.add(timer);
    });
    void retryAuth();
    return () => {
      active.current = false;
      // This counter tracks operations, not a DOM ref: cleanup must invalidate the latest one.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++revision.current;
      profileRequest.current?.abort();
      pending.current = null;
      deferred.forEach(clearTimeout);
      subscription.unsubscribe();
    };
  }, [resolveSession, retryAuth]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await withAuthTimeout(supabase.auth.signInWithPassword({ email, password }));
      if (error) {
        const messages: Record<string, string> = {
          "Invalid login credentials": "Email atau password salah",
          "Email not confirmed": "Email belum dikonfirmasi. Periksa inbox Anda.",
        };
        return { error: messages[error.message] || error.message };
      }
      return await resolveSession(data.session);
    } catch {
      return { error: connectionError };
    }
  }, [resolveSession]);

  const signInWithGoogle = useCallback(async (redirectTo: string) => {
    try {
      const { error } = await withAuthTimeout(supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } }));
      return { error: error?.message ?? null };
    } catch { return { error: connectionError }; }
  }, []);

  const signOut = useCallback(async () => {
    await withAuthTimeout(supabase.auth.signOut());
    await resolveSession(null);
  }, [resolveSession]);

  const changePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  };

  return (
    <AuthContext.Provider value={{ ...state, retryAuth, signIn, signInWithGoogle, signOut, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
