"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { authApi, getAuthDeviceName } from "@/services/api";
import {
  clearSupabaseSession,
  readPersistedSupabaseSession,
  persistSupabaseSession,
} from "@/lib/supabase-session";
import type { User as TrustPayUser, Wallet } from "@/types";

type AuthMode = "supabase" | "local";

type AuthUser = SupabaseUser & {
  appProfile?: TrustPayUser;
  role?: TrustPayUser["role"];
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

type RefreshResponse = {
  session: AppSession | null;
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

  (window as Window & { __TRUSTPAY_AUTH_DEBUG__?: AuthDebugState }).__TRUSTPAY_AUTH_DEBUG__ =
    state;
}

function resolveActiveSession(
  currentSession: AppSession | null,
  persistedSession: AppSession | null,
) {
  if (persistedSession) {
    return persistedSession;
  }

  return currentSession;
}

interface AuthContextType {
  user: AuthUser | null;
  profile: TrustPayUser | null;
  session: AppSession | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const router = useRouter();
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
            }
          : null,
      );
    },
    [],
  );

  const bootstrapSession = useCallback(
    async (nextSession: AppSession) => {
      setAuthDebug({
        stage: "bootstrap-start",
        authMode: nextSession.authMode,
        hasSession: Boolean(nextSession.access_token),
      });
      const { data } = await authApi.bootstrap(nextSession.access_token);
      const bootstrap = data as BootstrapResponse;
      applySession(nextSession, bootstrap.user);
      setAuthDebug({
        stage: "bootstrap-complete",
        authMode: nextSession.authMode,
        hasSession: true,
      });
      return bootstrap;
    },
    [applySession],
  );

  useEffect(() => {
    let isMounted = true;

    const initializeSession = async () => {
      try {
        if (supabase) {
          const {
            data: { session: currentSession },
          } = await supabase.auth.getSession();
          const persistedSession = readPersistedSupabaseSession();
          const activeSession = resolveActiveSession(
            currentSession as AppSession | null,
            persistedSession as AppSession | null,
          );

          if (!isMounted) return;

          applySession(activeSession);

          if (activeSession) {
            await bootstrapSession(activeSession as AppSession);
          }
        } else {
          const persistedSession = readPersistedSupabaseSession();
          if (!isMounted) return;

          applySession(persistedSession);

          if (persistedSession) {
            await bootstrapSession(persistedSession as AppSession);
          }
        }
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
      const result = supabase.auth.onAuthStateChange((_event, currentSession) => {
        const persistedSession = readPersistedSupabaseSession();
        const activeSession = resolveActiveSession(
          currentSession as AppSession | null,
          persistedSession as AppSession | null,
        );
        applySession(activeSession);
        setIsLoading(false);

        if (activeSession) {
          void bootstrapSession(activeSession).catch(() => undefined);
        }
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
      applySession(nextSession);

      if (nextSession) {
        void bootstrapSession(nextSession).catch(() => undefined);
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

  const signIn = async (email: string, password: string) => {
    setAuthDebug({
      stage: "login-request-start",
      hasSession: false,
    });

    let login: LoginResponse;
    try {
      const { data } = await authApi.login(email, password, getAuthDeviceName());
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

    if (login.authMode === "local") {
      setAuthDebug({
        stage: "local-session-persist-start",
        authMode: login.authMode,
        hasSession: true,
      });
      await persistSupabaseSession(login.session);
      try {
        await bootstrapSession(login.session);
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
        await clearSupabaseSession();
        throw error;
      }
    } else {
      const authClient = requireSupabase();
      const { data: sessionData, error } = await authClient.auth.setSession({
        access_token: login.session.access_token,
        refresh_token: login.session.refresh_token,
      });
      if (error) throw error;

      if (sessionData.session) {
        await bootstrapSession(sessionData.session as AppSession);
      } else {
        applySession(login.session, login.user);
      }
    }

    router.push("/dashboard");
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
          await clearSupabaseSession();
          throw error;
        }
      } else {
        const authClient = requireSupabase();
        const { data: sessionData, error } = await authClient.auth.setSession({
          access_token: registered.session.access_token,
          refresh_token: registered.session.refresh_token,
        });
        if (error) throw error;
        if (sessionData.session) {
          await bootstrapSession(sessionData.session as AppSession);
        } else {
          applySession(registered.session, registered.user);
        }
      }
      router.push("/dashboard");
      return;
    }

    router.push("/login?registered=check-email");
  };

  const signOut = async () => {
    try {
      if (session) {
        await authApi.logout(session.refresh_token);
      }
    } finally {
      await clearSupabaseSession();
      if (supabase && session?.authMode !== "local") {
        await supabase.auth.signOut();
      }
      applySession(null);
      router.push("/login");
    }
  };

  const refreshSession = async () => {
    const currentSession = supabase
      ? (
          await supabase.auth.getSession()
        ).data.session
      : null;
    const activeSession = resolveActiveSession(
      currentSession as AppSession | null,
      readPersistedSupabaseSession() as AppSession | null,
    );

    if (!activeSession?.refresh_token) {
      applySession(null);
      return;
    }

    const { data } = await authApi.refresh(
      activeSession.refresh_token,
      getAuthDeviceName(),
    );
    const refreshed = data as RefreshResponse;

    if (refreshed.session?.access_token && refreshed.session.refresh_token) {
      if (refreshed.session.authMode === "local") {
        setAuthDebug({
          stage: "refresh-local-session-persist-start",
          authMode: refreshed.session.authMode,
          hasSession: true,
        });
        await persistSupabaseSession(refreshed.session);
        try {
          await bootstrapSession(refreshed.session);
          setAuthDebug({
            stage: "refresh-local-session-persisted",
            authMode: refreshed.session.authMode,
            hasSession: true,
          });
        } catch (error) {
          setAuthDebug({
            stage: "refresh-local-bootstrap-failed",
            authMode: refreshed.session.authMode,
            hasSession: true,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          await clearSupabaseSession();
          applySession(null);
          throw error;
        }
      } else {
        const authClient = requireSupabase();
        const { data: sessionData, error } = await authClient.auth.setSession({
          access_token: refreshed.session.access_token,
          refresh_token: refreshed.session.refresh_token,
        });
        if (error) throw error;

        if (sessionData.session) {
          await bootstrapSession(sessionData.session as AppSession);
        } else {
          applySession(refreshed.session);
        }
      }
    } else {
      applySession(null);
    }
  };

  const resetPassword = async (email: string) => {
    const authClient = requireSupabase();
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
