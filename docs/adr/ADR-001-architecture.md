# ADR-001: Separación de responsabilidades mediante Arquitectura Limpia y Puertos/Adaptadores

## Estado
Aceptado

## Contexto
CampusOps requiere gestionar flujos de incidencias universitarias en React Native y Expo con TypeScript, cubriendo tres perfiles (reportante, técnico, coordinador), sincronización sin conexión y sustitución de proveedores. Requerimos aislar la interfaz gráfica (UI) de las implementaciones concretas de red y almacenamiento para permitir pruebas deterministas sin dependencias externas.

## Alternativas consideradas

### Alternativa A: Arquitectura MVC / Smart Components (Rechazada)
Consiste en colocar la lógica de negocio y llamadas directas de red/almacenamiento en componentes o Custom Hooks.
* **Ventajas:** Menos archivos iniciales, curva de desarrollo rápida en prototipos.
* **Desventajas:** Fuerte acoplamiento entre UI e infraestructura; alta dificultad para ejecutar pruebas unitarias puras sin mocks complejos de Expo/HTTP; cambiar un proveedor de red o base de datos obliga a modificar componentes visuales.

### Alternativa B: Arquitectura Limpia / Puertos y Adaptadores (Elegida)
Consiste en dividir el sistema en 4 capas estrictas con dependencias dirigidas hacia el centro:
1. **UI:** Presentación pura, componentes React Native y consumo de casos de uso.
2. **Application:** Casos de uso (`GetIncidentsList`, `GetIncidentDetail`) que orquestan reglas sin conocer detalles de transporte.
3. **Domain:** Entidades (`Incident`), value objects y contratos/puertos (`IIncidentRepository`).
4. **Infrastructure:** Adaptadores concretos (Fake en memoria, HTTP Client, almacenamiento seguro) que implementan las interfaces del dominio.

## Decisión
Se adopta la **Alternativa B**. La capa de UI jamás importará ni dependerá de Infrastructure. La comunicación con fuentes externas se realiza mediante inversión de dependencias a través de las interfaces de Domain.

## Consecuencias y Trade-offs
* **Facilidad de prueba (Testabilidad):** Máxima. Permite evaluar las reglas de negocio y los casos de uso usando repositorios falsos en memoria en milisegundos y sin mocks globales.
* **Complejidad:** Se incrementa el número de archivos iniciales e interfaces requeridas para conectar una pantalla con los datos.
* **Costo de cambio de proveedor:** Mínimo. Sustituir un almacenamiento en memoria por SQLite o la API REST sólo requiere crear un nuevo adaptador que satisfaga `IIncidentRepository`, sin tocar UI ni Application.