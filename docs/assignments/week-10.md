# Semana 10 — Mostrar estados claros y registrar errores sin datos sensibles

**Actividad:** Estados de interfaz y observabilidad segura. **Valor:** 8 puntos. **Equipo:** 3 integrantes.

Disponible del **3 de noviembre de 2026 a las 08:00** al **9 de noviembre de 2026 a las 23:59**, hora de Ciudad de México.

## El resultado que buscamos

Cambiar de incidencia mientras llegan respuestas atrasadas no debe mostrar información de la selección anterior. Esta semana harán que la interfaz de CampusOps represente lo que realmente está ocurriendo y ayude a recuperarse de los errores.

## Antes de empezar

Conserven la sesión, la sincronización, la ubicación manual y los reintentos seguros. Las nuevas pantallas deben representar esos comportamientos, no sustituirlos por mensajes simulados.

Usen el mismo repositorio y stack: **React Native + Expo + TypeScript**. Instalen el ZIP `week-10-estados-observabilidad.zip` siguiendo `STARTER_AND_REPOSITORY.md`. Lean el alcance en `docs/CAMPUSOPS.md` y el contrato público en `docs/CAMPUSOPS_API.md`. Mantengan las funciones y controles acumulados: avanzar de semana no permite desactivar lo anterior. Si una dificultad previa les impide continuar, repórtenla al docente con evidencia del problema para recibir apoyo.

## ¿Qué deben hacer?

### 1. Definan los estados de la interfaz

Representen carga, éxito, vacío, error y cancelación, además de desconexión, cambios pendientes y conflictos. Dibujen las transiciones y qué acción puede realizar el usuario en cada estado.

### 2. Apliquen los estados a consulta y atención

Implementen navegación coherente, mensajes y etiquetas accesibles, reintento controlado y recuperación. La app no debe mostrar una espera permanente cuando ya conoce el resultado o no tiene conexión.

### 3. Prueben respuestas fuera de orden

Conecten reduceRemoteResponses con la lógica real. Reproduzcan una respuesta antigua que llega después de cambiar la selección: no debe reemplazar la incidencia activa ni producir un estado imposible.

### 4. Registren sólo contexto seguro

Usen identificadores sintéticos de correlación para relacionar un error con su solicitud. Prueben la sanitización: no registren tokens, nombres, ubicación, fotografías o comentarios internos. Documenten qué señal permite diagnosticar sin exponer esos datos.

## Términos que usarán

- **UI:** Interfaz que ve y utiliza la persona.
- **Máquina de estados:** Modelo que define estados posibles y las transiciones permitidas entre ellos.
- **Respuesta obsoleta:** Respuesta de una solicitud anterior que ya no corresponde a la intención actual.
- **Correlación:** Identificador que permite relacionar registros de una misma operación sin identificar a una persona.
- **Telemetría:** Datos técnicos del funcionamiento, como error, intento o duración.

## ¿Qué archivos deben entregar?

Las rutas son relativas a la raíz del repositorio. Además del código y las pruebas del hito, deben quedar estos archivos:

| Archivo | Qué debe contener |
|---|---|
| `docs/ui-state-machine.mmd` | Diagrama de estados y transiciones de la interfaz en Mermaid. |
| `reports/week-10/ui-tests.json` | Pruebas de estados, navegación, accesibilidad y respuestas obsoletas. |
| `reports/week-10/log-sanitization.json` | Comprobaciones del contexto técnico registrado y de la exclusión de datos sensibles. |
| `evidence/week-10/engineering.json` | Decisión justificada, alternativas, beneficios y costos, requisito y comprobación relacionada. |
| `evidence/week-10/individual.json` | Un registro técnico por integrante; los tres se reúnen en un solo archivo. |

**Decisión que deben justificar:** Justifiquen qué estado mostrar al usuario y qué señal técnica conservar para diagnosticar el problema.

El formato de reportes, campos JSON y evidencia individual se explica en `STARTER_AND_REPOSITORY.md` y `docs/EVIDENCE_CONTRACT.md`. No basta con crear archivos vacíos o escribir que las pruebas pasaron: conserven comandos y observaciones reales.

## ¿Cómo comprueban y entregan?

Sigan el orden completo de `STARTER_AND_REPOSITORY.md`: guarden el código, completen evidencias, ejecuten `make feedback`, `make verify-week-10` y `make public-test-week-10`, y guarden el commit exclusivo de reportes/evidencias. Después creen la etiqueta **`week-10-final`** y ejecuten **`make evidence-week-10`**. Ese último comando necesita que la etiqueta ya exista.

