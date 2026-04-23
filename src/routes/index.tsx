import { createFileRoute, redirect } from "@tanstack/react-router";
import { getUser } from "@netlify/identity";
import { Box, Button, Heading, Text } from "@chakra-ui/react";
import { useIdentity } from "#/lib/auth/identity-context";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ location }) => {
    const user = await getUser();
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
      <Heading size="2xl">Welcome back</Heading>
      <Text mt={4} fontSize="lg">
        Signed in as {user?.email}
      </Text>
      <Button mt={6} onClick={() => void logout()}>
        Sign out
      </Button>
    </Box>
  );
}
