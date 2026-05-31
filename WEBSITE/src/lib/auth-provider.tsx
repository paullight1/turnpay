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
import type { User as TrustPayUser, Wallet } from "@/types";

type AuthUser = SupabaseUser & {
  appProfile?: TrustPayUser;
  role?: TrustPayUser["role"];
};

type BootstrapResponse = {
  user: TrustPayUser;
  wallets: Wallet[];
};

type RegisterResponse = {
  user: TrustPayUser;
  session: Session | null;
};

type LoginResponse = {
  user: TrustPayUser;
  session: Session | null;
};

type RefreshResponse = {
  session: Session | null;
};

interface AuthContextType {
  user: AuthUser | null;
  profile: TrustPayUser | null;
  session: Session | null;
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
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const router = useRouter();
  const supabase = useMemo(
    () => (isSupabaseConfigured ? createClient() : null),
    [],
  );

  const applySession = useCallback(
    (nextSession: Session | null, nextProfile?: TrustPayUser | null) => {
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
    async (nextSession: Session) => {
      const { data } = await authApi.bootstrap();
      const bootstrap = data as BootstrapResponse;
      applySession(nextSession, bootstrap.user);
      return bootstrap;
    },
    [applySession],
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    const initializeSession = async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        applySession(currentSession);

        if (currentSession) {
          await bootstrapSession(currentSession);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void initializeSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      applySession(currentSession);
      setIsLoading(false);

      if (currentSession) {
        void bootstrapSession(currentSession).catch(() => undefined);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applySession, bootstrapSession, supabase]);

  const requireSupabase = useCallback(() => {
    if (!supabase) {
      throw new Error(
        "Supabase is not configured. Add the website Supabase environment variables to use authentication.",
      );
    }

    return supabase;
  }, [supabase]);

  const signIn = async (email: string, password: string) => {
    const authClient = requireSupabase();
    const { data } = await authApi.login(
      email,
      password,
      getAuthDeviceName(),
    );
    const login = data as LoginResponse;

    if (!login.session?.access_token || !login.session.refresh_token) {
      throw new Error("Invalid login response");
    }

    const { data: sessionData, error } = await authClient.auth.setSession({
      access_token: login.session.access_token,
      refresh_token: login.session.refresh_token,
    });
    if (error) throw error;

    if (sessionData.session) {
      await bootstrapSession(sessionData.session);
    } else {
      applySession(login.session, login.user);
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
    const authClient = requireSupabase();
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
      const { data: sessionData, error } = await authClient.auth.setSession({
        access_token: registered.session.access_token,
        refresh_token: registered.session.refresh_token,
      });
      if (error) throw error;
      if (sessionData.session) {
        await bootstrapSession(sessionData.session);
      } else {
        applySession(registered.session, registered.user);
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
      if (supabase) {
        await supabase.auth.signOut();
      }
      applySession(null);
      router.push("/login");
    }
  };

  const refreshSession = async () => {
    const authClient = requireSupabase();
    const {
      data: { session: currentSession },
    } = await authClient.auth.getSession();

    if (!currentSession?.refresh_token) {
      applySession(null);
      return;
    }

    const { data } = await authApi.refresh(
      currentSession.refresh_token,
      getAuthDeviceName(),
    );
    const refreshed = data as RefreshResponse;

    if (refreshed.session?.access_token && refreshed.session.refresh_token) {
      const { data: sessionData, error } = await authClient.auth.setSession({
        access_token: refreshed.session.access_token,
        refresh_token: refreshed.session.refresh_token,
      });
      if (error) throw error;

      if (sessionData.session) {
        await bootstrapSession(sessionData.session);
      } else {
        applySession(refreshed.session);
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
