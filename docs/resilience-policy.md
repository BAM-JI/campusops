# CampusOps — Política de resiliencia e integración con servicios externos

**Proyecto:** CampusOps  
**Asignatura:** Desarrollo Móvil Integral (DMI)  
**Semana:** 09  
**Equipo:** team-campusops

## 1. Objetivo

Establecer las estrategias de resiliencia utilizadas por CampusOps para manejar errores de comunicación con servicios externos, conservar la funcionalidad de la aplicación y evitar inconsistencias en las operaciones.

La implementación contempla validación de respuestas, tiempos de espera, reintentos controlados, caché de ubicaciones, alternativa manual e idempotencia para operaciones que modifican información.

## 2. Integración con el proveedor de geocodificación

CampusOps implementa una arquitectura basada en adaptadores mediante la interfaz `GeocodingPort`, definida en `src/location/geocoding-adapter.ts`.

Se utilizan dos adaptadores:

- **NominatimGeocodingAdapter:** realiza consultas reales al servicio OpenStreetMap Nominatim.
- **CourseGeocodingAdapter:** permite interactuar con el proveedor controlado del curso y reproducir escenarios de error mediante pruebas automatizadas.

La aplicación utiliza consultas HTTP GET para obtener información geográfica a partir de una ubicación textual.

El adaptador real emplea un User-Agent identificable, limita las solicitudes a un intervalo mínimo de un segundo entre peticiones de la misma instancia y utiliza un tiempo de espera predeterminado de cinco segundos.

## 3. Manejo de fallos del proveedor

Los errores de geocodificación se representan como resultados controlados mediante `GeocodingLookup`, evitando que los fallos esperados se propaguen como excepciones sin manejar.

| Escenario | Respuesta del adaptador | Comportamiento esperado |
|---|---|---|
| Respuesta válida | `result` | Utilizar ubicación del proveedor |
| Timeout | `unavailable: timeout` | Conservar ubicación manual |
| Desconexión | `unavailable: network` | Conservar ubicación manual |
| HTTP 429 | `unavailable: rate_limited` | Aplicar política de reintento cuando esté configurada; si no se recupera, utilizar ubicación manual |
| HTTP 500 o superior | `unavailable: server` | Aplicar política de reintento cuando corresponda |
| Respuesta inválida | Resultado rechazado por validación | Conservar ubicación manual |
| Consulta vacía | `unavailable: empty_query` | No realizar una consulta innecesaria |

Los reintentos del adaptador del curso son opcionales. El adaptador real de Nominatim no implementa por sí mismo la política de reintentos.

## 4. Validación y alternativa manual

La función `selectIncidentLocation`, ubicada en `src/location/select-incident-location.ts`, verifica que los datos recibidos cumplan las siguientes condiciones:

- La etiqueta de ubicación es un texto no vacío.
- La latitud es un número finito entre -90 y 90.
- La longitud es un número finito entre -180 y 180.
- La respuesta contiene los campos necesarios y sus tipos son correctos.

Cuando la respuesta es válida, se utiliza `source: provider`.

Si el proveedor devuelve información incompleta, inválida o no disponible, se conserva el texto proporcionado por el usuario mediante `source: manual`.

En este último caso, la aplicación no inventa coordenadas.

## 5. Política de caché

La clase `CachedGeocoder`, implementada en `src/location/geocoding-adapter.ts`, permite reutilizar resultados válidos sin realizar consultas repetidas al proveedor.

Configuración predeterminada:

- **TTL:** 10 minutos.
- **Capacidad máxima:** 20 entradas.
- **Clave:** texto normalizado mediante eliminación de espacios externos y conversión a minúsculas.
- **Expulsión:** eliminación de la entrada más antigua cuando se alcanza el límite.

Únicamente se almacenan resultados de ubicación válidos. No se almacenan errores, coordenadas inválidas, tokens de autenticación ni información del actor.

Las entradas vencidas se eliminan cuando se intenta consultarlas nuevamente.

## 6. Política de reintentos

CampusOps utiliza `planRetry`, definida en `src/api/retry-policy.ts`, para decidir si una operación puede repetirse.

La política considera:

- Tipo de solicitud HTTP.
- Código de respuesta o fallo de comunicación.
- Número de intento.
- Encabezado `Retry-After`, cuando corresponde.
- Tiempo de espera progresivo.
- Límite de intentos configurado.

Las pruebas automatizadas verificaron una política con un máximo de cuatro intentos, respeto de `Retry-After` y ausencia de reintentos para determinados errores de negocio.

Las solicitudes POST no deben repetirse sin una clave de idempotencia estable cuando exista riesgo de duplicar una operación.

## 7. Respuesta perdida e idempotencia

Una respuesta perdida no significa necesariamente que la operación haya fallado.

El servidor puede haber procesado y confirmado una solicitud antes de que la respuesta llegue al cliente.

Por esta razón, las operaciones que modifican información deben utilizar mecanismos de idempotencia cuando corresponda.

Las pruebas de la Semana 9 verificaron que:

- Una operación repetida con la misma clave y contenido no debe duplicar sus efectos.
- Una respuesta perdida después de confirmar una operación puede recuperarse mediante un reintento controlado.
- La reutilización de una misma clave con contenido diferente debe rechazarse.

Esto reduce el riesgo de duplicar registros o eventos ante fallos de comunicación.

## 8. Pruebas y verificación

Se ejecutaron cinco archivos de pruebas automatizadas de la Semana 9 mediante Jest:

| Archivo | Pruebas exitosas |
|---|---:|
| `client-retry.test.ts` | 7 |
| `retry-policy.test.ts` | 6 |
| `lost-response.test.ts` | 3 |
| `location.test.ts` | 9 |
| `location-form.test.tsx` | 2 |
| **Total** | **27** |

Todas las pruebas pasaron en sus respectivas ejecuciones individuales.

Los escenarios comprobados incluyen timeout, desconexión, HTTP 429, respuestas incompletas, caché, reint