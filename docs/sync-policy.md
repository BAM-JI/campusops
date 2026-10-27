# CampusOps — Política de sincronización (Semana 8)

Este documento fija qué se combina, qué es conflicto, cómo se informa y resuelve, y cuándo una operación sale de la cola. Todo corresponde al código de `src/sync/` y `src/persistence/` y se comprueba con las pruebas de la tabla final. Los datos son ficticios del contrato público (`campus-inc-001`, `technician-1`, `technician-2`, `coordinator-1`).

| Archivo | Responsabilidad |
|---|---|
| `src/sync/resolve-sync.ts` | `resolveSync(base, local, remote)`: combinación de tres vías por campo con JSON canónico. |
| `src/sync/sync-engine.ts` | `SyncEngine.sync()`: envía `queue.pending()` y decide confirmar, dejar pendiente, combinar o declarar conflicto. |
| `src/persistence/operation-queue.ts` | Cola persistente: `confirm`, `recordFailedAttempt`, `markConflict`, `rebase`, `dismissConflict`. |
| `src/api/incident-client.ts`, `src/auth/session-manager.ts` | Transporte con sesión, `Idempotency-Key`, timeout, permisos y errores tipados (semanas 5 y 6). |

`SyncEngine` recibe la cola, el repositorio (`IncidentClient`) y el `actorId` de la sesión vigente. Cada operación produce un resultado: `confirmed` (con `duplicate`), `conflict` (con `fields`), `pending` (con el tipo de error) o `skipped` (`other_actor` o `session_expired`).

## 1. Qué se combina

`resolveSync` recibe la versión base común, la intención local y la versión remota:

- **Base:** la copia local de la incidencia guardada con la misma `baseVersion` de la operación.
- **Local:** la base con la operación aplicada (`applyIntent`).
- **Remota:** la que devuelve el servidor.

Para cada campo de la unión de claves:

| Local cambió | Remoto cambió | Resultado |
|---|---|---|
| no | no | valor base |
| sí | no | valor local |
| no | sí | valor remoto |
| sí, mismo contenido que remoto | sí | ese valor |
| sí | sí, contenido distinto | **conflicto** en ese campo |

- La comparación es por **contenido JSON canónico** (`canonicalJson`, claves ordenadas). `{status, assignedTechnicianId}` y `{assignedTechnicianId, status}` son iguales; la identidad del objeto no importa.
- Las entradas **no se mutan**: los valores elegidos se copian.
- El motor compara dos campos (`toSyncRecord`):
  - `work = { assignedTechnicianId, status }`;
  - `priority`.

**Ejemplo combinable:** el técnico inicia sin conexión (`work.status: in_progress`) mientras coordinación cambia la prioridad. El servidor responde 409 `version_conflict` y `resolveSync` da `merged`, porque los campos son distintos. El motor:

1. Guarda la versión remota.
2. Aplica `rebase` de la operación a esa versión, **con el mismo `operationId`** (un 409 no consume la clave en el servidor).
3. Reintenta **una sola vez**.

Si el reintento vuelve a chocar, la operación queda en conflicto.

## 2. Qué es conflicto

Es el mismo campo cambiado de forma distinta en local y en remoto. Los nombres se reportan **en orden alfabético**.

**Caso obligatorio:**
- Base: `work = { technician-1, assigned }`.
- El técnico inicia sin conexión (`work.status: in_progress`).
- Coordinación reasigna a `technician-2` (`work.assignedTechnicianId: technician-2`).
- Los dos cambian `work`, así que el resultado es `{ kind: 'conflict', fields: ['work'] }`.

Cómo trata el motor cada respuesta del servidor:

| Respuesta | Qué hace | Campos |
|---|---|---|
| 403 `forbidden` o 404 | Lee la versión remota. Si ya no puede leerla, la asignación cambió. | `['work']` |
| 409 `version_conflict` | Compara con `resolveSync`. Si es conflicto, conserva la intención; si es combinable, hace `rebase` y un reintento. | los que dé `resolveSync` |
| 409 `idempotency_key_reused` | No reintenta con otro contenido. | `['operationId']` |
| Otro rechazo (transición inválida, 422) | Conserva la intención para que la revise una persona. | el campo de la acción (`intentFields`): `work`, `priority`, `notes` o `evidence` |
| Acción desconocida en la cola | No la envía. | `['action']` |

## 3. Cómo se informa y se resuelve

- `markConflict` deja la operación en la cola con `state: 'conflict'` y `conflictFields` ordenados. **No se sobrescribe** la asignación remota, porque el servidor rechazó el cambio, y **no se borra** la intención local.
- `sync()` devuelve `{ result: 'conflict', fields }` para que la interfaz lo muestre.
- Una operación en conflicto no se vuelve a enviar sola: `sync()` sólo toma `queue.pending()`.
- **Nada se resuelve automáticamente.** Hay dos caminos:
  1. **Coordinación decide que el técnico original continúa:** vuelve a asignar la incidencia a `technician-1`. El técnico revisa la versión nueva y registra una **nueva** operación sobre ella (nuevo `operationId`). Después descarta la anterior con `dismissConflict`.
  2. **La intención ya no es válida** (la atenderá `technician-2`): el técnico la descarta con `dismissConflict(operationId)`. Es la **única** forma de retirar una operación sin confirmación del servidor. La decide una persona y sólo aplica a operaciones en `conflict`.

