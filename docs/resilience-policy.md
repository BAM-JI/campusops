# CampusOps — Política de resiliencia (Semana 9)

Este documento fija cuándo CampusOps reintenta, cuándo continúa con una alternativa y cuándo informa que una operación falló. Cada regla corresponde al código de `main` y se comprueba con las pruebas de la tabla final. Los datos son ficticios del contrato público (`campus-inc-001`, `reporter-1`, `technician-1`, `coordinator-1`).

| Archivo | Responsabilidad |
|---|---|
| `src/api/retry-policy.ts` | `planRetry(input, config)`: decide si un intento fallido se repite y cuánto esperar. `DEFAULT_RETRY_POLICY` fija los límites. |
| `src/api/incident-client.ts` | `IncidentClient` con la opción `retry`: ciclo de reintentos sobre `planRetry`, misma `Idempotency-Key` y mismo cuerpo, registro sanitizado `onAttempt`. |
| `src/api/http.ts` | Transporte (`sendRequest`): timeout propio del cliente y lectura de `Retry-After` en `retryAfterMs`. |
| `src/location/geocoding-adapter.ts` | `GeocodingPort`, `CourseGeocodingAdapter` (doble del curso, con `planRetry` en sus GET) y `CachedGeocoder`. |
| `src/location/nominatim-adapter.ts` | `NominatimGeocodingAdapter`: proveedor público real. |
| `src/location/select-incident-location.ts` | `selectIncidentLocation`: acepta el resultado del proveedor o conserva la etiqueta manual. |
| `src/application/location-usecases.ts` | `ResolveIncidentLocationUseCase`: lo que usa el formulario. |
| `src/course-evaluation/index.ts` | `planRetry` y `selectIncidentLocation` del contrato del curso delegan en el código anterior. |
| `App.tsx` | La app crea `IncidentClient` y `CourseGeocodingAdapter` con `retry: {}`, es decir, con la política por defecto. |

## 1. Proveedor y ejecución externa

CampusOps separa dos adaptadores detrás del mismo puerto `GeocodingPort`:

| Adaptador | Para qué se usa | Quién lo llama |
|---|---|---|
| `CourseGeocodingAdapter` | Doble controlado del curso: `GET /v1/geocoding?q=...` con los headers de la sesión. Sus escenarios reproducen fallos sin depender de cuotas ni de disponibilidad externa. | La app (`App.tsx`) y las pruebas automáticas. |
| `NominatimGeocodingAdapter` | Proveedor público real: OpenStreetMap Nominatim, `GET https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<consulta>`. | Sólo `scripts/geocode-real-once.mjs`, para la evidencia de ejecución real. |

**Restricciones del proveedor:** no requiere clave. Su política de uso pide un `User-Agent` identificable y como máximo 1 solicitud por segundo, y prohíbe el uso masivo. El adaptador envía `CampusOps-DMI-course/1.0` desde el script y espera `minIntervalMs` (1000 ms) entre solicitudes. Sólo se envían consultas genéricas o ficticias, nunca domicilios de personas.

**Limitación declarada:** la app usa el doble del curso. El proveedor real se demuestra con el script y con el mismo puerto, pero **no está conectado a la pantalla**. Cambiarlo sólo requiere otro adaptador en `App.tsx`, sin tocar la UI ni el caso de uso.

**Ejecución real** (desde computadoras del equipo, con internet):

```bash
node scripts/geocode-real-once.mjs "Biblioteca Central Universidad"
```

- **Fecha y hora:** `2026-11-02T05:45:19.479Z` (1 nov 2026, 23:45 hora de CDMX).
- **Consulta:** `Biblioteca Central Universidad`, un lugar público genérico, no un domicilio personal.
- **Resultado:** `outcome: result`. `selectIncidentLocation` devolvió `source: provider` con la etiqueta "Biblioteca Central, Calle Universidad Autónoma de Puebla, Universidades, Puebla, Municipio de Puebla, Puebla, 72592, México" y coordenadas redondeadas a 2 decimales: `19, -98.2`.
- **Duración:** 867 ms.
- **Observación:** ante una consulta ambigua, el proveedor eligió por su cuenta el primer resultado. Por eso una etiqueta del proveedor no es una confirmación de que sea el lugar correcto: el usuario la ve en el formulario y puede cambiarla por su propia referencia.

