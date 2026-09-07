# LEAN ESTE ARCHIVO PRIMERO — Semana 1: CampusOps

Este documento contiene el orden completo de la actividad. **Léanlo de principio a fin antes de modificar archivos o ejecutar comandos.** No necesitan buscar otra guía.

**Valor:** 8 puntos  
**Equipo:** exactamente 3 integrantes  
**Entrega:** 7 de septiembre de 2026, 23:59, hora de Ciudad de México

## Qué van a lograr esta semana

El equipo dejará un proyecto que otra persona pueda descargar, instalar y comprobar. Además:

1. definirá con precisión el problema que atenderá CampusOps;
2. identificará y priorizará tres riesgos;
3. provocará una falla controlada en el proyecto;
4. distinguirá el síntoma de la causa;
5. corregirá la falla y demostrará la corrección;
6. registrará una decisión de ingeniería y la aportación de cada integrante.

Esta semana **no** deben construir la aplicación completa, el inicio de sesión ni todas las pantallas. Tampoco deben modificar las pruebas para hacer que un resultado aparezca en verde.

## Qué significa cada archivo que deben completar

| Archivo | Pregunta que responde |
|---|---|
| `docs/problem-definition.md` | ¿Qué problema resolverá el equipo, para quién y con qué límites? |
| `docs/risk-register.md` | ¿Qué puede salir mal, qué riesgo importa más y cómo se reducirá? |
| `reports/week-01/baseline.json` | ¿Qué comando falló, qué observaron, cuál fue la causa y cómo demostraron la corrección? |
| `evidence/week-01/engineering.json` | ¿Qué decisión tomó el equipo, qué alternativas comparó y con qué evidencia la respalda? |
| `evidence/week-01/individual.json` | ¿Qué aportó técnicamente cada integrante y cómo se puede comprobar? |

Las plantillas ya existen. **No cambien sus nombres, rutas ni nombres de campo.** Deben reemplazar todos los textos que comienzan con `REEMPLAZAR`.

---

## Paso 1. Descomprimir y revisar el paquete

1. Descompriman `CampusOps-Semana-01-CORREGIDO.zip`.
2. Entren a la carpeta `CampusOps-Semana-01`.
3. Comprueben que allí están `package.json`, `Makefile`, `LEEME_PRIMERO.md`, `RUBRICA.md` y las carpetas `docs`, `reports` y `evidence`.
4. Lean `docs/CAMPUSOPS.md` para conocer el caso. No comiencen a redactar sin haberlo leído.
5. Lean `RUBRICA.md` para saber qué evidencia se calificará.

Si ya comenzaron con un paquete anterior, no borren su trabajo. Usen este paquete como referencia y copien solamente los archivos que les falten.

## Paso 2. Instalar y comprobar el proyecto original

Necesitan Node.js 22.22.0, npm, Git, GNU Make y Python 3. Si usan nvm:

```bash
nvm use
```

Desde la carpeta donde está `package.json`, ejecuten:

```bash
make setup
make feedback
```

Antes de continuar, `make feedback` debe terminar correctamente. En este momento todavía no han provocado la falla de la actividad. Si el proyecto original falla, guarden el mensaje y resuelvan primero el problema de instalación; no lo presenten como la falla controlada del equipo.

## Paso 3. Crear el repositorio del equipo

1. Un integrante crea en GitHub un repositorio público vacío.
2. Agrega como colaboradores a los otros dos integrantes.
3. Cada persona configura y usa su propia identidad Git. No compartan una cuenta.
4. Desde la carpeta del proyecto ejecuten:

```bash
git init
git branch -M main
git add .
git commit -m "chore: iniciar CampusOps"
git remote add origin URL_DEL_REPOSITORIO
git push -u origin main
```

Reemplacen `URL_DEL_REPOSITORIO` por la URL real. No suban `node_modules`, archivos `.env`, tokens, contraseñas, credenciales ni datos personales.

## Paso 4. Acordar el trabajo de los tres integrantes

Antes de editar, repartan responsabilidades. Los tres deben producir una aportación verificable; no basta con que una persona haga todo y las demás sólo aparezcan en el archivo.

El trabajo puede repartirse entre tareas como:

- preparación y comprobación del entorno;
- definición del problema y criterios de aceptación;
- análisis y priorización de riesgos;
- diseño, ejecución y diagnóstico de la falla controlada;
- corrección de la falla;
- revisión técnica y repetición independiente de una prueba.

Cada integrante debe crear al menos un commit propio y poder explicar qué cambió, qué esperaba observar, qué comando o revisión utilizó y qué ocurrió. Un cambio únicamente cosmético o muchos commits vacíos no demuestran una aportación técnica.

