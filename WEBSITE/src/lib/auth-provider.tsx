"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  createClient,
  createRecoveryClient,
  isSupabaseConfigured,
} from "@/lib/supabase";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { authApi, getAuthDeviceName } from "@/services/api";
import { hasAdminAccess } from "@/lib/admin-access";
import {
  clearSupabaseSession,
  readPersistedSupabaseSession,
  persistSupabaseSession,
  refreshPersistedSupabaseSession,
} from "@/lib/supabase-session";
import type { User as TrustPayUser, Wallet } from "@/types";

type AuthMode = "supabase" | "local";

type AuthUser = SupabaseUser & {
  appProfile?: TrustPayUser;
  role?: TrustPayUser["role"];
  canAccessAdmin?: boolean;
};

type AppSession = Session & {
  authMode?: AuthMode;
};

type BootstrapResponse = {
  user: TrustPayUser;
  wallets: Wallet[];
};

type RegisterResponse = {
  user: TrustPayUser;
  session: AppSession | null;
  authMode?: AuthMode;
};

type LoginResponse = {
  user: TrustPayUser;
  session: AppSession | null;
  authMode?: AuthMode;
};

type AuthDebugState = {
  stage: string;
  authMode?: AuthMode;
  hasSession?: boolean;
  error?: string;
  email?: string | null;
  role?: string | null;
  profileRole?: string | null;
  isLoading?: boolean;
};

function setAuthDebug(state: AuthDebugState) {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
    return;
  }

  (
    window as Window & { __TRUSTPAY_AUTH_DEBUG__?: AuthDebugState }
  ).__TRUSTPAY_AUTH_DEBUG__ = state;
}

interface AuthContextType {
  user: AuthUser | null;
  profile: TrustPayUser | null;
  session: AppSession | null;
  isLoading: boolean;
  signIn: (
    email: string,
    password: string,
    destination?: "/admin" | "/dashboard",
  ) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    phone: string,
    fullName: string,
    transactionPin: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<TrustPayUser | null>(null);
  const [session, setSession] = useState<AppSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const establishingSession = useRef(false);
  const sessionGeneration = useRef(0);
  const supabase = useMemo(
    () => (isSupabaseConfigured ? createClient() : null),
    [],
  );

  const applySession = useCallback(
    (nextSession: AppSession | null, nextProfile?: TrustPayUser | null) => {
      setSession(nextSession);
      setProfile(nextProfile ?? null);
      setUser(
        nextSession
          ? {
              ...nextSession.user,
              appProfile: nextProfile ?? undefined,
              role: nextProfile?.role ?? nextSession.user.role,
              canAccessAdmin: nextProfile?.canAccessAdmin === true,
            }
          : null,
      );
    },
    [],
  );

  const bootstrapSession = useCallback(
    async (nextSession: AppSession) => {
      const generation = sessionGeneration.current;
      setAuthDebug({
        stage: "bootstrap-start",
        authMode: nextSession.authMode,
        hasSession: Boolean(nextSession.access_token),
      });
      const { data } = await authApi.bootstrap(nextSession.access_token);
      const bootstrap = data as BootstrapResponse;
      if (generation === sessionGeneration.current) {
        applySession(nextSession, bootstrap.user);
      }
      setAuthDebug({
        stage: "bootstrap-complete",
        authMode: nextSession.authMode,
        hasSession: true,
      });
      return bootstrap;
    },
    [applySession],
  );

  const persistAndBootstrapSession = useCallback(
    async (nextSession: AppSession) => {
      await persistSupabaseSession(nextSession);
      return bootstrapSession(nextSession);
    },
    [bootstrapSession],
  );

