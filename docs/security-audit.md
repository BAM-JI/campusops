# Auditoría de seguridad — Semana 4

**Proyecto:** CampusOps
**Estudiante:** Dana Lizbeth
**Rama de trabajo:** `week4/security-audit-lizbeth`
**Entorno:** React Native / Expo / TypeScript

---

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Configuración del backend escrita directamente en código | Un valor de configuración podría quedar fijo en el repositorio y ser reutilizado sin control | Se movió a `process.env.EXPO_PUBLIC_COURSE_BACKEND_URL` y se dejó un ejemplo seguro en `.env.example` | [token-corregido.png](evidence/token-corregido.png) |
| 2 | Se exponían ubicaciones y descripciones sensibles en la UI (`src/ui/IncidentScreens.tsx`) | La vista podía revelar información personal o del caso a usuarios no autorizados | Se quitó la presentación directa de `location` y `description` y se sustituyeron por mensajes protegidos | [logs-sanitizados.png](evidence/logs-sanitizados.png) |
| 3 | Riesgo de subir el archivo `.env` al repositorio | Las credenciales podían subirse accidentalmente al repositorio público | Se mantiene `.env` en `.gitignore` y se creó `.env.example` para variables de ejemplo | [gitignore-env.png](evidence/gitignore-env.png) |

---

## Hallazgo 1 — Configuración del backend desacoplada a variables de entorno

### Ubicación en el proyecto

- `src/api/courseBackend.ts`
- `.env.example`

### Problema encontrado

La URL base del backend estaba definida como una cadena fija dentro del adaptador de
API. La dirección utilizada es ficticia y sólo corresponde al backend didáctico local,
pero mantenerla dentro de la lógica dificulta separar configuraciones por entorno.

### Riesgo

Mantener direcciones IP, URLs o configuraciones de entornos de desarrollo y producción
hardcodeadas en el código fuente puede enviar peticiones al destino equivocado y
dificultar el despliegue seguro en diferentes entornos. Las variables
`EXPO_PUBLIC_*` son configuración pública del cliente y no deben contener secretos.

### Solución

1. Se refactorizó la lectura de configuración para consumir
   `process.env.EXPO_PUBLIC_COURSE_BACKEND_URL`.
2. Se aplica `trim()` y se conserva la dirección local ficticia como fallback cuando
   la variable está vacía.
3. Se documentó la variable en `.env.example` sin credenciales reales.

### Antes

```ts
const DEFAULT_URL = 'http://127.0.0.1:4310';

export async function getBackendHealth(
  baseUrl = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL ?? DEFAULT_URL,
): Promise<BackendHealth> {
```

### Después

```ts
const DEFAULT_URL = 'http://127.0.0.1:4310';
const COURSE_BACKEND_URL = process.env.EXPO_PUBLIC_COURSE_BACKEND_URL?.trim() || DEFAULT_URL;

export async function getBackendHealth(
  baseUrl = COURSE_BACKEND_URL,
): Promise<BackendHealth> {
```

Configuración en `.env.example`:

```dotenv
EXPO_PUBLIC_COURSE_BACKEND_URL=
EXPO_PUBLIC_APP_ENV=development
```

### Evidencia

Se comprobó la lectura de la variable con un valor ficticio:

```text
node -e "process.env.EXPO_PUBLIC_COURSE_BACKEND_URL='https://demo.local'; console.log(process.env.EXPO_PUBLIC_COURSE_BACKEND_URL)"
https://demo.local
```

Evidencia visual: [token-corregido.png](evidence/token-corregido.png).

---

## Hallazgo 2 — Protección y sanitización de datos sensibles en la UI

### Ubicación en el proyecto

- `src/ui/IncidentScreens.tsx`

### Problema encontrado

La pantalla de visualización de incidentes renderizaba directamente los campos
`location` y `description` en el detalle. La lista también mostraba la ubicación junto
al estado de cada incidencia.

No se encontró `console.log` con estos datos en el código actual; el riesgo identificado
correspondía a la exposición directa en la interfaz.

### Riesgo

Mostrar información geográfica exacta o descripciones internas del reporte en vistas
globales o dispositivos compartidos puede provocar fuga de privacidad y seguimiento no
autorizado si la pantalla se inspecciona, graba o comparte.

### Solución

1. Se eliminó `item.location` de la fila de la lista.
2. Se implementó `formatSensitiveField`.
3. En el detalle, la ubicación y la descripción se reemplazan por mensajes protegidos.
4. No se agregaron registros de consola con los valores sensibles.

### Antes

```tsx
<Text>Ubicación: {selectedIncident.location}</Text>
<Text>Descripción: {selectedIncident.description}</Text>
<Text>
  Estado: {item.status} | {item.location}
</Text>
```

### Después

```tsx
const formatSensitiveField = (value: string | undefined, fallback: string) =>
  value && value.trim().length > 0 ? fallback : 'No disponible';

<Text>
  Ubicación: {formatSensitiveField(selectedIncident.location, '[ubicación protegida]')}
</Text>
<Text>
  Descripción: {formatSensitiveField(selectedIncident.description, '[detalle protegido]')}
</Text>
<Text>Estado: {item.status}</Text>
```

### Evidencia

El diff de `src/ui/IncidentScreens.tsx` confirma que la lista ya no concatena
`item.location` y que el detalle utiliza mensajes protegidos.

Evidencia visual: [logs-sanitizados.png](evidence/logs-sanitizados.png).

---

## Hallazgo 3 — Exclusión de archivos de entorno locales en Git

### Ubicación en el proyecto

- `.gitignore`
- `.env.example`

### Problema evaluado

Los archivos `.env` pueden contener credenciales o configuraciones privadas y no deben
formar parte del repositorio. En la revisión actual, la regla preventiva ya está
presente en `.gitignore`; por eso este punto se registra como control verificado y no
como una credencial real encontrada.

### Riesgo

Subir accidentalmente un archivo `.env` a GitHub puede exponer secretos, tokens y
credenciales privadas en el historial público del proyecto.

### Solución

1. Se verificó la inclusión de `.env` en `.gitignore`.
2. Se conserva `.env.example` como plantilla sin credenciales reales.
3. Se confirmó con `git status` que `.env` no aparece como archivo pendiente.

Regla en `.gitignore`:

```gitignore
.env
```

Plantilla segura:

```dotenv
EXPO_PUBLIC_COURSE_BACKEND_URL=
EXPO_PUBLIC_APP_ENV=development
```

### Evidencia

Evidencia visual: [gitignore-env.png](evidence/gitignore-env.png).

---

## Comprobación final y verificación de seguridad

1. **Verificación de tipos:**

   ```bash
   npm run typecheck
   ```

2. **Verificación de linter:**

   ```bash
   npm run lint
   ```

3. **Pruebas automatizadas:**

   ```bash
   npx jest course-tests/security-audit.test.ts || npm run test:smoke
   ```

4. **Confirmación de Git:**

   ```bash
   git status
   ```

   El estado no muestra archivos `.env` pendientes de rastreo.

5. Todos los datos utilizados en la auditoría y en las evidencias son ficticios.
   No se incluyeron contraseñas, tokens ni credenciales reales.
