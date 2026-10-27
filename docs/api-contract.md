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

Implementado en `src/api/incident-dto.ts` (`parseRemoteResource` → `toIncident`).

| Campo de dominio | Origen en el DTO | Regla |
|---|---|---|
| `id` | `id` | String no vacío (validado por `parseRemoteResource`). |
| `version` | `version` | Entero ≥ 0 (validado por `parseRemoteResource`). |
| `status` | `status` | Debe ser `open`, `assigned`, `in_progress`, `resolved` o `closed`; otro valor es error `contract`. |
| `category` | `payload.category` | Una de las categorías del backend: `electrical`, `laboratory`, `water`, `connectivity`, `equipment`, `safety`, `maintenance`. |
| `description` | `payload.description` | String no vacío. |
| `location` | `payload.location` | String no vacío (dato sensible: no se registra en logs). |
| `reporterId` | `payload.reporterId` | String no vacío (dato sensible: no se registra en logs). |
| `assignedTechnicianId` | `payload.assignedTechnicianId` | String o `null` (sin asignar). Forma parte del campo `work` en sincronización. |
| `priority` | `payload.priority` | `low`, `medium` o `high`. |

Campos que **no** pasan al dominio de lista/detalle: `notes`, `evidence`, `history` y cualquier clave desconocida. El backend no envía título y la app no lo inventa: la lista muestra ID y categoría.

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

Implementada en `src/api/incident-dto.ts`; el adaptador `src/course-evaluation/index.ts` la reexporta. Devuelve el tipo `ParseResult` de `src/course-evaluation/contracts.ts`: `{ ok: true, value }` o `{ ok: false, error: 'contract' }`. Cubierta por `course-tests/public/week-05.test.ts` y `tests/week-05/incident-client.test.ts`.

| Entrada | Resultado |
|---|---|
| `null`, arreglo o no-objeto | `{ ok: false, error: 'contract' }` |
| `id` vacío o no string | `{ ok: false, error: 'contract' }` |
| `version` no entero, negativo o string (`"3"`) | `{ ok: false, error: 'contract' }` |
| `status` vacío o no string | `{ ok: false, error: 'contract' }` |
| `payload` arreglo, string o número | `{ ok: false, error: 'contract' }` |
| `payload: null` | `{ ok: true }` (nulo permitido por el contrato) |
| Claves extra en el sobre (`ignored: "forward-compatible"`) | `{ ok: true }`; la clave extra no se copia |

**Payload nulo válido ≠ incidencia válida.** Con la variante `nullable` el sobre es válido, pero `toIncident` devuelve `contract`: no se rellenan categoría, descripción ni ubicación con valores inventados y no se puede ejecutar una mutación sobre ese recurso. En una lista, los elementos inválidos se omiten y se cuentan en `rejected`; si `items` no es arreglo, toda la respuesta es `contract`.

## 4. Variantes del backend (`X-Course-Scenario`)

| Variante | Comportamiento del simulador | Resultado en el cliente (`ApiError`) | Prueba |
|---|---|---|---|
| `success` (por defecto) | 200/201 con DTO válido. | Datos mapeados a dominio. | `tests/week-05/incident-client.backend.test.ts` |
| `nullable` | 200 con `payload: null`. | Detalle: `contract`; lista: vacía, sin datos inventados. | ídem |
| `malformed` | 200 con cuerpo JSON roto. | `contract`. | ídem |
| `slow` | Responde después de 1200 ms. | `timeout` si el timeout del cliente es menor. | ídem |
| `server_error` | 500. | `server` con `status: 500`. | ídem |
| `rate_limited` | 429 con `Retry-After: 1`. | `rate_limited` con `retryAfterMs: 1000` (los reintentos son de la semana 9). | ídem |
| `timeout_after_commit` | Guarda la escritura y responde después de 1500 ms. | `timeout`; al repetir con la misma `Idempotency-Key` se recibe `duplicate: true`. | semana 8 |

Las pruebas usan el backend didáctico real (puerto libre por archivo de prueba) o un doble de `fetch` con respuestas repetibles; no dependen de Internet público.

## 5. Tipificación de Errores

`src/domain/result.ts` define `ApiResult<T>` = `{ ok: true, value }` | `{ ok: false, error: ApiError }`. El cliente **nunca lanza** hacia la UI:

| `ApiError.kind` | Origen |
|---|---|
| `contract` | Cuerpo no JSON, sobre inválido o dominio inválido. |
| `timeout` | El `AbortController` del cliente venció su ventana. |
| `network` | Conexión caída. |
| `server` | 5xx (conserva `status`). |
| `unauthorized` | 401 después del refresh compartido, o sin sesión. |
| `forbidden` | 403 del servidor o bloqueo local por perfil. |
| `not_found` | 404. |
| `conflict` | 409 (conserva `code`: `version_conflict`, `idempotency_key_reused`, `transition_conflict`). |
| `rate_limited` | 429 (conserva `retryAfterMs`). |
| `rejected` | Otro 4xx (conserva `status` y `code`, nunca el cuerpo completo). |

Los mensajes visibles salen de `describeApiError` y son genéricos: no exponen URLs, tokens ni trazas. El cliente y la sesión no escriben en consola; las pruebas lo comprueban espiando `console`.

## 6. Estado de implementación

| Elemento | Estado | Prueba |
|---|---|---|
| `parseRemoteResource` + mapeo a dominio | Implementado (`src/api/incident-dto.ts`). | `course-tests/public/week-05.test.ts`, `tests/week-05/incident-client.test.ts` |
| Lista, detalle y creación con `Idempotency-Key` | Implementado (`src/api/incident-client.ts`, implementa `IIncidentRepository`). | `tests/week-05/incident-client.backend.test.ts` |
| Timeout, 500, contrato y red tipados | Implementado (`src/api/http.ts`). | ambos archivos de `tests/week-05` |
| Sesión: login, SecureStore, refresh compartido, logout | Implementado (`src/auth/session-manager.ts`). | `tests/week-06/session.test.ts` |
| Permisos por perfil (servidor 403 + botones) | Implementado (`src/auth/permissions.ts`). | `tests/week-06/authorization.backend.test.ts` |
| UI sin HTTP directo | `App.tsx` es la raíz de composición; `src/ui` sólo usa casos de uso. | `course-tests/smoke.test.tsx` |