import { onRequest as __api_create_server_js_onRequest } from "/Users/oktaybulut/Desktop/Hlf/cs-web-game/functions/api/create-server.js"
import { onRequest as __api_maps_js_onRequest } from "/Users/oktaybulut/Desktop/Hlf/cs-web-game/functions/api/maps.js"
import { onRequest as __api_servers_js_onRequest } from "/Users/oktaybulut/Desktop/Hlf/cs-web-game/functions/api/servers.js"
import { onRequest as __api_wads_js_onRequest } from "/Users/oktaybulut/Desktop/Hlf/cs-web-game/functions/api/wads.js"
import { onRequest as __relay_js_onRequest } from "/Users/oktaybulut/Desktop/Hlf/cs-web-game/functions/relay.js"

export const routes = [
    {
      routePath: "/api/create-server",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_create_server_js_onRequest],
    },
  {
      routePath: "/api/maps",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_maps_js_onRequest],
    },
  {
      routePath: "/api/servers",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_servers_js_onRequest],
    },
  {
      routePath: "/api/wads",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_wads_js_onRequest],
    },
  {
      routePath: "/relay",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__relay_js_onRequest],
    },
  ]