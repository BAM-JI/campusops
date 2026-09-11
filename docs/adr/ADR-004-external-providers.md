# ADR-004: Abstracción de servicios de ubicación y geocodificación con respaldo manual

## Estado
Aceptado

## Contexto
La creación de incidencias requiere geocodificación o referencia geográfica, pero la conectividad puede ser inestable o los permisos pueden ser denegados por el usuario.

## Alternativas consideradas
1. **Alternativa A:** Dependencia dura del SDK de mapas y obligatoriedad de coordenadas GPS.
2. **Alternativa B:** Adaptador con doble determinista de geocodificación y fallback a entrada manual de texto (Edificio/Aula).

## Decisión
Se elige la **Alternativa B**. La capa de UI utiliza una interfaz `ILocationProvider`. Si el proveedor falla, responde con timeout o se deniega el permiso, la aplicación degrada de forma segura a captura manual sin detener el reporte.

## Consecuencias y Trade-offs
* **Ventajas:** Continuidad operativa total bajo fallas de red o permisos denegados.
* **Costo:** El dominio debe manejar ubicaciones con o sin coordenadas geográficas explícitas.