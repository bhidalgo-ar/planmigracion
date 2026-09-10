# Spec — Vacaciones, reasignación con impacto y cortes de novedades reales

Previo a construir la vista por cuenta (Opción 1 del canvas de mockups). Tres definiciones
que Willy pidió cerrar antes de escribir código, con las decisiones tomadas y lo que
queda para confirmar. Fecha: 10/09/2026.

---

## A. Vacaciones

### Qué hay hoy
El JSON ya admite bloqueos: `Asignacion` con `tipo: 'Vacaciones'`, `es_bloqueo: true`,
`proyecto_id: null`. El timeline los dibuja en gris, no se arrastran, no cuentan como
carga. **Lo que falta:** (1) no hay forma de crearlos desde la app; (2) **no restan
capacidad**: `cargaMensual` calcula la capacidad como `hábiles del mes × horas_dia ×
disponibilidad` sin descontar los días de vacaciones, así que una persona de vacaciones
dos semanas aparece con la misma capacidad que si trabajara todo el mes.

### Decisión
1. **Modelo de datos: sin cambios.** Vacaciones = bloqueo con `tipo 'Vacaciones'`,
   `persona_id`, `inicio`, `fin`, `duracion_dias` (hábiles), `dedicacion_pct: 1`,
   `_nombre: 'Vacaciones'`. El JSON exportado sigue siendo compatible.
2. **Capacidad:** los días hábiles de vacaciones **se restan** de la capacidad del mes y
   de la semana de esa persona (`capacidad = (hábiles − vacaciones) × horas_dia × disp`).
   Cambio en `src/capacidad.ts` (`cargaMensual`, `cargaSemanal`), único lugar con esa
   matemática.
3. **Regla nueva `vacaciones` (rojo):** una fase de una persona que se solapa con sus
   vacaciones. Mensaje: "Moni tiene la Configuración de Piano del 21/09 al 24/09 y está de
   vacaciones del 22/09 al 30/09". Va en `src/rules.ts`, se suma a `computeViolaciones`.
4. **El planificador no las esquiva solo.** Igual que con los choques de carga: si al
   replanificar una cuenta una fase cae sobre las vacaciones de quien la hace, queda en
   rojo y se ve en la tira de meses ("Sale en vivo") como motivo. Resolverlo es decisión
   de Willy: mover la cuenta o reasignar la fase (punto B). Automatizarlo escondería el
   problema.
5. **UI:** en 👥 Equipo (`ModalEquipo`), cada persona muestra sus vacaciones cargadas con
   una fila "+ Vacaciones · desde / hasta". Se guardan como bloqueo, aparecen en el
   timeline (fila de la persona) y en la banda de carga de la Opción 1 la semana queda
   marcada como no disponible. Borrar: la × en la lista del modal.
6. **Feriados** siguen viniendo del config (2026 reales, 2027 estimados sin los turísticos).

---

## B. Quién hace qué tarea — reasignar con impacto

### Qué hay hoy
Cada barra tiene una persona (`persona_id`). Se cambia con el select "Asignado a" del
panel o arrastrando la barra en vertical. **Sin ninguna guía:** no dice si la persona
puede, si tiene lugar esas semanas, ni qué pasa con el resto del plan. Los `skills` de
`personas` en el v5 están incompletos (Gaby sin skills; Guille y Axton solo `rol`), así
que hoy no sirven como criterio.

### Decisión
1. **Nadie está bloqueado por rol.** Cualquier persona puede tomar cualquier fase; el rol
   es una **señal**, no una regla. En el select, primero las personas que tienen el rol o
   skill de esa fase, después el resto con la etiqueta "no suele hacer configuración".
