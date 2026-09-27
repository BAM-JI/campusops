# Auditoría de seguridad — Semana 4

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Token y endpoint configurados como literales en el código fuente | Una persona con acceso de lectura al repositorio puede extraer credenciales operativas | Se migraron a variables de entorno con `process.env` y se creó `.env.example` | docs/evidence/api-variables.png |
| 2 | Impresión completa de objetos de respuesta en consola (`console.log`) | Exposición de información de usuarios, fotos y tokens en los logs del sistema o depurador | Se eliminó el volcado crudo y se registraron únicamente métricas técnicas no sensibles | docs/evidence/logs-sanitizados.png |
| 3 | Riesgo de rastreo accidental de archivos de entorno local `.env` | Subida accidental de credenciales locales a GitHub si se crea un archivo de configuración | Se verificó y reforzó `.gitignore` con exclusión de `.env` y `.env.local` | docs/evidence/env-gitignore.png |

---

## Hallazgo 1 — Token y URL escritos directamente en código

### Problema encontrado
Se identificó que los valores de conexión al backend didáctico y el token de prueba se encontraban escritos como cadenas literales dentro del código cliente de peticiones.

### Riesgo
Cualquier persona que clone o lea el repositorio público obtiene acceso directo a las credenciales y rutas internas del servicio, comprometiendo la confidencialidad.

### Solución
Se eliminaron las cadenas literales y se sustituyeron por variables de entorno del entorno de Expo (`process.env.EXPO_PUBLIC_*`), proveyendo una plantilla segura `.env.example`.

### Antes
```ts
const API_URL = "[http://127.0.0.1:4310](http://127.0.0.1:4310)";
const TOKEN = "Bearer course-valid-token";

EvidenciaHallazgo 2 — Impresión de información sensible en consolaProblema encontradoSe detectaron llamadas a console.log imprimiendo la respuesta cruda de servicios de incidencias y sesiones, exponiendo identificadores, correos y tokens en texto plano[cite: 6, 11].RiesgoLos registros de consola quedan almacenados en herramientas de observabilidad, emuladores o terminales de depuración, violando la privacidad de los datos personales.   SoluciónSe eliminó la impresión de objetos completos y se sustituyó por un registro técnico mínimo que solo preserva metadatos seguros (código HTTP y conteo).   AntesTypeScriptconsole.log("Datos recibidos:", data);