## Paso 5. Completar la definición del problema

Abran `docs/problem-definition.md` y sustituyan cada indicación entre corchetes.

El archivo debe contener:

1. **Problema:** situación concreta que se desea atender en el campus ficticio.
2. **Alcance incluido:** lo que sí será responsabilidad de CampusOps.
3. **Fuera de alcance:** lo que el equipo decide no resolver en esta versión.
4. **Actores:** responsabilidad del reportante, técnico y coordinador.
5. **Flujo:** qué sucede al reportar, asignar, atender y cerrar una incidencia.
6. **Criterios de aceptación:** al menos tres condiciones observables que permitan decidir si el comportamiento es correcto.

Una frase como “la aplicación debe funcionar bien” no es verificable. El equipo debe escribir condiciones que otra persona pueda observar o probar, sin implementar todavía toda la aplicación.

## Paso 6. Completar el registro de riesgos

Abran `docs/risk-register.md` y sustituyan cada indicación entre corchetes.

Registren exactamente tres riesgos. Para cada uno expliquen:

1. qué evento podría ocurrir;
2. por qué sería un problema para CampusOps;
3. su probabilidad y la razón de esa estimación;
4. su impacto y la razón de esa estimación;
5. una acción para reducirlo;
6. qué evidencia mostraría que la acción funcionó.

Ordénenlos del más al menos prioritario y justifiquen cuál atenderían primero. No basta con escribir “alto”, “medio” o “bajo” sin explicar por qué.

## Paso 7. Diseñar la falla controlada antes de provocarla

El equipo debe elegir una falla **reversible, segura y relacionada con código o configuración**. No debe usar datos reales, servicios reales ni producir daño fuera del proyecto.

Antes de hacer el cambio, anoten en sus apuntes:

1. qué archivo van a modificar;
2. qué cambio temporal harán;
3. qué comando usarán para detectar la falla;
4. qué resultado esperan observar;
5. cómo regresarán el proyecto a un estado correcto.

Pueden elegir una falla de tipo, comportamiento o configuración que pueda detectar una prueba o verificación existente. **El equipo debe decidir la falla concreta.** No editen, borren, ignoren ni desactiven los archivos de prueba.

## Paso 8. Ejecutar, diagnosticar y corregir la falla

1. Realicen el cambio temporal que planearon.
2. Ejecuten el comando elegido. Para la prueba básica pueden utilizar:

```bash
npm run test:smoke
```

3. Lean la salida completa y localicen el mensaje que demuestra el fallo.
4. Distingan:
   - **síntoma:** lo que observaron en la ejecución;
   - **causa:** la condición en el código o configuración que produjo ese síntoma.
5. Corrijan la causa sin modificar las pruebas.
6. Ejecuten nuevamente el mismo comando.
7. Comprueben que ahora pasa y que el proyecto quedó corregido.

No basta con afirmar “falló” y “ya funciona”. Deben conservar el comando y describir resultados que otra persona pueda volver a observar.

## Paso 9. Guardar el trabajo técnico antes de llenar los JSON

Revisen que los documentos estén completos y que la falla haya quedado corregida. Después, cada integrante debe guardar sus aportaciones con su propia identidad Git.

Cuando el código, configuración y documentos estén terminados, ejecuten:

```bash
git add .
git commit -m "feat: completar diagnostico de semana 1"
git push origin main
git rev-parse HEAD
```

El último comando muestra un código de 40 caracteres. En esta guía lo llamaremos **SHA del trabajo técnico**. Cópienlo sin recortarlo: se usará en `baseline.json` y `engineering.json`.

No modifiquen código, configuración ni documentos después de fijar este SHA. Si necesitan corregirlos, hagan otro commit y obtengan un SHA nuevo antes de continuar.

---

## Paso 10. Llenar `baseline.json` campo por campo

Abran `reports/week-01/baseline.json`. Este archivo es un índice de observaciones reales; no es una narración inventada ni una captura de pantalla.

### Campos generales

| Campo | Qué deben escribir |
|---|---|
| `_instructions` | Pueden eliminar este campo cuando terminen; no forma parte de su evidencia. |
| `schemaVersion` | Déjenlo en `1`. |
| `week` | Déjenlo en `1`. |
| `commitSha` | Peguen el SHA completo obtenido con `git rev-parse HEAD` en el paso 9. |
| `generatedAt` | Fecha y hora en formato ISO 8601: `AAAA-MM-DDTHH:MM:SS-06:00`. Debe corresponder al momento en que completaron el reporte. |
| `checks` | Lista de las observaciones de la falla y de su corrección. |

