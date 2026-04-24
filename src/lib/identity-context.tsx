import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type User, getUser, logout as nfLogout, onAuthChange } from "@netlify/identity";

type IdentityValue = {
  user: User | null;
  ready: boolean;
  logout: () => Promise<void>;
};

const IdentityContext = createContext<IdentityValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void getUser().then((u) => {
      if (!alive) return;
      setUser(u);
      setReady(true);
    });
    const unsub = onAuthChange((_event, u) => {
      if (alive) setUser(u);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  async function logout() {
    await nfLogout();
    window.location.href = "/login";
  }

  return <IdentityContext value={{ user, ready, logout }}>{children}</IdentityContext>;
}

export function useIdentity(): IdentityValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used within IdentityProvider");
  return ctx;
}
