import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type UserRole = "admin" | "admin_tu" | "kepala_sekolah" | "guru" | "keuangan" | "siswa" | "pustakawan" | "kasir" | "ortu" | "sekretaris_yayasan";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: UserRole | null;
  departemenId: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: (redirectTo: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [departemenId, setDepartemenId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRole = async (userId: string) => {
    const { data } = await supabase
      .from("users_profile")
      .select("role, departemen_id")
      .eq("id", userId)
      .single();
    setRole(data?.role ? data.role as UserRole : null);
    setDepartemenId(data?.departemen_id || null);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchRole(session.user.id), 0);
        } else {
          setRole(null);
          setDepartemenId(null);
        }
        setIsLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const messages: Record<string, string> = {
        "Invalid login credentials": "Email atau password salah",
        "Email not confirmed": "Email belum dikonfirmasi. Periksa inbox Anda.",
      };
      return { error: messages[error.message] || error.message };
    }
    // Set state directly from the sign-in response instead of waiting for the
    // async onAuthStateChange event, so callers can navigate right after this
    // resolves without racing a route guard that still sees `user === null`.
    setSession(data.session);
    setUser(data.user);
    setIsLoading(false);
    if (data.user) {
      await fetchRole(data.user.id);
    }
    return { error: null };
  };

  const signInWithGoogle = async (redirectTo: string) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
    setDepartemenId(null);
  };

  const changePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    return { error: null };
  };

  return (
    <AuthContext.Provider value={{ user, session, role, departemenId, isLoading, signIn, signInWithGoogle, signOut, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