### Primera observación: la ejecución que falló

| Campo | Qué significa |
|---|---|
| `id` | Nombre breve que ustedes asignan al caso. Debe permitir reconocerlo. |
| `status` | Usen `fail` porque esta observación corresponde a la falla reproducida. |
| `scenarioType` | Usen `failure` porque provocaron una condición de fallo. |
| `command` | Comando exacto que realmente ejecutaron, sin resumirlo. |
| `evidence` | Describan el mensaje o comportamiento observado y la causa identificada. No escriban sólo “dio error”. |

### Segunda observación: la ejecución después de corregir

| Campo | Qué significa |
|---|---|
| `id` | Nombre breve para la comprobación corregida. |
| `status` | Usen `pass` porque esta observación corresponde a la ejecución exitosa. |
| `scenarioType` | Usen `nominal` porque verifican el funcionamiento normal después de corregir. |
| `command` | Repitan el comando exacto utilizado para demostrar la corrección. |
| `evidence` | Describan el resultado observable que demuestra que la prueba pasó y que la causa fue corregida. |

Antes de cerrar el archivo, comprueben que existe al menos una observación `fail` y una `pass`, que no quedan textos `REEMPLAZAR` y que el JSON conserva comas, llaves y comillas válidas.

## Paso 11. Llenar `engineering.json` campo por campo

Abran `evidence/week-01/engineering.json`. Este archivo registra **una decisión real tomada por el equipo**. No busca una respuesta única: se evalúa la calidad del razonamiento y su conexión con evidencia.

La decisión puede relacionar el alcance, el riesgo prioritario o un criterio de aceptación. Debe ser coherente con `problem-definition.md`, `risk-register.md` y el trabajo del repositorio.

| Campo | Qué deben escribir |
|---|---|
| `_instructions` | Pueden eliminarlo al terminar. |
| `schemaVersion` | Déjenlo en `1`. |
| `week` | Déjenlo en `1`. |
| `commitSha` | Peguen el mismo SHA completo del trabajo técnico usado en `baseline.json`. |
| `decision` | Conclusión concreta del equipo: qué eligieron, bajo qué restricción y por qué. Eviten “elegimos esto porque es mejor”. |
| `alternatives` | Al menos dos opciones distintas que realmente consideraron. Describan cada una con suficiente precisión para compararla. |
| `tradeoff` | Expliquen qué beneficio obtienen con la decisión y qué costo, limitación o riesgo aceptan. Toda decisión tiene una renuncia. |
| `requirementIds` | Indiquen los criterios de la rúbrica relacionados con la decisión. Para esta evidencia normalmente se conservan `AC-02` y `AC-04`; no inventen otros identificadores. |
| `verification` | Lista de una o más comprobaciones reales que conectan la decisión con un resultado observable. |

Cada elemento de `verification` contiene:

| Campo | Qué deben escribir |
|---|---|
| `command` | Comando exacto ejecutado para comprobar algo relacionado con la decisión. |
| `result` | Resultado obtenido, no el resultado que esperaban obtener. |
| `evidence` | Archivo, salida o reporte donde otra persona puede verificar ese resultado. |

Una evidencia insuficiente sería una opinión sin alternativas, sin costo o sin comprobación. El archivo debe permitir seguir esta cadena:

```text
necesidad o riesgo → alternativas → decisión → beneficio y costo → comprobación → resultado
```

No copien una decisión de otro equipo. Su contenido debe corresponder a los documentos y resultados de su propio repositorio.

## Paso 12. Llenar `individual.json` campo por campo

Abran `evidence/week-01/individual.json`. Debe contener exactamente tres registros dentro de `members`, uno por integrante.

### Campos del equipo

| Campo | Qué deben escribir |
|---|---|
| `_instructions` | Pueden eliminarlo al terminar. |
| `schemaVersion` | Déjenlo en `1`. |
| `week` | Déjenlo en `1`. |
| `teamId` | Identificador real del equipo indicado por el docente. Los tres integrantes usan el mismo. |
| `members` | Conserven exactamente tres objetos, uno por estudiante. |

### Campos de cada integrante

