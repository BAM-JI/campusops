const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "http://127.0.0.1:4310";
const TOKEN = process.env.EXPO_PUBLIC_COURSE_TOKEN || "course-valid-token";

export async function fetchIncidents() {
  try {
    const response = await fetch(`${API_URL}/v1/incidents`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    const data = await response.json();
    // Sanitizado: no se imprime el payload con tokens o datos personales
    console.log({ status: response.status, count: data?.items?.length ?? 0 });
    return data;
  } catch (err) {
    // Mensaje seguro sin exponer URL interna o credenciales
    throw new Error("No fue posible consultar las incidencias del campus.");
  }
}