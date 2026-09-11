# ADR-002: Persistencia local y cola de operaciones offline

## Estado
Aceptado

## Contexto
Los técnicos deben reportar diagnósticos y transicionar estados en áreas de campus sin cobertura. Las operaciones offline deben persistir localmente y sobrevivir al reinicio de la aplicación.

## Alternativas consideradas
1. **Alternativa A:** Almacenar el estado completo en memoria volátil.
2. **Alternativa B:** Cola FIFO de mutaciones persistida localmente con clave de idempotencia estable.

## Decisión
Se elige la **Alternativa B**. Las mutaciones generadas sin conexión se encolan con una `Idempotency-Key` única, versión base y metadatos de autor, garantizando persistencia y entrega garantizada tras recuperar conexión.

## Consecuencias y Trade-offs
* **Ventajas:** Resiliencia ante desconexiones y caídas del sistema; cumplimiento del contrato de idempotencia del backend didáctico.
* **Costo:** Requiere orquestar un worker de sincronización y gestionar estados de la cola (pendiente, sincronizado, fallido).