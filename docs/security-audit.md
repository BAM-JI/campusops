# Auditoría de seguridad — Semana 4

**Estudiante:** Emmanuel Castro  
**Grupo:** 10A  
**Repositorio:** https://github.com/BAM-JI/campusops  
**Rama:** `week4/security-audit-emmanuel-castro`  
**Proyecto:** CampusOps (React Native, Expo, TypeScript)

Todos los datos citados son **ficticios** (fixtures académicos). No se usaron credenciales reales.

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | `redactForTelemetry` no sanitizaba: lanzaba error y dejaba pasar tokens, ubicación y fotos a logs o reportes | Un error o telemetría podía revelar sesión, identidad o evidencia | Se implementó sanitización recursiva que reemplaza campos sensibles por `[REDACTED]` sin mutar la entrada | `docs/evidence/redact-telemetria-corregido.png` |
| 2 | La lista de incidencias conservaba `location`, `reporterId` y `assignedTechnicianId` en memoria de UI | La lista no necesita esos datos; aumentaba la superficie de exposición (diapositiva: storage / datos innecesarios) | El caso de uso ahora proyecta solo `id`, `title`, `status` y `category`; la lista ya no muestra ubicación | `docs/evidence/lista-sin-ubicacion.png` |
| 3 | `.gitignore` ignoraba `.env` pero no `.env.local` ni certificados | Expo y herramientas locales suelen crear `.env.local`; un `git add .` podía subir secretos o llaves | Se agregaron `.env.local`, `.env.*.local`, `*.pem` y `*.key`, conservando `.env.example` | `docs/evidence/gitignore-env-local.png` |

## Hallazgo 1 — Sanitización de telemetría ausente

### Problema encontrado

En `src/course-evaluation/index.ts`, `redactForTelemetry` solo ejecutaba `pending(...)` y **no ocultaba nada**. Las diapositivas de Semana 4 piden sanitizar **antes de registrar** logs, errores y reportes. El contrato (`docs/CAMPUSOPS_API.md`) exige recorrer objetos y listas, normalizar claves (minúsculas, sin `_` ni `-`) y redactar tokens, email, ubicación, fotos, comentarios internos e IDs de persona.

Ejemplo de entrada ficticia que **no** debía aparecer completa en un log:

```ts
{
  request: { headers: { authorization: 'Bearer course-token' } },
  profile: { email: 'person@campusops.test' },
  location: 'Zona ficticia',
  photos: ['synthetic-photo-1'],
}
```

### Riesgo

Que no se vea en pantalla no significa que no exista. Un `console.log`, un crash report o un artefacto de CI podía conservar **sesión, ubicación o evidencia**. TLS no evita esa copia local.

### Solución

Se implementó la lógica real en `src/security/redactForTelemetry.ts` y el adaptador de evaluación **llama** a esa función (no un resultado hardcodeado).

### Antes

```ts
export function redactForTelemetry(_input: unknown): unknown {
  return pending('redactForTelemetry');
}
```

### Después

```ts
export function redactForTelemetry(input: unknown): unknown {
  return redactCampusOpsTelemetry(input);
}
```

La función copia objetos, recorre listas, normaliza cada clave y sustituye el valor completo por `[REDACTED]` si la clave es sensible. **No muta** el objeto original.

### Evidencia

- Comando: `npm test -- --ci --runInBand course-tests/public/week-04.test.ts`
- Resultado esperado: `PASS` — authorization, email, location, photos e internalComments quedan `[REDACTED]`; `incidentId` se conserva.
- Captura: `docs/evidence/redact-telemetria-corregido.png`

### Riesgo residual

Si alguien registra **texto libre** (por ejemplo, pegar un token dentro de `description`), la clave no se detecta. Hay que minimizar logs además de redactar claves conocidas.

---

## Hallazgo 2 — Datos innecesarios en la lista (minimización)

### Problema encontrado

