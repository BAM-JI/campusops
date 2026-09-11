# ADR-003: Detección y resolución de conflictos en sincronización

## Estado
Aceptado

## Contexto
Un técnico puede iniciar la atención de una incidencia localmente mientras coordinación la reasigna en el servidor. Al sincronizar, el campo compuesto `work` (técnico + estado) genera una colisión incompatible.

## Alternativas consideradas
1. **Alternativa A: Last-Write-Wins (LWW):** El último timestamp sobrescribe sin validación.
2. **Alternativa B: Detección explícita de colisión por versión base y preservación de intención:** Comparación semántica y HTTP 409.

## Decisión
Se elige la **Alternativa B**. Se envía la `baseVersion`. Si el servidor detecta una versión superior o un cambio en el campo `work`, devuelve HTTP 409. El cliente retiene la intención del técnico en estado de conflicto sin sobrescribir la asignación remota y notifica a la interfaz.

## Consecuencias y Trade-offs
* **Ventajas:** No hay pérdida silenciosa de asignaciones de coordinación ni de trabajo técnico.
* **Costo:** Mayor complejidad en la UI para presentar incidencias en estado de conflicto y requerir intervención manual o reintento asistido.