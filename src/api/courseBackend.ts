export type BackendHealth = Readonly<{
  ok: true;
  service: 'dmi-controlled-backend';
  contractVersion: 1;
}>;

// Hallazgo 1: Leer variable de entorno segura en lugar de forzar IP estática fija
const DEFAULT_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://127.0.0.1:4310';
const TOKEN = process.env.EXPO_PUBLIC_COURSE_TOKEN || 'course-valid-token';

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
): Promise<BackendHealth> {
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

// Función auditada de incidencias
export async function fetchIncidents() {
  try {
    const response = await fetch(`${DEFAULT_URL}/v1/incidents`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const data = await response.json();
    // Hallazgo 2: Log sanitizado sin exponer datos personales ni tokens
    console.log({ status: response.status, count: data?.items?.length ?? 0 });
    return data;
  } catch (err) {
    throw new Error('No fue posible consultar las incidencias del campus.');
  }
}