Se ejecutó dos veces, con la misma consulta. Los datos de arriba son de la ejecución de Abraham. Lizbeth la repitió para sus evidencias el `2026-11-03T03:33:22.190Z`: resultado `source: provider`, la misma ubicación en Puebla y 1153 ms. Ambas respetan el límite de 1 solicitud por segundo. Los registros están sanitizados: sin tokens, sin actor y sin datos personales.

## 2. Caché

`CachedGeocoder` envuelve cualquier `GeocodingPort`.

| Aspecto | Regla |
|---|---|
| Clave | Consulta normalizada: `normalizeQuery`, es decir `trim().toLowerCase()`. |
| Vigencia | `ttlMs`: 10 minutos por defecto (`DEFAULT_GEOCODING_CACHE`), con reloj `now` inyectable. Una entrada vencida se borra y se vuelve a consultar. |
| Tamaño | `maxEntries`: 20 por defecto. Al llenarse se elimina la entrada más antigua. |
| Qué se guarda | Sólo `{ label, latitude, longitude }` de un resultado que `selectIncidentLocation` acepta como `provider`. |
| Qué nunca se guarda | Fallos (`unavailable`), datos incompletos, coordenadas inválidas, tokens ni datos del actor. Una falla no queda "pegada": la siguiente búsqueda vuelve a consultar. |

La caché vive en memoria y se pierde al cerrar la app. No sustituye a la cola persistente de la semana 8.

## 3. Ubicación manual

`selectIncidentLocation(provider, manualLabel)` (`src/location/select-incident-location.ts`) cumple el contrato de `docs/CAMPUSOPS_API.md`:

- Acepta el resultado del proveedor sólo si es un objeto con `label` textual no vacío y `latitude`/`longitude` numéricas finitas, dentro de [-90, 90] y [-180, 180]. Devuelve `{ source: 'provider', label, latitude, longitude }`.
- Con `null`, un error representado como dato (`{ status: 429 }`), un objeto incompleto, coordenadas inválidas o tipos incorrectos devuelve `{ source: 'manual', label: manualLabel }`, **sin coordenadas inventadas**.

**Flujo en la app:** el reportante escribe edificio, zona o referencia en `CreateIncidentForm` y pulsa "Buscar ubicación". La pantalla sólo llama a `ResolveIncidentLocationUseCase`:

| Resultado | Aviso (`LocationNotice`) | Qué queda en el formulario |
|---|---|---|
| Proveedor válido | `provider` | La etiqueta del proveedor. |
| Timeout, 429, 5xx, desconexión o sesión rechazada | `provider_unavailable` | Lo que escribió el usuario. |
| Respuesta sin coordenadas válidas | `provider_invalid` | Lo que escribió el usuario. |

La búsqueda es opcional: el reporte se puede enviar sin usarla, así que un proveedor caído nunca bloquea una incidencia. Al servidor sólo se envía `location` como texto, porque así lo define su contrato. Las coordenadas no se guardan en la incidencia.

## 4. Reintentos

`planRetry` recibe `{ method, status, attempt, retryAfterMs?, idempotencyKey? }`, donde `status` es el código HTTP del intento fallido o `'timeout'` cuando no llegó respuesta (timeout del cliente o conexión caída), y `attempt` es el número del intento que acaba de fallar, empezando en 1. Devuelve `{ retry, delayMs, requiresStableIdempotencyKey }`.

Límites por defecto (`DEFAULT_RETRY_POLICY`), todos configurables con el segundo argumento:

| Campo | Valor | Para qué |
|---|---:|---|
| `maxAttempts` | 4 | Desde el intento 4 no se planea otro: como máximo 4 solicitudes por operación. |
| `baseDelayMs` | 250 | Primera espera progresiva; se duplica en cada intento. |
| `maxDelayMs` | 4000 | Tope de la espera progresiva. |
| `maxRetryAfterMs` | 30000 | Un `Retry-After` mayor no se espera: se informa el fallo. |
| `jitter` | sin jitter | Opcional e inyectable; su resultado se recorta a un valor finito entre 0 y `maxDelayMs`. |

