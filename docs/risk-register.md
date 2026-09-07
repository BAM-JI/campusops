# Registro de riesgos — CampusOps

| Prioridad | Riesgo | Probabilidad | Impacto | Mitigación | Cómo comprobar la mitigación |
|---:|---|---|---|---|---|
| 1 | Conflicto de concurrencia en sincronización offline al reasignar incidencias | alta por trabajo desconectado frecuente en campo | alto por pérdida de consistencia y sobreescritura de asignaciones | Evaluar versión base y campo compuesto work (assignedTechnicianId + status), rechazando cambios obsoletos | Respuesta HTTP 409 ante versión desactualizada y permanencia de la intención en cola local |
| 2 | Filtración involuntaria de credenciales o datos PII en logs de telemetría | media por volumen de campos transportados | alto por riesgo de seguridad y exposición de tokens | Adaptador de sanitización redactForTelemetry que sustituye campos sensibles por [REDACTED] | Verificación de payload de salida sin campos de autorización, contraseñas o datos personales |
| 3 | Falla o indisponibilidad en servicio externo de geocodificación y mapas | alta por cuotas de red y áreas sin cobertura | medio por bloqueo temporal de captura de reportes | Adaptador selectIncidentLocation con degradación suave hacia captura manual de texto | Recepción de timeout o HTTP 429 genera objeto estructurado con source manual sin lanzar excepción |

## Riesgo que atenderíamos primero

Atenderíamos primero el riesgo de prioridad 1 (conflicto de concurrencia en sincronización offline) porque compromete la integridad del modelo operativo central de CampusOps. Si el técnico atiende una incidencia en un área sin conectividad mientras coordinación la reasigna en el servidor, aplicar una política Last-Write-Wins provocaría inconsistencias graves en la base de datos y pérdida del historial de auditoría.
