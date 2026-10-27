export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

/**
 * Backend address from the environment (Android emulator: http://10.0.2.2:4310).
 * Only the public teaching fixture; no tokens or secrets live here: the session
 * tokens come from /v1/session/login and are kept by SessionManager in SecureStore.
 */
export const BACKEND_URL =
  process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:4310';

export async function getBackendHealth(baseUrl = BACKEND_URL): Promise<BackendHealth> {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    // Mensaje de error controlado sin exponer rutas internas detalladas
    throw new Error('No fue posible conectar con el servicio.');
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ok' in payload) ||
    payload.ok !== true ||
    !('contractVersion' in payload) ||
    payload.contractVersion !== 1
  ) {
    throw new Error('Backend health contract mismatch');
  }
  return payload as BackendHealth;
}
