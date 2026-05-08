import type { Env } from "./lib/types";
import { cspHeaders } from "./lib/utils";

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.next();

  const newResponse = new Response(response.body, response);

  const security = cspHeaders();

  for (const [k, v] of Object.entries(security)) {
    newResponse.headers.set(k, v);
  }

  return newResponse;
};