  useEffect(() => {
    let isMounted = true;

    const initializeSession = async () => {
      try {
        const persistedSession =
          (await readPersistedSupabaseSession()) as AppSession | null;

        if (!isMounted || establishingSession.current) return;
        applySession(persistedSession);
        if (persistedSession) {
          await bootstrapSession(persistedSession);
        }
      } catch {
        if (isMounted && !establishingSession.current) applySession(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void initializeSession();

    let subscription: { unsubscribe: () => void } = {
      unsubscribe: () => undefined,
    };

    if (supabase) {
      const result = supabase.auth.onAuthStateChange(() => {
        if (establishingSession.current) return;
        void (async () => {
          const persistedSession =
            (await readPersistedSupabaseSession()) as AppSession | null;
          if (!isMounted || establishingSession.current) return;
          const activeSession = persistedSession;
          if (activeSession) {
            await bootstrapSession(activeSession).catch(() => undefined);
          } else {
            applySession(null);
          }
          setIsLoading(false);
        })();
      });
      subscription = result.data.subscription;
    }

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applySession, bootstrapSession, supabase]);

  useEffect(() => {
    const handleSessionUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<AppSession | null>;
      const nextSession = customEvent.detail ?? null;
      if (nextSession) {
        void bootstrapSession(nextSession).catch(() => undefined);
      } else {
        sessionGeneration.current += 1;
        applySession(null);
      }
    };

    window.addEventListener(
      "trustpay-auth-session-updated",
      handleSessionUpdate as EventListener,
    );

    return () => {
      window.removeEventListener(
        "trustpay-auth-session-updated",
        handleSessionUpdate as EventListener,
      );
    };
  }, [applySession, bootstrapSession]);

  const requireSupabase = useCallback(() => {
    if (!supabase) {
      throw new Error(
        "Supabase is not configured. Add the website Supabase environment variables to use authentication.",
      );
    }

    return supabase;
  }, [supabase]);

  const signIn = async (
    email: string,
    password: string,
    destination: "/admin" | "/dashboard" = "/dashboard",
  ) => {
    if (establishingSession.current) return;
    establishingSession.current = true;
    sessionGeneration.current += 1;
    applySession(null);
    try {
      setAuthDebug({
        stage: "login-request-start",
        hasSession: false,
      });

      let login: LoginResponse;
      try {
        const { data } = await authApi.login(
          email,
          password,
          getAuthDeviceName(),
        );
        login = data as LoginResponse;
        setAuthDebug({
          stage: "login-response",
          authMode: login.authMode,
          hasSession: Boolean(login.session?.access_token),
        });
      } catch (error) {
        setAuthDebug({
          stage: "login-request-error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }

      if (!login.session?.access_token || !login.session.refresh_token) {
        throw new Error("Invalid login response");
      }

      let staffAccess = false;
      if (login.authMode === "local") {
        setAuthDebug({
          stage: "local-session-persist-start",
          authMode: login.authMode,
          hasSession: true,
        });
        await persistSupabaseSession(login.session);
        try {
          const bootstrap = await bootstrapSession(login.session);
          staffAccess = hasAdminAccess(bootstrap.user);
          setAuthDebug({
            stage: "local-session-persisted",
            authMode: login.authMode,
            hasSession: true,
          });
        } catch (error) {
          setAuthDebug({
            stage: "local-bootstrap-failed",
            authMode: login.authMode,
            hasSession: true,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          await clearSupabaseSession().catch(() => undefined);
          throw error;
        }
      } else {
        const authClient = requireSupabase();
        const { data: sessionData, error } = await authClient.auth.setSession({
          access_token: login.session.access_token,
          refresh_token: login.session.refresh_token,
        });
        if (error) throw error;

        const sessionToPersist = (sessionData.session ??
          login.session) as AppSession;
        const bootstrap = await persistAndBootstrapSession(sessionToPersist);
        staffAccess = hasAdminAccess(bootstrap.user);
      }

      router.replace(
        staffAccess
          ? "/admin"
          : destination === "/admin"
            ? "/staff"
            : "/dashboard",
      );
    } catch (error) {
      sessionGeneration.current += 1;
      await clearSupabaseSession().catch(() => undefined);
      if (supabase)
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      applySession(null);
      throw error;
    } finally {
      establishingSession.current = false;
    }
  };

  const signUp = async (
    email: string,
    password: string,
    phone: string,
    fullName: string,
    transactionPin: string,
  ) => {
    const { data } = await authApi.register({
      email,
      phone,
      password,
      fullName: fullName.trim() || undefined,
      transactionPin,
      deviceName: getAuthDeviceName(),
    });
    const registered = data as RegisterResponse;

    if (registered.session?.access_token && registered.session.refresh_token) {
      if (registered.authMode === "local") {
        setAuthDebug({
          stage: "register-local-session-persist-start",
          authMode: registered.authMode,
          hasSession: true,
        });
        await persistSupabaseSession(registered.session);
        try {
          await bootstrapSession(registered.session);
          setAuthDebug({
            stage: "register-local-session-persisted",
            authMode: registered.authMode,
            hasSession: true,
          });
        } catch (error) {
          setAuthDebug({
            stage: "register-local-bootstrap-failed",
            authMode: registered.authMode,
            hasSession: true,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          await clearSupabaseSession().catch(() => undefined);
          throw error;
        }
      } else {
        const authClient = requireSupabase();
        const { data: sessionData, error } = await authClient.auth.setSession({
          access_token: registered.session.access_token,
          refresh_token: registered.session.refresh_token,
        });
        if (error) throw error;
        const sessionToPersist = (sessionData.session ??
          registered.session) as AppSession;
        await persistAndBootstrapSession(sessionToPersist);
      }
      router.push("/dashboard");
      return;
    }

    router.push("/login?registered=check-email");
  };

  const signOut = async () => {
    const destination = hasAdminAccess(profile) ? "/staff" : "/login";
    if (session) {
      await authApi.logout(session.refresh_token || undefined);
    }

    // Keep the authenticated UI mounted until the HttpOnly cookie cleanup has
    // succeeded. A rejected CSRF cleanup must remain visible and retryable.
    await clearSupabaseSession();
    if (supabase && session?.authMode !== "local") {
      await supabase.auth.signOut().catch(() => undefined);
    }
    applySession(null);
    router.replace(destination);
  };

  const refreshSession = async () => {
    const refreshedSession =
      (await refreshPersistedSupabaseSession()) as AppSession | null;

    if (!refreshedSession?.access_token) {
      applySession(null);
      return;
    }

    try {
      await bootstrapSession(refreshedSession);
    } catch (error) {
      setAuthDebug({
        stage: "refresh-bootstrap-failed",
        authMode: refreshedSession.authMode,
        hasSession: true,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      await clearSupabaseSession().catch(() => undefined);
      applySession(null);
      throw error;
    }
  };

  const resetPassword = async (email: string) => {
    const authClient = createRecoveryClient();
    const { error } = await authClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) throw error;
  };

  const updatePassword = async (password: string) => {
    const authClient = requireSupabase();
    const { error } = await authClient.auth.updateUser({ password });
    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        isLoading,
        signIn,
        signUp,
        signOut,
        refreshSession,
        resetPassword,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