## 4. Autorización por perfil (semana 6)

- El motor envía todo por `IncidentClient`. `Authorization` y `X-Course-Actor` salen de la sesión (`SessionManager`), nunca de la operación.
- Una operación de **otro actor** guardada en el mismo dispositivo no se envía con la sesión actual: queda `skipped` / `other_actor` y sigue en la cola.
- Si la sesión expira y el refresh falla (`unauthorized`), el resto de la corrida queda `skipped` / `session_expired`. No se modifica la cola: al volver a iniciar sesión se envían con la misma identidad.
- Sólo coordinación asigna, prioriza, cierra o reabre. Sólo el técnico asignado inicia o resuelve. `src/auth/permissions.ts` oculta botones, pero **ocultar botones no sustituye la validación del servidor**: el 403 real se prueba contra el backend (`tests/week-06/authorization.backend.test.ts`).
- La cola nunca guarda tokens. La sesión vive aparte, en `expo-secure-store`.

## 5. Identidad estable e idempotencia

- Cada operación tiene un `operationId` estable de al menos 8 caracteres. Se envía como `Idempotency-Key` en **cada** intento, también después de `rebase`.
- Mismo `operationId` y mismo contenido: el servidor responde `200 { duplicate: true }` sin agregar otro evento a `history`, y el motor confirma.
- Mismo `operationId` con otro contenido: `409 idempotency_key_reused`. En la cola local, `enqueue` lanza `IdempotencyKeyReusedError` sin cambiar nada.
- Al abrir la cola se aplica `deduplicateOperations`: conserva la primera operación de cada `operationId` sin mutar la entrada.

## 6. Reintento

- Con timeout, error de red, 5xx, 429 o una respuesta fuera de contrato, el motor llama `recordFailedAttempt`. La operación sigue `pending`, con el mismo `operationId` y `attempts + 1`, y `sync()` devuelve `{ result: 'pending', error }`.
- **Un timeout no prueba que el servidor no aplicó el cambio.**
  - Con `X-Course-Scenario: timeout_after_commit`, el servidor guarda el cambio y responde a los 1500 ms; el cliente aborta antes.
  - Al reintentar con la misma clave, el servidor responde `duplicate: true` y recién entonces se confirma, con un solo evento en el historial.
- La política de demoras y el límite de intentos (`planRetry`) son de la semana 9. Esta semana el reintento ocurre en la siguiente llamada a `sync()`.

## 7. Cuándo se retira una operación de la cola

**Sólo** con confirmación del servidor: `201`, o `200` con `duplicate: true`. En ese caso el motor:

1. Guarda la incidencia devuelta (`upsertIncident`).
2. Llama `confirm(operationId)`.

Un error o un conflicto **nunca** autorizan descartarla. La única excepción es `dismissConflict`, que decide una persona (sección 3).

## 8. Regla → prueba

Comando: `npx jest --no-watchman --ci --runInBand <archivo> -t "<nombre>"`. Las pruebas del motor levantan el backend real (`course-backend/server.mjs`) en un puerto libre y guardan la cola en disco.

| Regla | Archivo › prueba |
|---|---|
| Reasignación + inicio sin conexión = conflicto `['work']`. Se conservan ambos hechos y el conflicto sobrevive al reinicio. | `tests/week-08/sync-engine.test.ts` › `reassignment conflict keeps both facts` |
| Una operación repetida aplica un solo efecto (`duplicate: true`, un evento en `history`). | `tests/week-08/sync-engine.test.ts` › `replayed operation applies once` |
| Sin confirmación (timeout después del commit) sigue `pending` con la misma identidad; el reintento confirma sin duplicar. | `tests/week-08/sync-engine.test.ts` › `unconfirmed operation stays pending` |
| Un 500 conserva la operación. | `tests/week-08/sync-engine.test.ts` › `server error keeps the operation` |
| Un cambio remoto independiente se combina (`rebase`) con el mismo `operationId`. | `tests/week-08/sync-engine.test.ts` › `independent remote change is merged and the operation keeps its identity` |
| No se envían operaciones de otro actor. | `tests/week-08/sync-engine.test.ts` › `operations of another actor are not sent with the current session` |
| El conflicto sólo sale de la cola por decisión explícita. | `tests/week-08/sync-engine.test.ts` › `a conflict leaves the queue only by an explicit dismissal` |
| `resolveSync` compara contenido JSON y ordena los conflictos. | `tests/week-08/resolve-sync.test.ts` › `same content with keys in another order is not a conflict` y `several conflicts are reported in name order`; `course-tests/public/week-08.test.ts` |
| La deduplicación conserva la primera operación. | `course-tests/public/week-08.test.ts` › `deduplicates a replayed operation by stable identity` |
| Sólo lo confirmado sale; fallo y conflicto se conservan tras reiniciar. | `tests/week-08/persistent-queue.test.ts` › `only confirmed operations leave the queue` |
| 403 real del servidor aunque se salte la validación de la interfaz. | `tests/week-06/authorization.backend.test.ts` |

## 9. Limitación declarada

`SyncEngine` está probado contra el backend real, pero en esta versión **todavía no se llama desde `App.tsx`**. El reinicio con cola persistente se demuestra con almacenamiento en disco en las pruebas (`persistent-queue.test.ts`, `sync-engine.test.ts`), no desde la pantalla. Conectarlo a la interfaz del técnico queda pendiente para la siguiente iteración.
