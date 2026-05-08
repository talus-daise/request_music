import { onRequestPost as __api_admin_reset_ts_onRequestPost } from "/home/talus/VSCode/request_music/functions/api/admin-reset.ts"
import { onRequestGet as __api_history_ts_onRequestGet } from "/home/talus/VSCode/request_music/functions/api/history.ts"
import { onRequestGet as __api_random_song_ts_onRequestGet } from "/home/talus/VSCode/request_music/functions/api/random-song.ts"
import { onRequestPost as __api_request_ts_onRequestPost } from "/home/talus/VSCode/request_music/functions/api/request.ts"
import { onRequestGet as __api_requests_ts_onRequestGet } from "/home/talus/VSCode/request_music/functions/api/requests.ts"
import { onRequestPost as __api_song_played_ts_onRequestPost } from "/home/talus/VSCode/request_music/functions/api/song-played.ts"
import { onRequest as ___middleware_ts_onRequest } from "/home/talus/VSCode/request_music/functions/_middleware.ts"

export const routes = [
    {
      routePath: "/api/admin-reset",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_admin_reset_ts_onRequestPost],
    },
  {
      routePath: "/api/history",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_history_ts_onRequestGet],
    },
  {
      routePath: "/api/random-song",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_random_song_ts_onRequestGet],
    },
  {
      routePath: "/api/request",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_request_ts_onRequestPost],
    },
  {
      routePath: "/api/requests",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_requests_ts_onRequestGet],
    },
  {
      routePath: "/api/song-played",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_song_played_ts_onRequestPost],
    },
  {
      routePath: "/",
      mountPath: "/",
      method: "",
      middlewares: [___middleware_ts_onRequest],
      modules: [],
    },
  ]