Las reglas se aplican en este orden:

1. **Límite.** Si `attempt` no es un entero ≥ 1 o es ≥ `maxAttempts`, no hay reintento. Así ninguna operación entra en un ciclo infinito.
2. **Estado.** Sólo se reintentan fallas transitorias: `'timeout'`, 408, 429, 500, 502, 503 y 504. Los errores de negocio (400, 401, 403, 404, 409, 422 y cualquier otro) no se reintentan: repetirlos no cambia la respuesta. El 401 sigue su propio camino: dentro de cada intento, `attemptOnce` hace como máximo un refresh compartido de la sesión (semana 6); si aun así queda 401, `planRetry` no lo reintenta.
3. **POST sin identidad estable.** Un POST sin `idempotencyKey` no vacía devuelve `{ retry: false, delayMs: 0, requiresStableIdempotencyKey: true }`. Sin clave el servidor no puede reconocer una repetición, así que repetir podría aplicar el efecto dos veces.
4. **`Retry-After`.** Con 429 o 503 y un `retryAfterMs` finito y ≥ 0, la espera es exactamente ese valor. Si supera `maxRetryAfterMs`, no se reintenta y se informa el fallo, para no dejar la pantalla esperando un tiempo desproporcionado.
5. **Espera progresiva.** En otro caso `delayMs = min(baseDelayMs · 2^(attempt − 1), maxDelayMs)`: 250, 500 y 1000 ms con los valores por defecto. Nunca se devuelve `NaN`, `Infinity` ni un número negativo.

| Falla del intento | GET | POST con `Idempotency-Key` | POST sin clave |
|---|---|---|---|
| `timeout` o conexión caída | reintenta con espera progresiva | reintenta con espera progresiva | no reintenta, `requiresStableIdempotencyKey: true` |
| 429 / 503 con `Retry-After` ≤ 30 s | espera `Retry-After` | espera `Retry-After` | no reintenta, `requiresStableIdempotencyKey: true` |
| 429 / 503 con `Retry-After` > 30 s | informa el fallo | informa el fallo | no reintenta, `requiresStableIdempotencyKey: true` |
| 408, 500, 502, 504, o 429/503 sin `Retry-After` válido | reintenta con espera progresiva | reintenta con espera progresiva | no reintenta, `requiresStableIdempotencyKey: true` |
| 400, 401, 403, 404, 409, 422 | no reintenta | no reintenta | no reintenta |
| cualquier falla en el intento 4 | no reintenta | no reintenta | no reintenta |

### Cómo lo usa el cliente

`IncidentClient.authorized(...)` envía con `attemptOnce`. Con la opción `retry`, después de cada intento:

- traduce el resultado a un estado para `planRetry` (`retryStatusOf`): éxito 2xx, error de negocio o sesión ausente son finales; `timeout` y `network` se tratan como `'timeout'`;
- pasa `retryAfterMs` de `RawResponse` y la `idempotencyKey` de la operación;
- espera `delayMs` con `sleep` y repite **la misma solicitud**: mismo método, ruta, cuerpo e `Idempotency-Key`. La clave la recibe `write(...)` desde el caso de uso o la cola persistente (semana 8), así que no cambia entre intentos.

`sleep` y `now` son inyectables para que las pruebas comprueben las demoras sin esperar de verdad. Sin la opción `retry`, cada solicitud se envía una vez, como en las semanas 5 a 8; el `SyncEngine` y sus pruebas no cambian.

### Registro sanitizado de intentos

`onAttempt` recibe un `AttemptRecord` por intento: `method`, `route`, `attempt`, `outcome` (`http_<status>`, `timeout`, `network`…), `retry`, `delayMs` y `durationMs`. La ruta pasa por `routeTemplate`, que convierte `/v1/incidents/campus-inc-001/actions` en `/v1/incidents/:id/actions`. El registro no lleva token, actor, `Idempotency-Key`, cuerpo, ubicación ni id de incidencia; esos datos se usan para `reports/week-09/retry-metrics.json`.

## 5. Respuesta perdida

Un timeout del cliente **no prueba que el servidor no guardó el cambio**. Con el escenario `timeout_after_commit`, el backend del curso guarda la operación y responde 1500 ms después. Un cliente con `timeoutMs: 500` aborta antes y ve `timeout`, aunque el `resolve` o el `close` ya estén aplicados.

