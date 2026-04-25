import { type SubmitEventHandler, useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { acceptInvite, handleAuthCallback, login, updateUser } from "@netlify/identity";
import { getServerUser } from "#/lib/auth";
import { Box, Button, Field, Heading, Input, Text, VStack } from "@chakra-ui/react";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    // If a callback hash is present, skip the redirect check. The component
    // handles invite/recovery flows that land on this page while logged in.
    if (
      typeof window !== "undefined" &&
      /[#&](invite_token|recovery_token|access_token|error)=/.test(window.location.hash)
    ) {
      return;
    }
    const user = await getServerUser();
    if (user) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

type Mode = "login" | "invite" | "recovery";

function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [inviteToken, setInviteToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void handleAuthCallback().then((result) => {
      if (!result) return;
      if (result.type === "invite" && result.token) {
        setInviteToken(result.token);
        setMode("invite");
      } else if (result.type === "recovery") {
        // User is logged in via recovery token; prompt for a new password.
        setMode("recovery");
      } else if (result.user) {
        // OAuth, confirmation, or email change — already logged in.
        window.location.href = "/";
      }
    });
  }, []);

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = data.get("email") as string;
    const password = data.get("password") as string;
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else if (mode === "invite") {
        await acceptInvite(inviteToken, password);
      } else {
        // recovery: user is already logged in; just set the new password.
        await updateUser({ password });
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "login" ? "Iniciar sesión" : mode === "invite" ? "Aceptar invitación" : "Establecer nueva contraseña";

  return (
    <Box minH="100vh" display="flex" alignItems="center" justifyContent="center" p={4}>
      <Box w="full" maxW="360px">
        <VStack gap={6} align="stretch">
          <Heading size="xl" textAlign="center">
            {title}
          </Heading>

          <form onSubmit={handleSubmit}>
            <VStack gap={4} align="stretch">
              {mode === "login" && (
                <Field.Root>
                  <Field.Label>Correo electrónico</Field.Label>
                  <Input type="email" name="email" required autoComplete="email" />
                </Field.Root>
              )}

              <Field.Root>
                <Field.Label>{mode === "login" ? "Contraseña" : "Elige una contraseña"}</Field.Label>
                <Input
                  type="password"
                  name="password"
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </Field.Root>

              {error && (
                <Text color="red.500" fontSize="sm">
                  {error}
                </Text>
              )}

              <Button type="submit" loading={loading} width="full">
                {title}
              </Button>
            </VStack>
          </form>
        </VStack>
      </Box>
    </Box>
  );
}
