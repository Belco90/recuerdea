import { createServerFn } from "@tanstack/react-start";
import { getUser } from "@netlify/identity";
import { getCookie } from "@tanstack/react-start/server";

type ServerUser = { id: string; email?: string };
type JwtClaims = { sub: string; email?: string; exp?: number };

/**
 * Decodes a JSON Web Token (JWT) and extracts its claims. Returns null if the token is invalid or expired.
 *
 * Only for local dev purposes, will be stripped in prod.
 */
function decodeJwt(token: string): JwtClaims | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as JwtClaims;
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export const getServerUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<ServerUser | null> => {
    const user = await getUser();
    if (user) return { id: user.id, email: user.email };
    // Dev fallback: `netlify dev` proxies SSR to Vite, which runs outside the
    // Netlify Functions runtime, so `getUser()` can't reach `globalThis.Netlify.context.cookies`.
    // Decode the JWT ourselves. Dead code in prod via `import.meta.env.DEV`.
    if (!import.meta.env.DEV) return null;
    const jwt = getCookie("nf_jwt");
    if (!jwt) return null;
    const claims = decodeJwt(jwt);
    return claims ? { id: claims.sub, email: claims.email } : null;
  },
);