2. **Cada opción del select muestra el impacto**, con el mismo mecanismo que la tira de
   meses: se simula la reasignación, se corren las reglas y se compara con la base.
   Verde "sin conflictos nuevos", ámbar "suma un aviso", rojo con el motivo ("Susi se pasa
   en enero: 95 h de 84"; "Moni está de vacaciones del 22 al 30/09"). Al elegir, el bloque
   "Qué cambió" del panel muestra la carga antes → después de las dos personas.
3. **Traspaso en bloque** (el caso "tengo que pasarle tareas a otra persona para poder
   cumplir"): en 👥 Equipo, acción "Pasar fases": persona origen → destino, tipo de fase
   (configuración / pruebas / cierre / todas) y desde qué mes. Antes de aplicar muestra
   cuántas fases mueve y los conflictos que aparecen y desaparecen; Deshacer lo revierte
   entero. No toca fechas: solo `persona_id` (las horas de la fase son las mismas; lo que
   cambia es contra qué capacidad se comparan).
4. **Roles por persona — confirmados por Willy el 10/09/2026** (van como `skills` en el
   JSON v6): Susi `configuracion`; Moni `configuracion, cierre` (sale de pruebas); Gaby F.
   `relevamiento, pruebas, cierre`; Lau `relevamiento, pruebas`; Guille `relevamiento,
   configuracion, pruebas`; Axton `configuracion`; **Mati (nuevo, gerente)**
   `relevamiento, configuracion, pruebas`, disponibilidad 0,5 constante en 2026 y 2027,
   jornada de 7 h. **Abierto:** el v5 tiene 13 barras de Pruebas asignadas a Moni
   (`*-prueba_conf`, carga de casos y recarga de acumuladores); con el rol nuevo van a
   quedar marcadas "fuera de rol" hasta que Willy decida a quién pasan — para eso está el
   traspaso en bloque del punto 3.
5. **Lo que no se hace:** un optimizador que reparta solo. El plan usa dedicaciones fijas
   por rol (60 % Willy en configuración, etc.) que son decisiones, no variables.

---

## C. Cortes de novedades reales, 09/2026 a 06/2027

### Qué hay hoy
`config.cortes_novedades_dia` = un día fijo por cuenta (Piano 20, Copetro 24…), tomado
de agosto 2026. El planificador y la regla de margen lo aplican a todos los meses,
corrido al hábil anterior. No distingue rondas ni quincenas.

### Qué dice monday
Se leyeron los 13 tableros "Cronograma de Liquidación" (workspace Clientes), ítems
"Recepción de Novedades", enero a septiembre 2026. Hallazgos:

- **Mensuales con una sola ronda:** Piano, TIM (tablero "TMHM"), Campari, Marval,
  Lowsedo, Carrier, GSMA, Bonafide ("Envío de novedades"), Aysa. El día es estable
  (±2 días).
- **Copetro: tres cortes por mes** — 1Q (~16–18), mensual (~19–24) y 2Q (~1–4 del mes
  siguiente).
- **Ford también es quincenal** — 1Q (~11–15), mensual (~20–27), 2Q (~30/1–3). **Esto
  contradice la premisa de que solo Copetro es quincenal**; el tablero lo trae todos los
  meses de 2026 con la columna Tipo en "Primera/Segunda Quincena".
- **Sportline: tres rondas** (1: ~7–15, 2: ~9–18, 3: ~18–22) más anticipos e incidencias.
- **DLA (tablero "Mixplay"): dos versiones**, v1 (~9–14) y v2 (~18–21).

### Decisión
1. **El ancla del mes de salida es la primera ronda del período** (1Q, v1, ronda 1):
   si la cuenta sale en vivo en octubre, todo lo de octubre se liquida en Axton, y lo
   primero que llega es esa ronda. Es el criterio que el plan ya aplicaba a DLA (día 11 =
   v1). Aplicado a todos, **tres cuentas quedan más ajustadas que hoy**: Copetro 24 → ~16,
   Ford 24 → ~14, Sportline 18 → ~13. Lowsedo 24 → ~20. GSMA 13 → ~16 se afloja.
   **Confirmado por Willy el 10/09/2026:** Copetro y Ford son quincenales y la 1Q se
   liquida en Axton. Sportline **no** es quincenal: tiene tres rondas de novedades de la
   misma liquidación mensual; se ancla a la ronda 1 (~13) porque es la primera carga del
   mes, mismo criterio que la v1 de DLA. La alternativa (anclar a la última ronda) equivale
   a liquidar la primera parte del mes en Meta4 y el resto en Axton.
2. **Fechas concretas por mes, no un día fijo.** Nueva clave opcional del config
   `cortes_novedades_fechas: { cuenta: { 'YYYY-MM': 'YYYY-MM-DD' } }` con el ancla de
   cada período de 09/2026 a 06/2027. Donde monday ya tiene el ítem (septiembre, y
   octubre en algunas) se usa la fecha real; el resto es estimado con la mediana del día
   de 2026 corrida al hábil anterior. `cortes_novedades_detalle` guarda todas las rondas
   por si se quiere ver.
3. **`fechaCorteDe` prefiere la fecha del mes** si existe y cae al día fijo si no. Así
   los JSON viejos siguen funcionando y el planificador, la regla de margen y el panel
   usan la misma fuente. El panel muestra el origen: "corte 16/10 · 1Q · estimado".
4. **Refresco:** `Herramientas-Tecnicas/scripts/cortes_novedades_desde_monday.py` toma
   la salida GraphQL de los tableros y regenera el JSON. Se corre cuando cambie un
   cronograma o para extender el horizonte.
5. El JSON con las fechas está en
   `project plan migraciones/Proyecto/cortes-novedades-2026-09-a-2027-06.json`. Se
   incorpora al v5 de Willy al implementar.

---

## Orden de construcción propuesto

1. **Cortes por fecha** (C): config + `fechaCorteDe` + panel. Es lo que más mueve las
   fechas del plan y conviene tenerlo antes de dibujar la vista nueva.
2. **Vacaciones** (A): capacidad + regla + alta en Equipo.
3. **Reasignación con impacto** (B): select con simulación, "Qué cambió", traspaso en
   bloque.
4. **Vista por cuenta con banda de carga** (Opción 1 del canvas), ya con vacaciones y
   cortes reales adentro.

Cada tramo con sus tests y su PR, como hasta ahora.

## Confirmaciones de Willy (10/09/2026)

- Ancla en la primera ronda: sí. Copetro y Ford quincenales, la 1Q se liquida en Axton.
  Sportline no es quincenal (rondas de una misma mensual); ancla en la ronda 1.
- Roles: los de B.4. Mati entra como persona nueva al 50 %.
- Queda abierto a quién pasan las 13 pruebas de Moni.
