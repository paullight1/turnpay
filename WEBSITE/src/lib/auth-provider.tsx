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
import { createClient } from "@/lib/supabase";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { authApi } from "@/services/api";
import type { User as TrustPayUser, Wallet } from "@/types";

type AuthUser = SupabaseUser & {
  appProfile?: TrustPayUser;
  role?: TrustPayUser["role"];
};

type BootstrapResponse = {
  user: TrustPayUser;
  wallets: Wallet[];
};

interface AuthContextType {
  user: AuthUser | null;
  profile: TrustPayUser | null;
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, phone: string) => Promise<void>;
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
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

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
  }, [applySession, bootstrapSession, supabase.auth]);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data.session) {
      await bootstrapSession(data.session);
    }

    router.push("/dashboard");
  };

  const signUp = async (email: string, password: string, phone: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { phone },
        emailRedirectTo:
          typeof window === "undefined"
            ? undefined
            : `${window.location.origin}/dashboard`,
      },
    });

    if (error) throw error;

    if (data.session) {
      await bootstrapSession(data.session);
      router.push("/dashboard");
      return;
    }

    router.push("/login?registered=check-email");
  };

  const signOut = async () => {
    try {
      if (session) {
        await authApi.logout();
      }
    } finally {
      await supabase.auth.signOut();
      applySession(null);
      router.push("/login");
    }
  };

  const refreshSession = async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error) throw error;

    if (data.session) {
      await bootstrapSession(data.session);
    } else {
      applySession(null);
    }
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) throw error;
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
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
