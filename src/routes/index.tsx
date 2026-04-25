import { createFileRoute, redirect } from "@tanstack/react-router";
import { Box, Button, Heading, Text } from "@chakra-ui/react";
import { useIdentity } from "#/lib/identity-context";
import { getServerUser } from "#/lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ location }) => {
    const user = await getServerUser();
    if (!user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: Home,
});

function Home() {
  const { user, logout } = useIdentity();

  return (
    <Box p={8}>
      <Heading size="2xl">Bienvenido</Heading>
      <Text mt={4} fontSize="lg">
        Conectado como {user?.email}
      </Text>
      <Button mt={6} onClick={() => void logout()}>
        Cerrar sesión
      </Button>
    </Box>
  );
}
