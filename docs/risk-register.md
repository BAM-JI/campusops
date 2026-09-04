# CampusOps — Registro de Riesgos Técnicos

## Matriz de Riesgos Priorizados

| ID | Riesgo Técnico | Probabilidad | Impacto | Severidad | Mitigación Planificada |
|---|---|---|---|---|---|
| **RSK-01** | Conflicto de concurrencia en sincronización offline al reasignar incidencias | Alta | Alta | **Crítica (1)** | Implementar detección de versión base (`baseVersion`) y evaluación del campo compuesto `work` (`assignedTechnicianId` + `status`). Rechazar escrituras obsoletas con HTTP 409 y retener la operación en cola para resolución explícita. |
| **RSK-02** | Filtración de datos personales (PII) o tokens en logs de telemetría | Media | Alta | **Alta (2)** | Implementar adaptador puro `redactForTelemetry` que normalice claves y reemplace información sensible (`token`, `password`, `email`, `location`, `photos`) por `[REDACTED]`, conservando solo identificadores de correlación y métricas. |
| **RSK-03** | Falla o límite de cuota en proveedor externo de geocodificación/mapas | Alta | Media | **Media (3)** | Diseñar adaptador resiliente `selectIncidentLocation` con timeouts acotados y fallback automático a entrada de texto manual estructurada, sin bloquear el registro de incidencias. |

## Justificación del Riesgo Prioritario (RSK-01)

El riesgo **RSK-01** se atiende en primer lugar debido a que compromete la integridad del modelo operativo central. CampusOps depende de que el personal de campo opere en sótanos o áreas sin cobertura de red. Si la sincronización aplicara una estrategia ingenua de *Last-Write-Wins*, un técnico sobrescribiría una reasignación realizada por coordinación, generando trabajo duplicado, pérdida de auditoría e inconsistencia en los estados de la base de datos.
