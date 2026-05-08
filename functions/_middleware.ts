import type { Env } from "./lib/types";
import { cspHeaders } from "./lib/utils";

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.next();
  const headers = new Headers(response.headers);
  const security = cspHeaders();
  for (const [k, v] of Object.entries(security)) headers.set(k, v);
  return new Response(response.body, { ...response, headers });
};