`GetIncidentsUseCase` devolvía el `Incident` completo (`reporterId`, `assignedTechnicianId`, `location`) y la UI lo guardaba en `useState`. La lista mostraba **ubicación** en cada tarjeta. El PDF (apartado C) y las diapositivas preguntan: *¿realmente necesito guardar este dato?* Para enumerar incidencias bastan título y estado.

### Riesgo

Más campos en memoria y en pantalla aumentan la exposición si hay captura, log accidental o un perfil que no debería ver ubicación ajena. El modelo de amenazas (Semana 3) prioriza confidencialidad de ubicación y asignaciones.

### Solución

- Dominio: `IncidentListItem` + `toIncidentListItem` (omite ubicación e IDs de persona).
- Aplicación: `GetIncidentsUseCase` proyecta esa lista.
- UI: la lista muestra solo título y estado; la ubicación permanece en el **detalle** al seleccionar una incidencia.

### Antes

```ts
async execute(): Promise<Incident[]> {
  return this.repository.getAll();
}
// UI: Estado: {item.status} | {item.location}
```

### Después

```ts
async execute(): Promise<IncidentListItem[]> {
  const items = await this.repository.getAll();
  return items.map(toIncidentListItem);
}
// UI: Estado: {item.status}
```

### Evidencia

- Archivos: `src/domain/incident.ts`, `src/application/incident-usecases.ts`, `src/ui/IncidentScreens.tsx`
- Captura de la lista sin ubicación: `docs/evidence/lista-sin-ubicacion.png`

### Riesgo residual

El detalle sigue mostrando ubicación (necesaria para atender el reporte). El repositorio en memoria aún **almacena** IDs sintéticos; la minimización aplica a lo que sale hacia la lista/UI.

---

## Hallazgo 3 — `.gitignore` incompleto para secretos locales

### Problema encontrado

`.gitignore` ya incluía `.env` (bien), pero **no** `.env.local` ni `.env.*.local`, que Expo y herramientas locales usan con frecuencia. Tampoco ignoraba `*.pem` / `*.key` (archivos de firma). El PDF (apartado E) pide comprobar que secretos no se suban; agregar solo `.env` no cubre todos los archivos locales habituales.

### Riesgo

Un `git add .` podía versionar un `.env.local` con tokens o una llave de firma. Un secreto real en el repo implica revocación (gate G3 de la materia).

### Solución

Se ampliaron las reglas y se conservó `.env.example` (solo nombres / URL de desarrollo, sin secretos).

### Antes

```
.env
*.jks
```

### Después

```
.env
.env.local
.env.*.local
!.env.example
*.pem
*.key
```

### Evidencia

- Comando: `git check-ignore -v .env .env.local secrets-demo.pem`
- Resultado esperado: los tres aparecen como ignorados; `.env.example` **no** se ignora.
- Captura: `docs/evidence/gitignore-env-local.png`

Este hallazgo está **corregido** (las tres correcciones superan el mínimo de 2).

---

## Comprobaciones ejecutadas

| Comando | Para qué |
|---|---|
| `npm test -- --ci --runInBand course-tests/public/week-04.test.ts` | Sanitización (hallazgo 1) |
| `npm test -- --ci --runInBand course-tests/public/week-02.test.ts` | Arquitectura previa no se rompió |
| `npm run test:smoke` | Línea base de la app |
| `npm run typecheck` / `npm run lint` | Tipos y estilo |
| `git check-ignore -v .env.local` | Hallazgo 3 |
| `git status` | Confirmar que no hay `.env` por subir |

## Capturas que debes agregar tú

Guarda PNG con estos nombres exactos en `docs/evidence/`:

1. `redact-telemetria-corregido.png` — terminal con el `PASS` de `week-04.test.ts`
2. `lista-sin-ubicacion.png` — código de la lista (solo estado) o pantalla si la corres
3. `gitignore-env-local.png` — salida de `git check-ignore` o el bloque nuevo de `.gitignore`

No uses nombres tipo `Captura de pantalla 2026-09-24.png`.