| Campo | Qué debe registrar cada persona |
|---|---|
| `studentId` | Su identificador escolar real indicado por el docente. |
| `commitShas` | Uno o más SHA completos de commits creados por esa persona. No usen el SHA de otra persona. |
| `files` | Rutas exactas de los archivos en los que realizó una aportación significativa. |
| `tests` | Pruebas o comandos que ejecutó personalmente. Si no ejecutó una prueba, puede dejar `[]`, pero entonces `reviews` no puede estar vacío. |
| `reviews` | Revisión técnica realizada sobre el trabajo de otra persona. Si no hizo una revisión, puede dejar `[]`, pero entonces `tests` no puede estar vacío. |
| `prediction` | Antes de ejecutar o revisar, qué esperaba observar y por qué. |
| `command` | Comando exacto que ejecutó para comprobar su aportación. |
| `observedResult` | Lo que realmente ocurrió al ejecutar el comando. |
| `explanation` | Por qué ocurrió ese resultado y cómo se relaciona con su aportación. |

Para obtener el SHA completo de un commit propio pueden localizarlo en el historial y ejecutar:

```bash
git log --oneline --author="NOMBRE_O_CORREO_DEL_INTEGRANTE"
git rev-parse SHA_CORTO_ENCONTRADO
```

Cada integrante debe poder completar esta relación con evidencia real:

```text
mi cambio → archivo y commit → lo que esperaba → comando o revisión → resultado observado → explicación
```

No utilicen el número de commits como argumento de calidad. No registren a una persona como autora de trabajo que no realizó. Una revisión técnica debe explicar qué se revisó y qué conclusión produjo; escribir solamente “revisé” no es suficiente.

## Paso 13. Validar las plantillas y ejecutar las comprobaciones

Busquen primero cualquier texto pendiente:

```bash
grep -R "REEMPLAZAR" reports/week-01 evidence/week-01
```

El comando no debe mostrar resultados. Después ejecuten:

```bash
make feedback
make verify-week-01
make public-test-week-01
```

Revisen el campo `status` de las salidas. Debe decir `pass`. Si aparece `fail`, lean cuál `check` falló, corrijan el archivo o evidencia correspondiente y ejecuten nuevamente el comando.

Estos comandos revisan estructura y evidencia reproducible; no redactan los archivos por ustedes.

## Paso 14. Crear el commit exclusivo de evidencias

Después de que todo pase:

```bash
git add reports/ evidence/
git commit -m "docs: registrar evidencia de semana 1"
git status --short
```

`git status --short` no debe mostrar cambios pendientes de la entrega. Este último commit sólo debe contener archivos de `reports/` y `evidence/`. Por eso `commitSha` puede seguir apuntando al commit inmediatamente anterior, que contiene el trabajo técnico comprobado.

Si después modifican código, configuración o documentos, esta relación deja de ser válida: deberán generar evidencia nueva desde un SHA nuevo.

## Paso 15. Crear y comprobar la etiqueta final

Ejecuten:

```bash
git tag -a week-01-final -m "DMI week 01 final"
make evidence-week-01
```

`make evidence-week-01` debe ejecutarse después de crear la etiqueta. El comando genera `reports/week-01/failure.json`. El nombre pertenece al contrato del evaluador y no significa automáticamente que hayan fallado: abran el archivo y comprueben que su campo `status` diga `pass`.

No creen otro commit para agregar `failure.json` después de fijar la etiqueta.

## Paso 16. Subir y comprobar la entrega

```bash
git push origin main
git push origin week-01-final
git rev-list -n 1 week-01-final
```

Comprueben en GitHub que existen la rama, los archivos y la etiqueta. El último comando muestra el SHA final de la entrega.

## Paso 17. Entregar en Classroom

En Classroom escriban únicamente:

```text
Repositorio: https://github.com/ORGANIZACION_O_USUARIO/REPOSITORIO
Etiqueta: week-01-final
SHA: PEGAR_AQUI_EL_SHA_COMPLETO_DE_LA_ETIQUETA
```

No entreguen el ZIP de regreso. Las capturas pueden complementar una explicación, pero no sustituyen el repositorio, los JSON, los comandos ni los reportes.

## Lista final antes de presionar “Entregar”

- Leímos completo `LEEME_PRIMERO.md` y `RUBRICA.md`.
- El proyecto original funcionó antes de provocar la falla.
- `problem-definition.md` y `risk-register.md` están completos y son específicos de CampusOps.
- Provocamos una falla segura, identificamos síntoma y causa, la corregimos y no modificamos pruebas.
- `baseline.json` contiene evidencia `fail` y `pass`.
- `engineering.json` conecta alternativas, decisión, trade-off y verificación.
- `individual.json` contiene exactamente tres aportaciones verificables.
- No queda ningún texto `REEMPLAZAR`.
- Los cuatro comandos de comprobación terminan con `status: pass`.
- La etiqueta `week-01-final` existe en GitHub.
- Classroom contiene la URL, la etiqueta y el SHA completo.

