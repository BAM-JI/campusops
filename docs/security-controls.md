# Controles de seguridad y privacidad — CampusOps

## 1. Superficies donde termina la información

Ocultar un campo en la UI no protege el dato. Revisamos cuatro destinos, a partir del modelo de amenazas de Semana 3 (`docs/threat-model.md`):

| Superficie | Qué puede quedar | Activos |
|---|---|---|
| Almacenamiento local | Token de sesión, actor, preferencias | A1, F2 |
| Logs / telemetría | authorization, email, ubicación, fotos, comentarios internos | A1, A2, F5 |
| Errores y crash reports | el mismo objeto que falló, sin sanitizar | A1, A2 |
| Reportes y artefactos de CI | evidencias o dumps con datos sensibles | A4, A5 |

No usamos datos reales. Los ejemplos son fixtures (`course-token`, `person@campusops.test`, `campus-inc-001`).

## 2. Decisión de almacenamiento (AC-04)

**Pregunta:** ¿dónde persistir sesión y tokens cuando la app los guarde?

### Alternativa A — AsyncStorage / almacenamiento plano (descartada)

- **Ventaja:** API simple, ya conocida en React Native.
- **Costo:** el token queda en texto plano y se puede leer con acceso casual al storage del dispositivo. Las diapositivas de Semana 4 describen exactamente este fallo: “sesión en almacenamiento plano aunque exista TLS”.

### Alternativa B — Almacenamiento seguro de Expo (elegida)

Usar **`expo-secure-store`**, que en iOS escribe en **Keychain** y en Android en **EncryptedSharedPreferences**.

- **Ventaja:** reduce la exposición ante lectura casual del storage; separa secretos de preferencias no sensibles.
- **Costo:** más dependencia, API asíncrona y límites de tamaño; no sustituye sanitizar logs.

**Política:**

| Dato | Destino |
|---|---|
| Token / refresh / sesión | Almacenamiento seguro (`expo-secure-store`) |
| Preferencias no sensibles (tema, último filtro) | Storage normal |
| Secretos de producción | Nunca en el repositorio ni en `EXPO_PUBLIC_*` |

Esta semana la sanitización ya está en código (`redactForTelemetry`). El persistir sesión completa corresponde al flujo de login (Semana 6); la decisión de **dónde** debe vivir el token queda fijada ahora para no acoplar la UI a AsyncStorage.

### Riesgo residual del almacenamiento

SecureStore **no elimina**:

- dispositivo comprometido, root o jailbreak;
- volcados de memoria (memory dumps) mientras el token está en RAM;
- capturas de pantalla;
- logs o reportes si alguien registra el token **antes** de sanitizar;
- un token de larga duración sin rotación.

Mitigación complementaria: sanitizar toda salida, rotar/revocar ante exposición y no loguear el objeto de sesión.

## 3. Sanitización de registros (implementada)

`redactForTelemetry` en `src/course-evaluation/index.ts` es la lógica real (no un resultado hardcodeado):

1. Recorre listas y objetos anidados.
2. Normaliza cada clave (minúsculas, sin `_` ni `-`).
3. Si la clave es sensible, el **valor completo** se sustituye por `[REDACTED]`.
4. **No muta** la entrada: escribe un objeto nuevo.

**Ocultar:** `authorization`, `password`, `token`, `accessToken`, `refreshToken`, `email`, `displayName`, `name`, `userId`, `reporterId`, `technicianId`, `assignedTechnicianId`, `location`, `latitude`, `longitude`, `photos`, `evidence`, `internalComments`, `assignmentHistory`.

**Conservar (contexto técnico):** `incidentId`, `correlationId`, `status`, `attempt`, `durationMs`, cabeceras no identificadoras (`accept`).

Errores y reportes deben pasar por esta función **antes** de escribirse. Un error de conexión no debe incluir URL con credenciales ni el payload crudo.

## 4. Relación con amenazas de Semana 3

| Amenaza | Control de esta semana | Cómo se comprueba |
|---|---|---|
| T1 — secretos en repo o artefactos | `.gitignore` (`.env`, `.env.local`), fixtures públicos, `secret_scan` | `make verify-week-04` |
| T4 — fuga en logs / telemetría | `redactForTelemetry` recursiva | `npm test -- --ci --runInBand course-tests/public/week-04.test.ts` |
| T5 — CI con privilegios o checks omitidos | workflow Semana 4: `contents: read`, sin `continue-on-error` | `week-04-seguridad-privacidad-feedback.yml` |
| T2 / T3 — incidencias o asignaciones ajenas | Autorización en backend (ya en self-test); la UI no sustituye al servidor | `npm run backend:self-test` |

## 5. Pruebas negativas (qué NO debe ocurrir)

Con fixtures ficticios se comprueba que **no** aparecen:

- token / `authorization` en el objeto sanitizado;
- `location`, `photos`, `internalComments` ni email en logs o reportes;
- el objeto original modificado (pureza).

Comando de referencia:

```bash
npm test -- --ci --runInBand course-tests/public/week-04.test.ts
```

Resultado esperado: `PASS` — campos sensibles en `[REDACTED]`; `incidentId` y `accept` se conservan.

Los reportes `reports/week-04/secret-scan.json` y `negative-tests.json` los completa el equipo sobre el SHA comprobado; este documento no los sustituye.

## 6. Resumen para AC-04

Elegimos **almacenamiento seguro (expo-secure-store → Keychain / EncryptedSharedPreferences)** para tokens y **rechazamos AsyncStorage en claro**. El control ya demostrable esta semana es **sanitizar antes de registrar**. El riesgo que aceptamos es el de un dispositivo comprometido o un dump de memoria: SecureStore no es un cofre absoluto.
