# Auditoría de seguridad — Semana 4

## Hallazgos

| # | Hallazgo | Riesgo | Solución aplicada | Evidencia |
|---|---|---|---|---|
| 1 | Configuración del backend escrita directamente en código | Un valor de configuración podría quedar fijo en el repositorio y ser reutilizado sin control | Se movió a `process.env.EXPO_PUBLIC_COURSE_BACKEND_URL` y se dejó un ejemplo seguro en `.env.example` | [evidence/token-corregido.png](./evidence/token-corregido.png) |
| 2 | Se exponían ubicaciones y descripciones sensibles en la UI | La vista podía revelar información personal o del caso a usuarios no autorizados | Se quitó la impresión directa de `location` y `description` y se sustituyeron por mensajes protegidos | [evidence/logs-sanitizados.png](./evidence/logs-sanitizados.png) |
| 3 | El archivo .env no estaba ignorado | Las credenciales podían subirse accidentalmente | Se mantiene `.env` en `.gitignore` y se usa `.env.example` para variables de ejemplo | [evidence/gitignore-env.png](./evidence/gitignore-env.png) |