Por eso:

1. El cliente reintenta el POST **con la misma `Idempotency-Key` y el mismo cuerpo**. `planRetry` sólo lo permite porque hay clave estable.
2. El servidor reconoce la clave y responde 200 con `duplicate: true` y la incidencia ya actualizada, sin aplicar la acción otra vez.
3. Si alguien reutiliza la clave con **otro contenido**, el servidor responde 409 `idempotency_key_reused`. El cliente lo trata como error de negocio: no reintenta y no aplica nada dos veces.

**Cómo se verifica que no hay duplicados** (`tests/week-09/lost-response.test.ts`, backend real):

- `technician-1` hace `start`; luego `resolve` con `timeout_after_commit` y `timeoutMs: 500`.
- Los registros de `onAttempt` son `[1, timeout, retry: true]` y `[2, http_200, retry: false]`: dos intentos.
- El resultado es `ok` con `duplicate: true`, `status: 'resolved'` y `version: 3`.
- Leído crudo como `coordinator-1`, `payload.history` tiene **un solo** evento con `operationId` `op-week09-resolve-001`.
- Con `close` como `coordinator-1`: dos intentos, `status: 'closed'`, `version: 4` y **un solo** evento `close` en el historial.

`resolve` y `close` no agregan evidencias ni notificaciones en el backend del curso: su único efecto repetible es el evento del historial, y las pruebas lo cuentan. `add_evidence` usa el mismo mecanismo de `Idempotency-Key`, así que un reintento con la misma clave tampoco duplica la evidencia.

## 6. Cuándo reintentar, usar la alternativa o informar un fallo

| Caso | Qué hace CampusOps | Por qué |
|---|---|---|
| GET de incidencias con timeout, desconexión o 5xx | Reintenta hasta 4 intentos con espera progresiva; si sigue fallando, informa el error tipado (`timeout`, `network`, `server`, `rate_limited`). | Leer no tiene efectos; el límite evita saturar al servidor. |
| 429 o 503 con `Retry-After` ≤ 30 s | Espera exactamente `Retry-After` y reintenta dentro del límite. | El servicio dice cuándo volver; ignorarlo agrava la saturación. |
| 429 o 503 con `Retry-After` > 30 s | Informa el fallo sin esperar. | Una espera tan larga deja la pantalla bloqueada; mejor avisar y dejar que el usuario o la cola decidan. |
| POST con `Idempotency-Key` que pierde la respuesta (`timeout_after_commit`) | Reintenta con la misma clave y cuerpo; el servidor responde `duplicate: true`. | La clave convierte la repetición en una consulta segura del resultado. |
| POST sin `Idempotency-Key` | No reintenta (`requiresStableIdempotencyKey: true`) e informa el fallo. | Sin identidad estable, repetir podría duplicar el efecto. |
| Errores de negocio (400, 401 tras refresh, 403, 404, 409, 422) | Informa una vez, sin reintentar. | Repetir no cambia la decisión del servidor. |
| Misma clave con otro contenido | 409 `idempotency_key_reused`: informa el conflicto sin aplicar. | Protege contra reutilizar una clave por error. |
| Geocodificación con timeout, 429, 5xx o desconexión | Reintenta el GET dentro del límite y, si sigue fallando, continúa con la **alternativa manual**: la etiqueta escrita por el usuario, sin coordenadas, y un aviso (`provider_unavailable`). | La ubicación ayuda, pero no debe bloquear el reporte de una incidencia. |
| Geocodificación con datos incompletos o coordenadas inválidas | No reintenta: continúa con la alternativa manual y avisa (`provider_invalid`). | La respuesta llegó; repetirla no la vuelve válida. |

## 7. Regla → prueba

Comando de todas las pruebas de esta semana:

```bash
npx jest --no-watchman --ci --runInBand tests/week-09 course-tests/public/week-09.test.ts
```

