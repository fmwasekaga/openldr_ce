// Single source of truth for the server port / baseURL so the override-compose
// port remap can't desync the config from the running server.
export const PORT = Number(process.env.PORT ?? 3000);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
