# CampusOps — Definición del Problema y Alcance

## 1. Problema que atiende CampusOps
CampusOps resuelve la falta de trazabilidad y gestión centralizada de incidencias en infraestructura y equipamiento dentro de un campus universitario ficticio. Actualmente, los reportes de fugas de agua, fallas eléctricas, daños en laboratorios y problemas de red se gestionan mediante canales informales sin asignación clara, sin control de concurrencia ni registro histórico verificable.

## 2. Límites y Alcance del Proyecto
* **Dentro del alcance (In-Scope):**
  * Ciclo de vida completo de incidencias con máquina de estados estricta.
  * Tres perfiles de usuario (Reportante, Técnico, Coordinador) con control de acceso validado en servidor.
  * Operación offline-first para técnicos con cola local persistente recuperable ante reinicios.
  * Detección y resolución explícita de conflictos en sincronización (campo compuesto `work`).
  * Idempotencia en creación y mutación de incidencias mediante cabecera `Idempotency-Key`.
  * Geocodificación asistida con fallback obligatorio a captura manual de ubicación.
  * Sanitización estricta de telemetría y logs (sin PII ni credenciales).
  * Generación y verificación de paquete/release Android trazable.

* **Fuera del alcance (Out-of-Scope):**
  * Pasarelas de pago o transacciones monetarias.
  * Chat o mensajería en tiempo real (se utiliza historial formal de notas/comentarios).
  * Modelos de Inteligencia Artificial para reconocimiento o clasificación de imágenes.
  * Panel de administración web complejo (todo se gestiona desde la app móvil según rol).
  * Publicación obligatoria en Google Play Store.
  * Datos, credenciales, planos o ubicaciones reales de la institución.

## 3. Perfiles y Responsabilidades
* **Reportante:** Alumnos o docentes ficticios. Crean incidencias seleccionando categoría, descripción textual, referencia de ubicación y adjuntando evidencia visual. Pueden consultar exclusivamente sus propios reportes y añadir notas aclaratorias posteriores.
* **Técnico:** Personal operativo. Consulta sus incidencias asignadas, inicia atención (`in_progress`), registra notas técnicas, diagnósticos y evidencias de reparación. Opera en zonas sin conectividad almacenando cambios en la cola local.
* **Coordinador:** Personal administrativo. Visualiza el total de incidencias del campus, prioriza tickets, asigna o reasigna técnicos, audita diagnósticos y evidencias, y ejecuta el cierre formal (`closed`) o la reapertura hacia `assigned`.

## 4. Ciclo de Vida de la Incidencia (Recorrido Crítico)
El flujo de estados se rige por transiciones formales y unidireccionales:

`open` (creada por Reportante) 
  → `assigned` (técnico y prioridad asignados por Coordinador) 
  → `in_progress` (atención iniciada por el Técnico asignado) 
  → `resolved` (solución diagnosticada por el Técnico) 
  → `closed` (verificación y cierre definitivo por Coordinador)

* **Reapertura:** Exclusiva del Coordinador desde `resolved` o `closed` hacia `assigned`.
* **Regla de autorización:** Ocultar elementos visuales no reemplaza la validación en backend; mutaciones sin el rol correspondiente devuelven HTTP 403.

## 5. Criterios de Aceptación Verificables
1. **Idempotencia de Red:** Repetir una solicitud con la misma `Idempotency-Key` devuelve el mismo resultado sin duplicar registros, notas ni eventos de historial en el backend.
2. **Consistencia Concurrente:** Si un técnico inicia atención offline sobre una incidencia que el coordinador reasignó en el servidor, el intento de sincronización detecta conflicto en el campo `work` (`{ assignedTechnicianId, status }`) y no sobrescribe silenciosamente el estado remoto.
3. **Persistencia de Cola:** Las mutaciones offline almacenadas sobreviven al cierre forzado y reinicio de la aplicación, reanudando la sincronización cuando se restablece la red.
4. **Degradación de Ubicación:** Si el servicio de geocodificación responde con timeout, HTTP 429 o coordenadas anómalas, la aplicación permite registrar el incidente mediante captura manual sin abortar el flujo.