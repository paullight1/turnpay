"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/services/api";

interface User {
  id: string;
  email: string;
  phone: string;
  role: string;
  kycStatus: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshTokens: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function setCookie(name: string, value: string, days: number) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Strict`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem("auth_token");
    const storedUser = localStorage.getItem("user");
    if (stored && storedUser) {
      setAccessToken(stored);
      setUser(JSON.parse(storedUser));
      setCookie("auth_token", stored, 1);
      setCookie("user", storedUser, 1);
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    const data = response.data;
    setAccessToken(data.accessToken);
    setUser(data.user);
    localStorage.setItem("auth_token", data.accessToken);
    localStorage.setItem("refresh_token", data.refreshToken);
    localStorage.setItem("user", JSON.stringify(data.user));
    setCookie("auth_token", data.accessToken, 1);
    setCookie("refresh_token", data.refreshToken, 7);
    setCookie("user", JSON.stringify(data.user), 1);
    router.push("/dashboard");
  };

  const register = async (email: string, phone: string, password: string) => {
    const response = await authApi.register(email, phone, password);
    const data = response.data;
    setAccessToken(data.accessToken);
    setUser(data.user);
    localStorage.setItem("auth_token", data.accessToken);
    localStorage.setItem("refresh_token", data.refreshToken);
    localStorage.setItem("user", JSON.stringify(data.user));
    setCookie("auth_token", data.accessToken, 1);
    setCookie("refresh_token", data.refreshToken, 7);
    setCookie("user", JSON.stringify(data.user), 1);
    router.push("/dashboard");
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // Continue logout even if server call fails
      }
    }
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    deleteCookie("auth_token");
    deleteCookie("refresh_token");
    deleteCookie("user");
    router.push("/login");
  };

  const refreshTokens = async () => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      await logout();
      return;
    }
    try {
      const response = await authApi.refresh(refreshToken);
      const data = response.data;
      setAccessToken(data.accessToken);
      localStorage.setItem("auth_token", data.accessToken);
      if (data.refreshToken) {
        localStorage.setItem("refresh_token", data.refreshToken);
      }
      setCookie("auth_token", data.accessToken, 1);
      if (data.refreshToken) {
        setCookie("refresh_token", data.refreshToken, 7);
      }
    } catch {
      await logout();
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, accessToken, isLoading, login, register, logout, refreshTokens }}
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
