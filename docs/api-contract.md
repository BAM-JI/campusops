# CampusOps — Contrato de Integración y Validación de API

Este documento fija la frontera entre lo que viaja por la red (DTO), lo que usa la aplicación (dominio) y cómo se representan los errores. Se basa en `docs/CAMPUSOPS_API.md`, `course-backend/README.md` y el simulador `course-backend/campusops.mjs`. Todos los valores (actores, token, incidencias) son fixtures públicos y ficticios del curso; no son credenciales reales.

## 1. Límite entre DTO y Dominio

- **DTO (Data Transfer Object):** Estructura que viaja por la red (`{ id, version, status, payload }`). Admite claves adicionales hacia adelante y payload `null`. Se trata como `unknown` hasta pasar por `parseRemoteResource`.
- **Entidad de Dominio:** Objeto purificado e inmutable dentro de la app (`Incident`, en `src/domain/incident.ts`). No admite propiedades no tipadas ni payloads indefinidos para operaciones de mutación.

Regla de capas: la UI (`src/ui`) sólo conoce casos de uso y entidades de dominio. El DTO, los headers y los códigos HTTP se quedan en la capa de cliente/infraestructura (`src/api`, `src/infrastructure`). Ninguna pantalla hace `fetch` directo.

### 1.1 Forma del DTO de incidencia (respuesta del backend)

```json
{
  "id": "campus-inc-001",
  "version": 1,
  "status": "assigned",
  "payload": {
    "category": "connectivity",
    "description": "Sin conexión en laboratorio ficticio",
    "location": "Edificio de prueba A",
    "reporterId": "reporter-1",
    "assignedTechnicianId": "technician-1",
    "priority": "medium",
    "notes": [],
    "evidence": [],
    "history": []
  }
}
```

### 1.2 Mapeo DTO → `Incident`

| Campo de dominio | Origen en el DTO | Regla |
|---|---|---|
| `id` | `id` | String no vacío (validado por `parseRemoteResource`). |
| `version` | `version` | Entero ≥ 0 (validado por `parseRemoteResource`). |
| `status` | `status` | Debe ser `open`, `assigned`, `in_progress`, `resolved` o `closed`; otro valor es error de validación de dominio. |
| `category` | `payload.category` | Una de las categorías del backend: `electrical`, `laboratory`, `water`, `connectivity`, `equipment`, `safety`, `maintenance`. |
| `description` | `payload.description` | String no vacío. |
| `location` | `payload.location` | String no vacío (dato sensible: no se registra en logs). |
| `reporterId` | `payload.reporterId` | String no vacío (dato sensible: no se registra en logs). |
| `assignedTechnicianId` | `payload.assignedTechnicianId` | Opcional; `null` en el DTO se convierte en ausencia del campo. |
| `title` | — | El backend no lo envía. El cliente lo deriva de datos existentes (por ejemplo, la categoría); no se inventa contenido. |

Campos que **no** pasan al dominio de lista/detalle: `priority`, `notes`, `evidence`, `history` y cualquier clave desconocida. Si en el futuro se necesitan, se agregan al dominio de forma explícita.

## 2. Solicitudes y respuestas

Todas las rutas de incidencias requieren:

- `Authorization: Bearer course-valid-token` (fixture público).
- `X-Course-Actor`: `reporter-1`, `reporter-2`, `technician-1`, `technician-2` o `coordinator-1`.
- Opcional en pruebas: `X-Course-Scenario` para seleccionar una variante (sección 4).

La URL base sale de `EXPO_PUBLIC_BACKEND_URL` (por defecto `http://127.0.0.1:4310`; en emulador Android `http://10.0.2.2:4310`).

### 2.1 Lista — `GET /v1/incidents`

- **Solicitud:** sin cuerpo.
- **Respuesta 200:** `{ "items": [DTO, ...] }`. El reportante ve sus reportes, el técnico sus asignaciones y el coordinador todas.
- **Validación:** `items` debe ser arreglo. Cada elemento pasa por `parseRemoteResource` y luego por el mapeo a dominio. Un elemento inválido no se muestra ni rompe la lista completa.

### 2.2 Detalle — `GET /v1/incidents/:id`

- **Solicitud:** sin cuerpo; `:id` es el identificador de la incidencia.
- **Respuesta 200:** un DTO (sección 1.1).
- **Errores:** `404 { code: "not_found" }` si no existe; `403 { code: "forbidden" }` si el actor no la puede ver.

### 2.3 Crear — `POST /v1/incidents`

- **Headers adicionales:** `Content-Type: application/json` e `Idempotency-Key` estable de al menos 8 caracteres. Se reutiliza la misma clave al reintentar la misma operación.
- **Cuerpo:**

```json
{
  "category": "connectivity",
  "description": "Falla ficticia de red",
  "location": "Edificio de prueba A"
}
```

- **Respuesta 201:** `{ "incident": DTO, "operationId": "<Idempotency-Key>", "duplicate": false }`. La incidencia nace con `version: 1` y `status: "open"`.
- **Reintento con la misma clave y el mismo cuerpo:** `200` con `duplicate: true`; no se crea una segunda incidencia.
- **Errores:**
  - `400 { code: "idempotency_key_required" }`: falta la clave o tiene menos de 8 caracteres.
  - `403 { code: "forbidden" }`: sólo un `reporter` puede crear.
  - `409 { code: "idempotency_key_reused" }`: misma clave con otro cuerpo.
  - `422 { code: "invalid_incident" }`: categoría inválida, descripción o ubicación vacías.
  - `422 { code: "invalid_contract" }`: el cuerpo no es un objeto JSON.

