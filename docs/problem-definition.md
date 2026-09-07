# Definición del problema — CampusOps

## Problema

Falta de trazabilidad y gestión centralizada de incidencias en infraestructura y equipamiento dentro de un campus universitario ficticio. Actualmente los reportes de fugas de agua, fallas eléctricas, daños en laboratorios y problemas de red se gestionan mediante canales informales sin asignación clara, sin control de concurrencia ni registro histórico verificable.

## Alcance

### Incluye

- Ciclo de vida completo de incidencias con máquina de estados estricta y tres perfiles autorizados en servidor.
- Operación offline-first para técnicos con cola local persistente recuperable ante reinicios y detección de conflictos.

### No incluye

- Pasarelas de pago o transacciones monetarias dentro de la aplicación.
- Chat en tiempo real, publicación obligatoria en tiendas, modelos de IA o datos reales del campus.

## Actores y responsabilidades

- **Reportante:** Crear incidencias con categoría, descripción, foto y ubicación; consultar sus propios reportes y añadir notas.
- **Técnico:** Consultar incidencias asignadas, iniciar atención offline, y registrar diagnósticos, notas y evidencias de solución.
- **Coordinador:** Consultar la totalidad de incidencias, priorizar, asignar técnicos, auditar evidencias y cerrar o reabrir casos.

## Flujo principal

1. Reportar: El reportante registra la incidencia en estado open con categoría, descripción y ubicación.
2. Asignar: El coordinador prioriza la incidencia y le asigna un técnico responsable, pasando a estado assigned.
3. Atender: El técnico asignado inicia atención (in_progress), resuelve la falla y registra diagnóstico (resolved).
4. Cerrar: El coordinador audita las evidencias y diagnóstico presentados y ejecuta el cierre definitivo (closed).

## Criterios de aceptación verificables

1. Dado un intento repetido de mutación con la misma Idempotency-Key, el servidor retorna el resultado original sin duplicar eventos en el historial.
2. Dado un técnico que atiende offline una incidencia reasignada en el servidor, la sincronización detecta conflicto en el campo work y rechaza la sobrescritura silenciosa con HTTP 409.
3. Dada una falla o timeout en el proveedor de geocodificación, la aplicación activa fallback automático permitiendo la captura manual de la ubicación sin interrumpir el flujo de reporte.