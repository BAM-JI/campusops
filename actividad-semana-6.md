# Actividad Semana 6 — Diagnóstico de una sesión bajo concurrencia

Nombre: Abraham Cervantes Romero
Grupo: 10° Cuatrimestre - ITI

## 1. Inspección de mi proyecto

| Elemento | Archivo o ubicación real en mi proyecto | ¿Qué hace? |
|---|---|---|
| Cliente HTTP | `src/api/courseBackend.ts` | Construye peticiones fetch con baseURL, encabezados de actor y timeout controlado. |
| Access token | Almacenamiento seguro nativo (`expo-secure-store`) | Se envía en cabecera `Authorization: Bearer <token>` para validar identidad del actor. |
| Refresh token | Almacenamiento seguro nativo (`expo-secure-store`) | Clave de renovación utilizada para obtener un nuevo par de tokens ante expiración. |
| Manejo de 401 | `src/course-evaluation/index.ts` (`coordinateRefresh`) | Función de contrato para modelar eventos de autenticación y reintentos de solicitudes. |
| Cierre de sesión | `src/api/courseBackend.ts` | Invalida los tokens en reposo y restaura el estado anónimo de la aplicación. |

## 2. Mi predicción

A = Cargar detalle de incidencia (`GET /v1/incidents/campus-inc-001`)
B = Listar incidencias (`GET /v1/incidents`)
C = Consultar geocodificación (`GET /v1/geocoding?q=laboratorio`)

Cantidad de refresh que espero: 3
Explicación:
Al no existir actualmente en el cliente HTTP un candado de concurrencia (mutex) ni una promesa compartida de refresh en vuelo, cada petición que detecta un 401 de forma asíncrona dispara su propio flujo de renovación de forma independiente, saturando el endpoint de sesión.

## 3. Caso A — Refresh exitoso

Cantidad de 401: 3
Cantidad de refresh: 3
Cantidad de reintentos: 3

Resultado A: 200 SUCCESS (Reintento exitoso)
Resultado B: 200 SUCCESS (Reintento exitoso)
Resultado C: 200 SUCCESS (Reintento exitoso)

¿Mi predicción fue correcta?: Sí
Explicación:
En `src/api/courseBackend.ts`, las solicitudes operan de forma aislada; al lanzar `Promise.all` con tokens expirados, las tres funciones entraron simultáneamente a capturar el error y cada una ejecutó su propia llamada de renovación sin encolar las peticiones restantes.

## 4. Caso B — Refresh fallido

Mi predicción:
Cuando el refresh falle por token revocado, las tres peticiones deben abortar inmediatamente sus reintentos, limpiar las credenciales de sesión en el almacenamiento y arrojar un error tipado para forzar la navegación al login sin dejar promesas colgadas.

¿Se eliminó la sesión?: Sí
¿Regresó al login?: Sí
¿Hubo más de un refresh después del fallo?: No
¿Alguna petición quedó sin terminar?: No

## 5. Mi decisión técnica

Opción seleccionada: B (Mi aplicación ejecuta varios refresh)

Para resolver este problema, implementaría un patrón de **Promesa Compartida (Single-flight)** en la capa del cliente HTTP (`src/api/courseBackend.ts`). Cuando la primera petición reciba un 401, creará una variable global `refreshPromise`. Las peticiones B y C, en lugar de invocar una nueva llamada a la API, se suscribirán a esa misma `refreshPromise` existente. Una vez resuelto el token, todas las peticiones encoladas reintentarán su llamada original con el nuevo `accessToken` y la variable se reseteará a `null`.

## 6. Reflexión final

Si A y B ejecutan un refresh simultáneo y ambos obtienen tokens distintos, se produce una **condición de carrera (Race Condition)** en el almacenamiento persistente. El último en escribir sobrescribirá el token del primero; si el backend invalida el refresh token previo al emitir uno nuevo (rotación estricta de tokens), el token que quedó guardado podría quedar invalidado de inmediato, desincronizando la sesión y provocando cierres de sesión inesperados para el usuario.