### 2.4 Errores comunes a todas las rutas

| HTTP | `code` | Causa |
|---|---|---|
| 401 | `unauthorized` | Token distinto al fixture o `X-Course-Actor` desconocido. |
| 404 | `not_found` | Ruta o incidencia inexistente. |
| 405 | `method_not_allowed` | Método no soportado en la ruta. |
| 429 | `rate_limited` | Variante `rate_limited`; incluye `Retry-After: 1`. |
| 500 | `controlled_failure` | Variante `server_error`. |

## 3. Validación de Frontera (`parseRemoteResource`)

Implementada en `src/course-evaluation/index.ts` y cubierta por `course-tests/public/week-05.test.ts`.

- Se comprueba tipo primitivo, entero no negativo en versión, presencia de id/status y nulabilidad estricta de payload antes de deserializar.
- Respuestas malformadas o campos corruptos deben descartarse en el adaptador HTTP sin propagar excepciones no controladas hacia los componentes visuales.

| Entrada | Resultado | Motivo |
|---|---|---|
| `null`, arreglo o no-objeto | `ok: false` | `Input must be a non-null object` |
| `id` vacío o no string | `ok: false` | `Invalid or missing id` |
| `version` no entero, negativo o string (`"3"`) | `ok: false` | `Invalid version: must be a non-negative integer` |
| `status` vacío o no string | `ok: false` | `Invalid or missing status` |
| `payload` arreglo, string o número | `ok: false` | `Payload must be an object or null` |
| `payload: null` | `ok: true` | Nulo permitido por el contrato. |
| Claves extra en el sobre (`ignored: "forward-compatible"`) | `ok: true` | Compatibilidad hacia adelante. |

**Payload nulo válido ≠ formato inválido.** Con la variante `nullable` el sobre es válido (`ok: true`), pero no hay datos para construir un `Incident`. La app debe mostrar el recurso como "sin datos disponibles" y no rellenar categoría, descripción ni ubicación con valores inventados. Tampoco se permite ejecutar una mutación sobre un recurso con payload `null`.

## 4. Variantes del backend (`X-Course-Scenario`)

| Variante | Comportamiento del simulador | Resultado esperado en el cliente |
|---|---|---|
| `success` (por defecto) | 200/201 con DTO válido. | Datos mapeados a dominio. |
| `nullable` | 200 con `payload: null` en cada DTO. | Sobre válido; estado "sin datos", sin inventar campos. |
| `malformed` | 200 con cuerpo JSON roto (`{"items": [}`). | `ValidationError`; la pantalla muestra un mensaje controlado. |
| `slow` | Responde después de 1200 ms. | Si el timeout del cliente es menor, `TimeoutError`. |
| `server_error` | 500 `{ code: "controlled_failure" }`. | `HttpError` con status 500. |
| `rate_limited` | 429 con `Retry-After: 1`. | `HttpError` con status 429 (los reintentos se tratan en la semana 9). |
| `timeout_after_commit` | Guarda la escritura y responde después de 1500 ms. | El cliente puede abortar; al repetir con la misma `Idempotency-Key` no se duplica. |

Las pruebas usan estas variantes o dobles de prueba (stubs de `fetch`) con respuestas repetibles; no dependen de Internet público ni de proveedores reales.

## 5. Tipificación de Errores

- `NetworkError`: Falla de conectividad o socket abortado.
- `TimeoutError`: Agotamiento de ventana de espera del cliente.
- `HttpError`: Respuestas 4xx o 5xx del backend didáctico (`server_error`, `rate_limited`).
- `ValidationError`: DTO con sobre corrupto o violación de esquema.

Reglas para los errores:

- El cliente devuelve o lanza sólo estos tipos; la capa de aplicación los traduce a un estado de pantalla. Ninguna excepción sin controlar llega a la UI.
- `HttpError` conserva `status` y `code` del backend, nunca el cuerpo completo.
- Los mensajes visibles para el usuario son genéricos (por ejemplo, "No fue posible consultar las incidencias del campus.") y no exponen URLs internas, tokens ni stack traces.
- Cualquier log de error pasa por `redactForTelemetry`: sólo se registran campos técnicos como `status`, `code`, `incidentId`, `correlationId`, `attempt` o `durationMs`.

## 6. Estado de implementación

Estado del código en `main` al momento de escribir este documento:

| Elemento | Estado |
|---|---|
| `parseRemoteResource` con validación del sobre | Implementado y probado (`course-tests/public/week-05.test.ts`). |
| `fetchIncidents` en `src/api/courseBackend.ts` | Consulta la lista con token y log sanitizado; todavía no usa `parseRemoteResource` ni aplica timeout. |
| Detalle (`GET /v1/incidents/:id`) desde el cliente | Pendiente. |
| Crear (`POST /v1/incidents` con `Idempotency-Key`) | Pendiente. |
| Clases `NetworkError`, `TimeoutError`, `HttpError`, `ValidationError` | Pendiente; hoy se lanza un `Error` genérico con mensaje controlado. |
| Repositorio HTTP que implemente `IIncidentRepository` | Pendiente; la UI sigue usando `InMemoryIncidentRepository`. |

Nota: `parseRemoteResource` devuelve `{ ok, data, error }` con un mensaje de texto, mientras que `src/course-evaluation/contracts.ts` declara `ParseResult` como `{ ok: true, value }` o `{ ok: false, error: 'contract' }`. Las pruebas públicas sólo revisan `ok`, pero conviene alinear ambas firmas cuando se conecte el cliente.
