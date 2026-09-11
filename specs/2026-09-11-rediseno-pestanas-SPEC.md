# Spec — Rediseño de pestañas: barra por uso, Equipo por analista, Disponibilidad por tickets

Mockups aprobados por Willy el 11/09/2026 (canvas "Recorrido del Simulador de Migración",
https://claude.ai/code/artifact/e2d2ed1e-1d79-4f49-aac4-4fe1097566f9) con dos correcciones suyas
en comentarios: Susi al 100 % de soporte desde octubre, y la tarjeta principal de Equipo es cómo
liquida cada analista mes a mes.

---

## ⚠️ Supuestos asumidos

Willy aprobó el recorrido con un "OK" en el canvas; estas tres cosas no las dijo y las asumo así
hasta que diga lo contrario:

- **La fórmula de Moni no cambia.** La curva por tickets da casi lo mismo que la perilla actual
  (`max(0,5; 0,8 − 0,02 × (cuentas en Axton − 10))`): 0,78 → 0,50 en los dos casos. Se deja la
  perilla y la pestaña muestra los tickets al lado, como validación. Cambiarla es otra decisión.
- ~~**La base de Susi son las 15 cuentas del programa**~~ **RESUELTO por Willy el 11/09:** Susi
  también soporta Toyota y TPA, que no migran. Su base pasa a 68,2 tickets por mes (56,4 del
  programa + 11,8 de Toyota y TPA) y esos 11,8 se quedan con ella para siempre: **su techo es
  83 %**, no 100 %. Implementado con `soporte_tickets.meta4_no_migra`.
- **La tabla "Tickets Meta4 en el año" se queda** al pie de Equipo como insumo.

---

## 1. Guardrails — qué puede modificar y qué no

**Puede modificar:**
- `src/components/ConfigPanel.tsx` (barra), `Insights.tsx`, `Equipo.tsx`, `Confidencial.tsx`.
- `src/insightsEquipo.ts` (sacar lo que ya no se usa, agregar la matriz por analista),
  `src/confidencial.ts` (fracciones por mes y lectura de la transición), `src/capacidad.ts`
  **solo para agregar** la fórmula de Susi y los tickets restantes por mes.
- `src/types.ts`: **agregar** claves opcionales (`config.soporte_tickets`,
  `config.capacidad.susi_soporte_meta4`). Nunca renombrar ni quitar claves existentes.
- `test/` (nuevos tests y ajuste de los que referencien lo que se saca), `CLAUDE.md` del repo.
- Migraciones: `Herramientas-Tecnicas/scripts/` (script nuevo de tickets), `DECISIONES.md`,
  `Proyecto/planmigracion-v8-*.json`.

**No puede modificar (ni "de paso"):**
- `src/planificador.ts`, `src/rules.ts`, `src/store.ts`, `src/components/Timeline.tsx`,
  `DetailPanel.tsx`, `AccountRail.tsx`, `ModalEquipo.tsx`, `src/resumen/*`: el Timeline, el
  planificador, las reglas y el video no son parte de este cambio.
- La matemática de capacidad existente (`horasFaseEnMes`, `cargaMensual`, `cargaSemanal`, la
  fórmula de Moni).
- `data/` (seed) y cualquier fixture: **ningún nombre de analista ni dato del bloque confidencial
  entra al repo**. Los nombres de analistas viven solo en el JSON local de Willy
  (`config.insumos.equipo_payroll_hoy`); el código los lee, nunca los conoce.
- El contrato del JSON: solo se agregan opcionales, al tipo y al JSON a la vez.

---

## 2. Comportamientos a preservar

- Los 570 checks de `npm test` siguen verdes, con el fixture v3 dando el resultado esperado del
  CLAUDE.md §3 (0 dependencia, 0 margen, 0 blackout, 1 informativo, 1 rojo de carga).
- `tsc --noEmit` limpio.
- Timeline por cuenta y por persona, mover cuentas, replanificar, vacaciones y traspasos:
  idénticos. Se verifica en el navegador con el v7 antes del PR.
- Import/export del JSON: un plan sin `soporte_tickets` ni `susi_soporte_meta4` se importa igual y
  la app se comporta como hoy (Susi con la perilla por año; la pestaña confidencial dice
  `[FALTA: tickets]` donde corresponda, nunca estima).
- Confidencialidad: `equipo_confidencial` sigue sin entrar al export si la sesión está bloqueada;
  `derivarResumen` sigue sin leerlo.
- Resumen ejecutivo (PDF) y video: sin cambios.

---

## 3. Scope

**Entra:**

1. **Barra** (`ConfigPanel`): una fila con tres grupos rotulados. *Vista* (zoom como desplegable,
   Por cuenta / Por persona, Hoy, Personas) **solo en la pestaña Timeline**; *Plan* (Deshacer,
   Replanificar desde el corte); *Archivo* (Importar, Exportar, Resumen PDF). "···" conserva alto
   de fila, modo de arrastre, capas, Planificar pendientes, Vaciar y Reset. Chips de estado a la
   derecha, siempre.
2. **Insights**: se saca la tarjeta "Ola de migración" (y su código muerto). Quedan la cifra,
   los cuatro KPI y "Meta 4 → Axton, trimestre a trimestre".
3. **Equipo**:
   - Se sacan "Quién hace qué en cada cuenta", "Salidas en vivo por mes" y "Equipo de payroll hoy".
   - Tarjeta principal nueva **"Cómo liquida cada analista, mes a mes"**: una fila por analista
     con cuentas en Meta 4 y en Axton al cierre de cada mes del programa, celda ámbar cuando tiene
     de los dos sistemas, columna "meses en dos sistemas". Fuente: `equipo_payroll_hoy.filas`
     cruzado con `salidas_en_vivo_propuestas` y `salidas_en_vivo_fuera_del_plan`. **Quien lleva
     la cuenta hoy es `analista_destino` si existe, si no `analista`** (Willy, 11/09: la columna
     "analista" de la Matrix quedó vieja para Piano, DLA y Carrier; Piano ya está con Melina y
     DLA y Carrier con Agustina Chacama). La cuenta no cambia de analista al migrar. Cuentas del programa sin fila en la Matrix (Aysa, Ford): fila
     `[FALTA: analista]`. Analistas 100 % Axton, en una línea al pie. Fila de totales de cartera
     con tickets por mes.
   - "Horas por persona y mes contra su capacidad": una fila por persona a todo el ancho, con
     `h · %` sobre cada barra y la lectura del pico a la izquierda. La prosa por mes sigue
     disponible al clic, como hoy.
   - "Tickets Meta4 en el año" se queda al pie.
4. **Disponibilidad del equipo** (confidencial):
   - Barras por mes con fracciones calculadas: Susi = soporte Meta 4 (1 − disponibilidad) +
     migración; Moni = soporte Axton + migración; Leo y Lucas según `dedicacion_por_mes` y "—"
     cuando ya no tienen meses. Línea punteada en `transicion_susana.desde`.
   - Tarjeta "Qué libera Meta 4 y qué carga Axton": dos paneles, tickets por mes (barras) y
     cuentas, con la disponibilidad de Susi y de Moni como línea.
   - "Transición de Susana": texto recalculado con la curva nueva.
5. **Modelo** (`capacidad.ts`):
   - `ticketsMeta4Restantes(mes, config)` y `ticketsAxton(mes, config)` a partir de
     `config.soporte_tickets` (tickets 2026 por cuenta del programa, tickets Axton de hoy,
     meses medidos, corte).
   - Susi: si `config.capacidad.susi_soporte_meta4` existe y `mes ≥ desde`,
     `disponibilidad = 1 − ticketsMeta4Restantes(mes) / base_tickets`; antes de `desde`, la
     perilla por año como hoy. Si falta el bloque, todo como hoy.
6. **Datos**: script `Herramientas-Tecnicas/scripts/tickets_soporte_desde_monday.py` (lectura de
   la Ticketera Soporte 5171238580, ítems creados en el año, columna Herramienta y Cliente) que
   escribe `config.soporte_tickets` en un JSON v8; el v8 además trae `susi_soporte_meta4`
   (`desde: 2026-10`, `base_tickets` = suma del programa) y la nota de `disponibilidad` corregida.
7. **Tests**: `test/soporte.test.ts` (tickets restantes por mes, curva de Susi con y sin bloque,
   matriz por analista con destino y con `[FALTA]`), más el ajuste de `test/equipo.test.ts` y
   `test/confidencial.test.ts` por lo que se saca o cambia.
8. **Docs**: CLAUDE.md del repo (§1 pestañas, §2 modelo), `DECISIONES.md` D87, memoria, Notion.

**Explícitamente afuera:**
- Cambiar la fórmula de Moni o su piso. Renombrar pestañas. Modo oscuro (se hereda).
- Que la app lea monday en vivo: los tickets entran por JSON, como todo.
- La duplicación del panel izquierdo (AccountRail) en modo cuenta; el planificador de cuentas
  nuevas; Toyota y TPA en el programa.
- Cualquier cambio en fechas, personas o duraciones del plan v7: el v8 solo agrega bloques.

---

## 4. Evals — cómo se comprueba que está correcto

- **Automático:** `npm test` verde (570 + los nuevos), `tsc --noEmit` limpio, CI del PR verde.
- **Con el v8 en el navegador, antes de decir "listo":**
  - Equipo: la matriz dice Agustina Ch. 5 meses en dos sistemas (nov a mar), Sergio 4,
    Agustina R. 2, Candela 1, Melina, Araceli y Florencia "—"; Aysa y Ford listadas como
    Eventuales; el total de abril dice 25 en Axton y 2 en Meta 4 (Toyota y TPA).
  - Disponibilidad: Susi 70 % en sep 26, 6 % en oct, 25 % en nov, 42 % en ene, 67 % en mar y
    **83 % desde abr 27, su techo** (Toyota y TPA no migran); Moni 78 % → 50 %; Leo y Lucas con
    barra en sep y "—" desde oct.
  - Insights sin la ola; barra con Vista solo en Timeline y sin ella en las otras pestañas.
  - Con el v7 (sin bloques nuevos): la app se ve como hoy salvo el rediseño visual, y donde
    faltan tickets dice `[FALTA]`.
- **Quién cierra:** Willy, usándolo en el deploy con su JSON. "Terminado" es cuando él lo usó.

---

## 5. Autonomía

**Decido solo:** estructura de componentes y funciones, nombres, medidas en píxeles, orden de
las filas de la matriz (por meses en dos sistemas, descendente), cómo se agrupan los tests, el
texto de los mensajes siempre que nombren cuenta, persona y mes y nunca un id.

**Consulto antes:**
- Si para que algo cierre hubiera que tocar `planificador.ts`, `rules.ts`, `store.ts` o el
  Timeline.
- Si los nombres de la Matrix no matchean con las cuentas del plan de una forma que no se
  resuelva con alias/nombre (hoy matchean todas menos Aysa y Ford, que van a `[FALTA]`).
- Si la ticketera cambia los números de forma que la curva de Susi no pise 100 % en abril.
- Cualquier cosa que implique un nombre de persona en el repo.

---

## 6. Condición de salida

**Paro cuando:** el PR está mergeado en `main`, el deploy publica, el v8 está en
`Proyecto/planmigracion-v8-*.json`, los evals de la sección 4 dieron bien en el navegador con el
v8, y D87, CLAUDE.md, memoria y Notion están actualizados.

**No hago:** refactors fuera de los archivos de la sección 1, mejoras "ya que estamos" en el
Timeline o el planificador, cambios a la fórmula de Moni, ni optimizaciones. Lo que quede
suelto fuera del scope lo reporto en el mensaje final, no lo resuelvo.

---

**Fecha de creación:** 2026-09-11
**Confirmada por el usuario:** sí, 11/09/2026 ("dale, arrancá con la spec"), con los tres supuestos de arriba
vigentes. Pedido extra en la misma confirmación: el logo de H&A como favicon (`public/favicon.png`).