Cuando las comprobaciones pasen, suban la versión y la etiqueta a GitHub. En Classroom entreguen **el enlace del repositorio, `week-10-final` y su SHA completo**. El SHA identifica exactamente la versión que se calificará; los cambios posteriores no forman parte de esa entrega. No basta con adjuntar capturas o guardar el proyecto sólo en su computadora.

La guía de entrega también está en el ZIP como `docs/assignments/week-10-repository.md`.

## ¿Cómo se califica?

- **AC-01 — 2.5 puntos:** instalación y verificación reproducibles desde la versión entregada.
- **AC-02 — 2 puntos:** La UI representa carga, éxito, vacío, error, cancelación y los estados de sincronización; permite recuperación accesible y no acepta respuestas obsoletas.
- **AC-03 — 1.5 puntos:** Demuestren que no aparecen estados imposibles, indicadores de carga permanentes ni datos sensibles en la telemetría.
- **AC-04 — 1.5 puntos:** decisión técnica justificada y relacionada con una prueba y su resultado.
- **AC-05 — 0.5 puntos:** aportación técnica individual verificable y explicación cuando se solicite.

**Total: 8 puntos.** Lean `RUBRIC_PUBLIC.md` para los niveles completo, parcial y sin crédito y para las condiciones que limitan la calificación. El ZIP la incluye en `docs/assignments/week-10-rubric.md`.

## Cómo se obtiene tu calificación

La actividad **no se califica por cantidad de archivos ni por número de commits**. Se suman cinco criterios independientes y el resultado máximo es **8 puntos**:

1. **AC-01 — 2.5 puntos, automático.** Se fija tu tag/SHA y se reproduce el proyecto. El nivel completo requiere instalación y checks obligatorios reproducibles; una deficiencia no crítica reproducible es parcial; sin reproducción o con el check central fallido no hay crédito.
2. **AC-02 — 2 puntos, automático.** Se ejecutan las pruebas públicas y los casos declarados. El nivel completo requiere demostrar el comportamiento completo y sus límites; el nivel parcial significa que el flujo principal funciona pero falla un caso límite. En este hito se busca: La UI representa carga, éxito, vacío, error, cancelación y los estados de sincronización; permite recuperación accesible y no acepta respuestas obsoletas.
3. **AC-03 — 1.5 puntos, automático.** Se reproduce la falla declarada y se revisa su manejo. El nivel completo requiere una corrección segura y evidencia útil; evidencia incompleta es parcial; un cierre inesperado, bucle, corrupción o exposición no obtiene crédito. Para esta semana deben demostrar: Demuestren que no aparecen estados imposibles, indicadores de carga permanentes ni datos sensibles en la telemetría.
4. **AC-04 — 1.5 puntos, semiautomático.** Se valida `engineering.json` y se contrasta con el repositorio. El nivel completo conecta requisito, alternativas, decisión, trade-off, prueba y resultado; un documento genérico o contradictorio no obtiene crédito. La decisión central es: Justifiquen qué estado mostrar al usuario y qué señal técnica conservar para diagnosticar el problema.
5. **AC-05 — 0.5 puntos, semiautomático.** Se revisa `individual.json` y la señal técnica de cada integrante. El nivel completo es una aportación verificable y explicable; una señal limitada pero coherente es parcial; la ausencia de evidencia no obtiene crédito. Los flags y la muestra rotativa sólo activan corroboración: no son un descuento automático.

Los tres primeros criterios suman **6 puntos automáticos** y los dos últimos **2 puntos semiautomáticos**. No hay puntos manuales rutinarios. Los quality gates son límites, no descuentos adicionales; si coinciden varios, se aplica una sola vez el límite más restrictivo. La rúbrica no asigna un porcentaje inventado al nivel parcial: el resultado se determina por la evidencia observada en cada criterio.

GitHub Actions ofrece retroalimentación; la calificación final se obtiene al verificar la versión entregada. No usen secretos ni datos reales, no alteren pruebas para forzar éxito y no sustituyan evidencia ejecutable con capturas. Mantengan las políticas de IA y evidencia individual explicadas en la guía de entrega.

## Antes de cerrar esta semana

- Comprueben el funcionamiento requerido y el caso de falla, no sólo el camino exitoso.
- Revisen que código, documentos y reportes describan la misma versión.
- Confirmen la aportación de los tres integrantes y el envío de etiqueta y SHA.
- Cada integrante debe responder el **quiz semanal 10** por separado: **3 preguntas, 2 puntos**, adicionales a los 8 de esta actividad. Ambos forman parte de la evaluación continua.
