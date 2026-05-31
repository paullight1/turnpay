"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/dashboard-layout";
import { useAuth } from "@/lib/auth-provider";
import { authApi, userApi } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";

interface UserProfile {
  id: string;
  email: string;
  phone: string;
  role: string;
  kycStatus: string;
}

type AuthSession = {
  id: string;
  deviceId: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  expiresAt: string;
  createdAt: string;
};

export default function ProfilePage() {
  const { user, signOut, updatePassword } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await userApi.getProfile();
        setProfile(res.data);
      } catch {
        console.error("Failed to fetch profile");
      }
    };

    if (user) {
      fetchProfile();
    }
  }, [user]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setIsChangingPassword(true);
    try {
      await updatePassword(newPassword);
      toast.success("Password changed successfully");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to change password"));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const fetchSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    setSessionError(null);
    try {
      const response = await authApi.sessions();
      const sessionsPayload = response.data as {
        sessions?: Array<{
          id: string;
          deviceId?: string;
          deviceName?: string | null;
          userAgent?: string | null;
          ipAddress?: string | null;
          lastUsedAt?: string;
          expiresAt?: string;
          createdAt?: string;
        }>;
      };

      const mapped = (sessionsPayload.sessions ?? [])
        .filter((entry): entry is NonNullable<typeof sessionsPayload.sessions>[number] =>
          Boolean(entry && typeof entry.id === "string"),
        )
        .map((entry) => ({
          id: entry.id,
          deviceId: entry.deviceId ?? "Unknown device",
          deviceName: entry.deviceName ?? null,
          userAgent: entry.userAgent ?? null,
          ipAddress: entry.ipAddress ?? null,
          lastUsedAt: entry.lastUsedAt ?? "",
          expiresAt: entry.expiresAt ?? "",
          createdAt: entry.createdAt ?? "",
        }));
      setSessions(mapped);
    } catch (error: unknown) {
      setSessionError(getErrorMessage(error, "Unable to load active sessions"));
      setSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const revokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);
    try {
      await authApi.revokeSession(sessionId);
      setSessions((existing) => existing.filter((session) => session.id !== sessionId));
      toast.success("Session revoked");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Unable to revoke session"));
    } finally {
      setRevokingSessionId(null);
    }
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchSessions();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchSessions, user]);

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Profile</h1>
          <p className="text-muted-foreground mt-1">Manage your account settings</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Your personal details</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                  {user?.email?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-lg">{user?.email}</p>
                <p className="text-muted-foreground">{profile?.phone || user?.user_metadata?.phone}</p>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Role</p>
                <Badge variant={profile?.role === "ADMIN" ? "default" : "secondary"}>
                  {profile?.role || "USER"}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">KYC Status</p>
                <Badge
                  variant={
                    profile?.kycStatus === "VERIFIED"
                      ? "default"
                      : profile?.kycStatus === "REJECTED"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {profile?.kycStatus || "PENDING"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Update your password to keep your account secure</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new">New Password</Label>
                <Input
                  id="new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="Min 8 chars, uppercase, number"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm">Confirm New Password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={isChangingPassword}>
                {isChangingPassword ? "Updating..." : "Update Password"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {isLoadingSessions
                  ? "Loading sessions..."
                  : `${sessions.length} session(s) active`}
              </p>
              <Button variant="outline" onClick={() => void fetchSessions()}>
                Refresh sessions
              </Button>
            </div>
            {sessionError ? (
              <p className="text-sm text-destructive">{sessionError}</p>
            ) : null}
            {sessions.length === 0 && !isLoadingSessions ? (
              <p className="text-sm text-muted-foreground">No active sessions found.</p>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {session.deviceName || session.deviceId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          IP: {session.ipAddress || "unknown"} · {session.userAgent || "unknown agent"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last used: {session.lastUsedAt || "unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Expires: {session.expiresAt || "unknown"}
                        </p>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void revokeSession(session.id)}
                        disabled={revokingSessionId === session.id}
                      >
                        {revokingSessionId === session.id ? "Revoking..." : "Revoke"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Sign out of your account on this device.
            </p>
            <Button variant="destructive" onClick={signOut}>
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