| Regla | Archivo | Prueba |
|---|---|---|
| Sin reintento desde el intento 4 | `tests/week-09/retry-policy.test.ts` | `stops retrying from attempt 4` |
| `Retry-After` respetado y demoras finitas | `tests/week-09/retry-policy.test.ts` | `honors Retry-After and keeps delays finite` |
| Espera progresiva sin `Retry-After` | `tests/week-09/retry-policy.test.ts` | `uses progressive backoff without Retry-After` |
| POST sólo con clave estable | `tests/week-09/retry-policy.test.ts` | `never retries a POST without a stable idempotency key` |
| Errores de negocio sin reintento | `tests/week-09/retry-policy.test.ts` | `does not retry business errors (403, 409, 422)` |
| Límites configurables | `tests/week-09/retry-policy.test.ts` | `limits are configurable` |
| El cliente reintenta un GET 500 dentro del límite | `tests/week-09/client-retry.test.ts` | `GET retries a 500 and then succeeds within the limit` |
| Como máximo 4 solicitudes | `tests/week-09/client-retry.test.ts` | `a server that keeps failing receives at most 4 requests` |
| El cliente espera `Retry-After` | `tests/week-09/client-retry.test.ts` | `429 waits exactly Retry-After before the next attempt` |
| Timeout y desconexión se reintentan y luego se informan | `tests/week-09/client-retry.test.ts` | `timeouts and dropped connections are retried, then reported` |
| Misma clave y mismo cuerpo en cada reintento | `tests/week-09/client-retry.test.ts` | `a POST retry repeats the same Idempotency-Key and the same body` |
| Errores de negocio una sola vez | `tests/week-09/client-retry.test.ts` | `business errors are answered once, without retries` |
| Registros sanitizados | `tests/week-09/client-retry.test.ts` | `attempt records are sanitized: no token, actor, key or incident id` |
| `resolve` perdido se aplica una vez | `tests/week-09/lost-response.test.ts` | `lost resolve response is retried with the same key and applies once` |
| `close` perdido no duplica el evento | `tests/week-09/lost-response.test.ts` | `lost close response does not duplicate the event` |
| Clave reutilizada con otro contenido | `tests/week-09/lost-response.test.ts` | `the same key with different content is rejected, not applied twice` |
| Contrato público de `planRetry` | `course-tests/public/week-09.test.ts` | `retries bounded idempotent failures and honors Retry-After`, `does not retry a POST without stable idempotency identity`, `CampusOps can retry a lost resolution response only with a stable operation key` |
| Proveedor válido aceptado | `tests/week-09/location.test.ts` | `valid geocoding is accepted from the provider` |
| Datos incompletos o inválidos → manual | `tests/week-09/location.test.ts` | `incomplete or invalid coordinates fall back to the manual label` |
| Timeout → manual sin coordenadas | `tests/week-09/location.test.ts` | `timeout falls back to manual without inventing coordinates` |
| 429 respeta `Retry-After` y luego → manual | `tests/week-09/location.test.ts` | `429 honors Retry-After and then falls back to manual` |
| Desconexión → manual | `tests/week-09/location.test.ts` | `disconnection falls back to manual` |
| La caché evita repetir la consulta | `tests/week-09/location.test.ts` | `cache returns a valid result without calling the provider again` |
| La caché no guarda fallos ni datos inválidos | `tests/week-09/location.test.ts` | `cache never stores failures or invalid results` |
| El proveedor real pasa por las mismas reglas | `tests/week-09/location.test.ts` | `the real provider adapter maps Nominatim answers through the same rules` |
| 1 solicitud por segundo y `User-Agent` identificable | `tests/week-09/location.test.ts` | `the real provider adapter keeps 1 request per second and sends an identifying User-Agent` |
| El formulario conserva lo escrito y avisa | `tests/week-09/location-form.test.tsx` | `the form keeps the typed building when the provider is down and warns the user` |
| El formulario usa la etiqueta válida del proveedor | `tests/week-09/location-form.test.tsx` | `the form uses the provider label when the location is valid` |
| Contrato público de `selectIncidentLocation` | `course-tests/public/week-09.test.ts` | `CampusOps accepts valid geocoding and otherwise keeps manual incident location` |

Resultado observado el 2 nov 2026 sobre el commit `31dc394`, con caché vacía (`--no-cache`): `Test Suites: 6 passed, 6 total`; `Tests: 31 passed, 31 total`.
