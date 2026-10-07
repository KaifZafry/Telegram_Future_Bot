"use client";

import { useMutation } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, Field } from "@/components/ui";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => api.post("/auth/login", { email, password }),
    onSuccess: () => router.replace("/")
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-lg bg-accent/15 p-2 text-accent-text">
            <Activity className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Signal Desk</h1>
            <p className="text-sm text-muted">Sign in to your trading bot</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-surface p-6">
          <Field
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {login.error && (
            <p role="alert" className="text-sm text-loss-text">
              {login.error.message}
            </p>
          )}
          <Button type="submit" variant="primary" loading={login.isPending} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted">
          No password yet? Run <code className="text-text-2">npm run setup</code> → option 4.
        </p>
      </div>
    </main>
  );
}
