# Modelo de amenazas inicial — CampusOps

## 1. Alcance y contexto

CampusOps gestiona incidencias universitarias ficticias, sesiones sintéticas,
fotografías preparadas, ubicaciones de prueba y asignaciones operativas para
reportantes, técnicos y coordinadores. Este modelo cubre la aplicación móvil,
el backend didáctico, el repositorio GitHub y su pipeline de integración
continua. No cubre infraestructura institucional ni datos reales.

## 2. Activos que debemos proteger

- **A1 — Sesiones y credenciales:** tokens sintéticos, cabeceras de
  autenticación y futuras credenciales de proveedores.
- **A2 — Confidencialidad de incidencias:** descripción, ubicación,
  fotografías y notas visibles únicamente para actores autorizados.
- **A3 — Integridad de asignaciones y estados:** técnico responsable,
  prioridad, versión y transiciones `open → assigned → in_progress →
  resolved → closed`.
- **A4 — Trazabilidad:** historial de cambios, autor, evidencias y resultados
  reproducibles asociados a un SHA.
- **A5 — Cadena de CI:** código fuente, workflows, dependencias, reportes y
  artefactos producidos por GitHub Actions.

## 3. Fronteras de confianza y flujos

- **F1 — Persona usuaria ↔ UI móvil:** la entrada de formularios y acciones
  debe considerarse no confiable, aunque la UI oculte botones según el rol.
- **F2 — Aplicación móvil ↔ almacenamiento local:** los datos salen del
  proceso de React Native hacia memoria o persistencia; no deben almacenarse
  secretos en texto plano.
- **F3 — Cliente móvil ↔ backend REST:** las solicitudes cruzan una frontera
  de red y transportan sesión, actor, identificadores y datos de incidencias.
  El backend debe volver a comprobar identidad, rol, asignación y versión.
- **F4 — Persona desarrolladora ↔ GitHub Actions:** un `push` introduce código
  y configuración en un runner temporal que instala dependencias y produce
  artefactos.
- **F5 — GitHub Actions ↔ artefactos:** los reportes publicados pueden ser
  descargados; no deben contener secretos ni datos sensibles.

## 4. Criterio de prioridad

La prioridad combina probabilidad, impacto y alcance. Atendemos primero una
exposición de credenciales porque puede facilitar acceso a varias incidencias,
afectar la cadena de CI y exigir revocación inmediata. Después atendemos el
acceso o modificación no autorizados porque afectan directamente la
confidencialidad e integridad del flujo principal.

## 5. Amenazas, controles y verificación

### Prioridad 1 — T1: exposición de credenciales o secretos

- **Escenario:** se sube por error un token, clave privada o secreto dentro
  del código, un workflow o un artefacto.
- **Activos y fronteras:** A1 y A5; F4 y F5.
- **Control:** escaneo automático de patrones de secretos, `.gitignore`,
  valores ficticios y revisión de los artefactos antes de entregarlos.
- **Verificación:** `make verify-week-03` debe reportar `secret_scan=pass`.
  Introducir un patrón de prueba en una copia temporal debe producir un estado
  `fail`; el patrón se elimina antes del commit.
- **Riesgo residual:** un secreto con formato desconocido puede no coincidir
  con los patrones del escáner. Se mantiene revisión humana y revocación ante
  cualquier exposición.

### Prioridad 2 — T2: consulta de incidencias ajenas

- **Escenario:** una persona cambia un identificador en la solicitud para
  consultar una incidencia que no le pertenece ni le fue asignada.
- **Activos y fronteras:** A2; F1 y F3.
- **Control:** autorización en el backend para cada recurso. Ocultar botones
  en la UI no sustituye esta validación.
- **Verificación:** `npm run backend:self-test` solicita una incidencia con
  un actor no autorizado y espera una respuesta `403 forbidden`.
- **Riesgo residual:** un defecto en una ruta nueva podría omitir la
  autorización; cada endpoint futuro necesita pruebas negativas equivalentes.

### Prioridad 3 — T3: alteración no autorizada de asignaciones o estados

- **Escenario:** un reportante o técnico manipula el payload para reasignar,
  cerrar o modificar una incidencia sin tener el rol o la asignación exigidos.
- **Activos y fronteras:** A3 y A4; F1 y F3.
- **Control:** el backend valida rol, técnico asignado, transición permitida,
  versión base e idempotencia antes de guardar el cambio.
- **Verificación:** `npm run backend:self-test` intenta cerrar con un
  reportante y actuar con un técnico ya reasignado; ambos casos deben devolver
  `403`. Una versión obsoleta debe devolver `409`.
- **Riesgo residual:** una operación offline puede conservar una intención
  obsoleta hasta sincronizar; debe permanecer pendiente y mostrar el conflicto.

### Prioridad 4 — T4: fuga de datos sensibles en registros

- **Escenario:** ubicación, sesión, identidad, fotografías o comentarios
  internos aparecen en consola, telemetría o reportes de CI.
- **Activos y fronteras:** A1, A2 y A5; F2, F3 y F5.
- **Control:** centralizar la sanitización en `redactForTelemetry`, usar una
  lista de campos protegidos y evitar registrar texto libre.
- **Verificación prevista:** la prueba
  `course-tests/public/week-04.test.ts` debe comprobar que los campos
  sensibles se sustituyen por `[REDACTED]` y que se conserva únicamente
  contexto técnico. Este control todavía no se declara implementado en la
  Semana 3.
- **Riesgo residual:** una persona puede escribir datos sensibles dentro de
  un campo de texto libre; se requiere minimizar los logs además de redactar
  claves conocidas.

### Prioridad 5 — T5: privilegios excesivos o comprobaciones omitidas en CI

- **Escenario:** un workflow comprometido modifica el repositorio, o un error
  obligatorio se convierte artificialmente en éxito.
- **Activos y fronteras:** A4 y A5; F4 y F5.
- **Control:** `permissions: contents: read`, dependencias fijadas con
  `npm ci`, ausencia de `continue-on-error`, `|| true` y
  `--passWithNoTests`, y conservación de reportes como artefactos.
- **Verificación:** `npm test -- --ci --runInBand
  course-tests/public/week-03.test.ts` inspecciona el workflow y debe fallar
  si se retira el mínimo privilegio o se agrega un mecanismo de omisión.
- **Riesgo residual:** siguen existiendo riesgos en acciones y dependencias de
  terceros; se fijan versiones mayores aprobadas y se ejecuta `npm audit`.

## 6. Decisión inicial

La primera medida verificable es impedir que secretos lleguen al repositorio y
a los artefactos, porque tiene alto impacto y puede comprobarse en cada
`push`. Esto no elimina la necesidad de autorización por recurso: los
controles de acceso del backend se conservan como segunda prioridad y se
comprueban con casos negativos. Cada control queda relacionado con un comando
y un resultado observable para evitar que el modelo sea solamente una lista
teórica.
