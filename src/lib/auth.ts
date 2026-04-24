import { createServerFn } from "@tanstack/react-start";
import { getUser } from "@netlify/identity";

// @ts-ignore TODO: investigate this
export const getServerUser = createServerFn({ method: "GET" }).handler(async () => {
  const user = await getUser();
  return user ?? null;
});
