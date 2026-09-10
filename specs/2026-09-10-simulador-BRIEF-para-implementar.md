# Brief de implementación: Simulador de Migración → tablero del programa

> Copia en el repo (10/09/2026). El original vive en la carpeta de migraciones de Willy. La
> contraseña de la pestaña confidencial está redactada acá a propósito: el repo es público.

Para arrancar un chat nuevo de Claude Code **dentro del repo de la app**. Este documento es
autosuficiente: trae las decisiones cerradas, el modelo de capacidad, los cambios al JSON,
los tramos de trabajo con archivos y tests, y los datos que hay que cargar. El documento de
ideas que Willy aprobó el 10/09/2026 es
`Proyecto/specs/2026-09-10-simulador-tablero-de-migracion.md` (mismo directorio); acá está
lo que hace falta para construirlo, no el porqué.

Fecha: 10/09/2026. Aprobado por Willy en la conversación de ese día.

---

## 0. Cómo arrancar el chat nuevo

**Repo:** `https://github.com/bhidalgo-ar/planmigracion` (público). Deploy automático a
`https://bhidalgo-ar.github.io/planmigracion/` en cada push a `main`
(`.github/workflows/deploy.yml`: `npm ci`, `tsc && vite build`, Pages).

**Dónde trabajar:** hay una copia de la versión real (commit `66d1ce3`, HEAD de `main` al
10/09) en `C:\Users\GuillermoEsposito\OneDrive - GRUPO HIDALGO Y ASOCIADOS S A\H&A\07_Proyectos\Implementaciones\plan-simulador-live`.
Es un *worktree* (una segunda carpeta de trabajo del mismo repositorio git) en estado
*detached* (sin rama). Antes de tocar nada: `git checkout -b feat/tablero-programa`. El
remote que apunta al repo de la org se llama `bh` en el repo padre (`plan-simulador`); en el
worktree conviene verificar con `git remote -v` y usar `bh` para push. **No usar la carpeta
`plan-simulador`**: está en un commit del 30/06 y apunta al repo personal viejo.

**Entorno:** React 18 + Vite 5 + TypeScript 5 + Zustand 4 + date-fns 3. Node 20. Dev server
en 5173. Por el `&` de la ruta de OneDrive, npm se lanza así:
`node node_modules/vite/bin/vite.js` (ya está en `.claude/launch.json`). Tests:
`npm run test:duraciones` y `npm run test:migracion` (esbuild + node, sin framework). `gh`
está fuera del PATH en esta máquina (ver skill `hya-codigo`).

**Reglas del proyecto que hay que respetar:**
- `CLAUDE.md` del repo **está desactualizado** (describe cinco fases, gate de UAT, Regla 1;
  nada de eso existe). Ignorarlo hasta que el tramo D lo reescriba. La única spec fiel es
  `specs/disponibilidad-por-persona-y-ano.md`.
- Privacidad: en la app solo alias (`moni`, `leo`, `susi`, `lau`, `gaby_f`, `guille`,
  `axton`, `lucas`). Nunca nombres completos, CUIL, sueldos, legajos.
- Cero invención de datos. Lo que falta va como `[FALTA: ...]` visible.
- El JSON exportado es contrato: las claves existentes de `Asignacion`, `Persona`,
  `Proyecto` y `Config` **no se renombran ni se quitan**; solo se agregan opcionales.
- Cierre: verificar en el navegador importando el JSON v3 antes de dar algo por hecho; PR a
  `main` y merge (skill `hya-codigo`).

**JSON del plan:** `Proyecto/planmigracion-v3-propuesta.json` en la carpeta de migraciones
(`...\Usuario\Escritorio\Nueva carpeta\project plan migraciones\Proyecto\`). Es la opción C
aprobada. Tiene un error de datos a corregir primero (§4, D3).

---

## 1. Decisiones cerradas (no volver a discutir)

1. **Jornada disponible real: 7 h por día por persona** (no 8). Es lo que se usa para
   convertir dedicación en horas y para la capacidad.
2. **`dedicacion_pct` = fracción de la jornada de 7 h.** Una fase al 0,6 son 4,2 h por día
   hábil.
3. **Gaby: 4 h por día.** Su capacidad es fija, no una fracción de 7 (4 h = 0,571 de
   jornada). Se modela con `horas_dia: 4` en su persona.
4. **Moni: 80 % en septiembre 2026, bajando con cada cuenta que entra a Axton.** Su soporte
   Axton crece con la cartera. No hay que medir tickets para arrancar: se estima por cantidad
   de cuentas en Axton (fórmula en §2). La perilla queda editable para calibrar después con
   la ticketera (board 5171238580, Herramienta = Axton).
5. **Susana en 2027 toma todas las tareas de Meta4 que hoy hacen Leo y Lucas**, y con eso
   queda con tiempo para configuración. Se muestra en la pestaña confidencial (§3.3). Cuánto
   y desde cuándo: **[FALTA: Willy — mes de arranque y horas/semana de soporte Meta4 que
   hoy llevan Leo y Lucas]**. Mientras no esté, la pestaña lo muestra como supuesto rotulado.
6. **Control de carga: mensual como regla dura (rojo), semanal solo como aviso (ámbar).**
7. **"Equipo" es una pestaña nueva; "Insights" queda.** Insights responde a gerencia ("cuándo
   terminamos"); Equipo responde "qué le pasa al equipo de payroll". Mucha información para
   una sola pestaña.
8. **Pestaña "Disponibilidad del equipo" confidencial**, apagada por default, se activa con
   contraseña y **nunca queda visible** entre sesiones. Contraseña definida por Willy:
   `[REDACTADA en la copia del repo: la define Willy, en el código va solo su hash SHA-256]`. Ver §3.3 por qué la contraseña es cortina y no llave, y qué se hace con eso.
9. **Se suman dos insumos para justificar decisiones:** la tabla de tickets Meta4 YTD (la que
   está en Notion) y la distribución actual del equipo de payroll por cliente (Matrix
   Complejidad Clientes, monday board 6552205482).
10. **Fuera de alcance:** TASA/Toyota, TPA, escenarios A/B, redo, conexión con monday desde la
    app, regla de piso de soporte hasta que exista el número.
11. **La pantalla objetivo es la notebook de Willy** (13", ~1366 a 1536 px de ancho). Diseñar
    para 1280 px sin scroll horizontal; los gráficos tienen que leerse proyectados.

---

## 2. Modelo de capacidad (la matemática, para que quede una sola)

Todo en horas. Días hábiles = lunes a viernes menos feriados del JSON (`feriadosDeConfig`).

**Horas de una fase en un mes** = días hábiles de la fase que caen en ese mes × `horas_dia`
de la persona × `dedicacion_pct`.

**Capacidad de una persona en un mes** = días hábiles del mes × `horas_dia` × disponibilidad
de esa persona para migración en ese mes.

**`horas_dia`:** nuevo campo opcional en `Persona`. Default 7. Gaby 4.

**Disponibilidad por mes** (reemplaza a la disponibilidad por año como fuente principal;
la por año queda como fallback para no romper el JSON):
- Willy (`guille`): 0,6 constante (perilla).
- Gaby (`gaby_f`): 1,0 sobre sus 4 h (la reducción ya está en `horas_dia`).
- Moni (`moni`): `max(0,50; 0,80 − 0,02 × (cuentas_en_axton(mes) − 10))`.
  `cuentas_en_axton(mes)` = 9 legacy + Coty + las que salieron en vivo hasta ese mes
  inclusive (de `salidas_en_vivo_propuestas` y `salidas_en_vivo_fuera_del_plan`). Con la
  opción C da 0,80 en sep-26, 0,76 en oct, 0,72 en nov, 0,68 en dic, 0,64 en ene, 0,60 en
  feb, 0,54 en mar, 0,52 en abr. Los dos coeficientes (0,02 por cuenta, piso 0,50) son
  perillas en `config`.
- Susi, Leo, Lau, Axton, Lucas: lo que diga el bloque confidencial; si no está, la
  disponibilidad por año actual.

**Regla de carga mensual (rojo):** horas de la persona en el mes > capacidad del mes.
**Aviso semanal (ámbar):** horas en una semana > capacidad de esa semana × 1,15 (tolerancia
para que una semana cargada no pinte todo). Sin la precondición de "distintas cuentas": el
solapamiento es el modelo, se controla el total.

**Chequeo de referencia**, para validar la implementación contra el mockup 2 (bloque 6):
con 8 h y las dedicaciones del v3 el mockup daba Willy 425 h, Moni 276, Gaby 371. Con 7 h
los totales bajan proporcionalmente (× 0,875) y Gaby cambia más por sus 4 h. Si la app no da
algo cercano, el cálculo está mal. Enero 2027 de Willy tiene que seguir apareciendo como el
mes más cargado.

---

## 3. Cambios al JSON (todos aditivos)

### 3.1 `personas[]`
- `horas_dia?: number` (default 7; Gaby 4).
- Nueva persona `lucas` (alias "Lucas", `skills: ["soporte","meta4"]`, sin asignaciones).
  Hace falta para la pestaña de disponibilidad.

### 3.2 `config`
Ya existen y hay que **empezar a leer**: `salidas_en_vivo_propuestas`,
`cortes_novedades_dia`, `salidas_en_vivo_fuera_del_plan`, `tiers_v3` (`chica`/`std`/`grande`,
`duraciones_dias`, `blackout_config`), `reglas_calendario`.

Nuevas:
```json
"capacidad": {
  "horas_dia_default": 7,
  "margen_minimo_habiles": 5,
  "aviso_semanal_tolerancia": 1.15,
  "moni_soporte_axton": { "base": 0.80, "cuentas_base": 10, "caida_por_cuenta": 0.02, "piso": 0.50 }
},
"insumos": {
  "tickets_meta4_ytd": {
    "fuente": "Ticketera Soporte, board 5171238580, Herramienta = Meta 4, YTD 2026",
    "corte": "2026-09-08",
    "filas": [
      { "cliente": "Marval",   "tickets": 72, "pct_criticas": 72.2, "peso": 120, "escalados": 19 },
      { "cliente": "DLA",      "tickets": 57, "pct_criticas": 29.8, "peso": 43,  "escalados": 15 },
      { "cliente": "Carrier",  "tickets": 52, "pct_criticas": 40.4, "peso": 51,  "escalados": 8 },
      { "cliente": "Copetro",  "tickets": 40, "pct_criticas": 77.5, "peso": 55,  "escalados": 3 },
      { "cliente": "TIM",      "tickets": 32, "pct_criticas": 53.1, "peso": 9,   "escalados": 5 },
      { "cliente": "Lowsedo",  "tickets": 19, "pct_criticas": 42.1, "peso": 10,  "escalados": 5 },
      { "cliente": "Piano",    "tickets": 9,  "pct_criticas": 55.6, "peso": 2,   "escalados": 1 },
      { "cliente": "TPA",      "tickets": 8,  "pct_criticas": 50.0, "peso": 14,  "escalados": 0 },
      { "cliente": "Bonafide", "tickets": 7,  "pct_criticas": 28.6, "peso": 3,   "escalados": 0 },
      { "cliente": "Campari",  "tickets": 5,  "pct_criticas": 60.0, "peso": 0,   "escalados": 0 },
      { "cliente": "GSMA",     "tickets": 4,  "pct_criticas": 25.0, "peso": 1,   "escalados": 0 },
      { "cliente": "PGI",      "tickets": 3,  "pct_criticas": 66.7, "peso": 0,   "escalados": 0 }
    ],
    "_nota": "Peso = # Conversaciones x # Reabierto (proxy de retrabajo). Complejidad = formula 'Prioridad' del board (Urgencia + Impacto + Escalado)."
  },
  "equipo_payroll_hoy": {
    "fuente": "Matrix Complejidad Clientes, board 6552205482",
    "corte": "[FALTA: fecha de extraccion]",
    "filas": "[FALTA: una fila por cliente con analista responsable (alias), sistema (Meta4/Axton), complejidad y pays. Se extrae de monday en modo lectura antes de construir la vista; no se inventa.]"
  }
}
```

### 3.3 Bloque confidencial: `equipo_confidencial` — y cómo se protege de verdad

**Por qué la contraseña no alcanza.** La app es un sitio estático en un repo público. Todo lo
que se despliega (código, la contraseña con la que compara, los datos que vengan en los JSON
de `data/`) lo lee cualquiera que abra el código fuente en el navegador. Una contraseña en
el frontend es una cortina: evita que alguien vea la pestaña por accidente en una reunión;
no evita que alguien que quiera leerla, la lea.

**Regla que sí protege:** los datos de disponibilidad del equipo **no entran nunca al repo ni
al deploy**. Viven únicamente en el JSON que Willy importa desde su notebook, bajo la clave
`equipo_confidencial`. El seed de `data/` no la trae. Si el plan importado no la tiene, la
pestaña ni siquiera aparece en el menú.

**La cortina, implementada bien:**
- En el código va el **hash SHA-256** de la contraseña, no el texto (para que ni siquiera
  esté a la vista en el fuente). Se compara con `crypto.subtle.digest` del navegador.
- El desbloqueo vive en `sessionStorage` (memoria de la pestaña del navegador, se borra al
  cerrarla), **nunca** en `localStorage` ni en el estado persistido de Zustand.
- Al exportar el plan, el bloque `equipo_confidencial` se incluye solo si la pestaña está
  desbloqueada en ese momento; si no, se exporta sin él y se avisa.
- El botón de la pestaña muestra un candado; al desbloquear, un aviso "Datos confidenciales,
  no compartir pantalla" arriba de la vista.

**Forma del bloque:**
```json
"equipo_confidencial": {
  "_doc": "Solo en el JSON local de Willy. Nunca en data/ ni en el repo.",
  "dedicacion_por_mes": {
    "susi":  { "2026-09": { "meta4_soporte": 0.30, "toyota": 0.40, "migracion": 0.00, "axton_soporte": 0.00 } },
    "leo":   { "2026-09": { "meta4_soporte": 0.70, "migracion": 0.00 } },
    "lucas": { "2026-09": { "meta4_soporte": "[FALTA]" } },
    "moni":  { "2026-09": { "axton_soporte": 0.20, "migracion": 0.80 } },
    "gaby_f":{ "2026-09": { "migracion": 1.00 } },
    "guille":{ "2026-09": { "migracion": 0.60, "otros": 0.40 } },
    "lau":   { "2026-09": { "toyota": 1.00 } }
  },
  "transicion_susana": {
    "desde": "[FALTA: mes 2027]",
    "toma_meta4_de": ["leo", "lucas"],
    "_nota": "Susana absorbe todo el soporte Meta4 a medida que bajan las cuentas; Leo y Lucas quedan libres para lo que Willy defina."
  }
}
```
Los valores de arriba son **ejemplo de forma, no datos**. Cada número lo carga Willy; hasta
entonces la vista muestra `[FALTA]` en la celda.

---

## 4. Tramos de trabajo

Cada tramo es un PR contra `main`. Criterio de cierre de cada uno al final. Los tramos A y B
tienen que llegar con tests en `test/` (mismo estilo que `duraciones.test.ts`).

### Tramo A: calendario y reglas nuestras

**A0. Datos.** Corregir en `planmigracion-v3-propuesta.json`: `tim-repaso` arranca el
14/09 y su predecesora `tim-corrida` termina el 18/09. Mover el repaso a la semana siguiente
o al 21/09 (mantener que termine antes del 21/09 que arranca `tim-config-*`, o correr esas
también un día). Agregar `horas_dia: 4` a `gaby_f`, la persona `lucas`, y el bloque
`config.capacidad`.

**A1. Tipar y leer la capa de calendario.** `src/types.ts`: agregar a `Config` como
opcionales `salidas_en_vivo_propuestas`, `cortes_novedades_dia`,
`salidas_en_vivo_fuera_del_plan`, `tiers_v3`, `reglas_calendario`, `capacidad`, `insumos`,
`equipo_confidencial`; a `Persona`, `horas_dia?`. Corregir `Proyecto.complejidad` a
`'baja' | 'media' | 'alta' | null` (hoy `number | null` y el código compara contra
`'baja'` en `src/store.ts:91`). `src/store.ts conFallbackDeSeed` (línea 29): rellenar desde
el seed las nuevas claves que falten, **salvo `equipo_confidencial`** que nunca se rellena.

**A2. Mes de salida como dato.** `src/insightsMigracion.ts cuentasMigracion` (línea 46):
`enVivo` toma el último día del mes de `salidas_en_vivo_propuestas[id]` si existe; si no,
el fin de la última fase (comportamiento actual). `migracionPorTrimestre` y
`resumenMigracion` suman las cuentas de `salidas_en_vivo_fuera_del_plan` como cuentas que
salen en vivo sin fases. `Insights.tsx`: el KPI "Cartera en Axton hoy" y el gráfico de
trimestres las cuentan. Test: DLA sale en noviembre, no en octubre; POF aparece en T3-2026.

**A3. Nuevo módulo `src/capacidad.ts`.** Funciones puras:
`horasDiaDe(persona, config)`, `disponibilidadMes(personaId, mesISO, config, cuentasEnAxton)`,
`cuentasEnAxton(mesISO, config)`, `horasFaseEnMes(asig, mesISO, persona, feriados)`,
`cargaMensual(personas, asignaciones, config) → { personaId, mes, horas, capacidad }[]`,
`cargaSemanal(...)` análoga. Es el único lugar donde vive la matemática de §2; la usan las
reglas y la pestaña Equipo. Tests con los números de referencia de §2.

**A4. Reemplazar las reglas.** `src/rules.ts`:
- Sacar `checkRule2` y `limiteDeCarga`.
- `checkCargaMensual` (rojo) y `checkCargaSemanal` (ámbar) sobre `capacidad.ts`.
- `checkTopeSalidas`: por mes, cuenta propuestas + fuera del plan; rojo si >
  `reglas_calendario.tope_salidas_en_vivo_por_mes`, salvo exactamente 3 con ≥2 de tier
  `chica`. Mensaje: "Marzo 2027 tiene 3 salidas en vivo (Sportline, Aysa, Ford): permitido
  porque dos son tier chico" solo como informativo, no violación.
- `checkMargenYBlackout`: por cuenta, días hábiles entre fin de última fase `Pruebas` y el
  corte de novedades del mes de salida (día de `cortes_novedades_dia`, corrido hacia atrás
  si cae en fin de semana o feriado); rojo si < `capacidad.margen_minimo_habiles`. Y rojo si
  una fase `Configuracion` intersecta `[blackout_config[0], blackout_config[1]]`.
- `checkRule3` → `checkDependenciaConfigPruebas`: solo pares Configuración → Pruebas de la
  misma cuenta, **sin** la condición de misma persona. Mensaje con nombre de cuenta y fechas
  en `dd/mm`.
- `TipoRegla` pasa a `'carga_mes' | 'carga_semana' | 'tope_salidas' | 'margen' | 'blackout'
  | 'dependencia'`. Revisar todos los consumidores: `ResumenEjecutivo.tsx` línea ~38
  (`REGLA_NOMBRE` tipado con las claves viejas: se rompe), `Insights.tsx`, `PanelInsights.tsx`,
  `Timeline.tsx` (tintes por semana pasan a leer `carga_semana`/`carga_mes`).
- Todos los mensajes nombran cuenta, fase y fecha; ninguno muestra un id.

**Cierre del tramo A:** importar el v3 corregido en el navegador y obtener: 0 violaciones de
tope, 0 de margen, 0 de blackout, 0 de dependencia; y las de carga mensual que correspondan
(se espera que enero 2027 de Willy quede en rojo o ámbar; anotar el número). Tests verdes.
PR + merge + deploy.

### Tramo B: pestaña "Equipo"

Nuevo `src/components/Equipo.tsx` + lógica en `src/insightsEquipo.ts` (misma separación que
`Insights.tsx` / `insightsMigracion.ts`). Se agrega la pestaña al header en `App.tsx` y a
`uiStore.Vista`. Layout en una columna de tarjetas a 1280 px, sin scroll horizontal.

**B1. Horas por persona por mes contra capacidad.** Una tarjeta por persona con carga
(Willy, Moni, Gaby; el resto solo si tiene fases). Barras por mes sep-26 → abr-27, la
capacidad del mes como línea encima, la barra en rojo si la pasa y en ámbar entre 85 y 100 %.
Debajo, el total del programa y el mes pico. Fuente: `capacidad.cargaMensual`.

**B2. El solapamiento explicado.** Debajo de las barras, por mes, una línea de prosa
generada: "Diciembre: Willy configura Copetro y Campari a la vez (56 h de 84). Moni carga
las dos en Axton (35 h de 71)." Los números salen de `cargaMensual` desglosado por cuenta.
Cuando el total pasa la capacidad, la misma línea lo dice y enlaza a la regla.

**B3. Quién hace qué en cada cuenta.** Una fila por cuenta, ordenada por mes de salida:
tier, mes de salida, corte de novedades, margen en hábiles; y a la derecha las fases en
carriles por persona (repaso Gaby, config Willy y Moni superpuestas, pruebas Gaby/Moni/Willy).
Reemplaza al "Quién hace cada cuenta" actual de Insights (se saca de ahí).

**B4. La franja de salidas.** Una fila por mes (sep-26 → abr-27) con las cuentas que salen,
el tope, y el margen de cada una. Verde/ámbar/rojo según reglas. Incluye POF y Finadiet
rotuladas "fuera del simulador".

**B5. Insumos para justificar.** Dos tarjetas más al final de Equipo:
- **Tickets Meta4 YTD**: el gráfico de barras horizontales por cliente (tickets), con el %
  de críticas como color y los escalados como marca. Mismo criterio visual que el que está en
  Notion (`mapa_decision_migracion_tickets_meta4.html`): barras ordenadas, una lectura en una
  frase arriba ("Marval concentra escalados y retrabajo; Copetro tiene la tasa de críticas
  más alta"). Datos de `config.insumos.tickets_meta4_ytd`.
- **Equipo de payroll hoy**: distribución de clientes por analista y por sistema
  (Meta4/Axton), desde `config.insumos.equipo_payroll_hoy`. Si el bloque está en `[FALTA]`,
  la tarjeta lo dice y no dibuja nada.

**Cierre del tramo B:** con el v3 importado, la pestaña Equipo muestra las cuatro tarjetas y
las dos de insumos; los totales por persona coinciden con `cargaMensual`; se lee en la
notebook a 1280 px sin scroll horizontal; captura de pantalla adjunta al PR.

### Tramo C: pestaña confidencial "Disponibilidad del equipo"

**C1.** Pestaña visible en el header **solo si** el plan importado trae
`equipo_confidencial`. Con candado. Al clic, pide contraseña; compara SHA-256 contra el hash
en el código; guarda el desbloqueo en `sessionStorage`. `uiStore` no persiste nada de esto.

**C2. Vista.** Una fila por persona (Susi, Leo, Lucas, Moni, Gaby, Willy, Lau), barras
apiladas por mes con la dedicación por frente: Meta4 soporte / Axton soporte / Migración /
Toyota / Otros. Una línea vertical en `transicion_susana.desde`. Debajo, la lectura: "Desde
[mes], Susana toma el soporte Meta4 de Leo y Lucas; quedan libres X h/semana". Cada celda sin
dato muestra `[FALTA]`.

**C3. Export.** `exportarJSON` incluye `equipo_confidencial` solo si la sesión está
desbloqueada; si no, lo omite y muestra un aviso.

**Cierre del tramo C:** la pestaña no aparece con el seed; aparece con candado con un JSON
que trae el bloque; se abre con la contraseña; al recargar la página vuelve a estar cerrada;
el export sin desbloquear no contiene el bloque (verificar abriendo el archivo).

### Tramo D: barra, filas e higiene

**D1. Barra a una fila.** `ConfigPanel.tsx`: a la vista zoom, Hoy, Deshacer, Resumen,
Importar/Exportar, chip de estado. A "Más": alturas de fila, Flexible/Estricto, Carga
semanal, Dependencias, Expandir, Planificar pendientes, Vaciar, Reset. **Se elimina** la
perilla "Inicio Toyota", sus presets y `updateConfigFecha` para TASA (`store.ts` ~426-455),
y el botón "Recalcular duraciones" (pisa `dedicacion_pct`). Limpiar `uiStore` de lo que ya no
se use.

**D2. Filas sin carga ocultas por default.** `uiStore.personasOcultas` arranca con las
personas sin fases; "Ver todas" ya existe en `MenuPersonas`.

**D3. Tier visible.** `DetailPanel` y `AccountRail` muestran chica/estándar/grande desde
`tiers_v3` en lugar de "complejidad sin definir".

**D4. Validación al importar.** Zod en `importarJSON`: forma de las cuatro claves raíz, las
obligatorias de `config` (`horizonte`, `fechas_clave`, `feriados_nacionales_2026`), tipos de
`Asignacion`, y referencias (`persona_id`, `proyecto_id`, `predecesoras` existentes). Resultado
en un cartel: qué entró, qué faltó, qué claves se ignoraron. Fases con persona inexistente
se dibujan en una fila "Sin asignar" (`Timeline.tsx`, hoy `return null`).

**D5. CI y docs.** `npm test` en `deploy.yml` antes del build. Reescribir `CLAUDE.md` del
repo: tres fases, las reglas de §4-A4, `specs/` como fuente de verdad, la regla de
confidencialidad de §3.3. Mover `docs/spec.md` y `docs/metodologia-fases.md` a
`docs/_archivo/`. Copiar este brief y el documento de ideas a `specs/` del repo.

**Cierre del tramo D:** un JSON con `persona_id` inválida importa con aviso y la fase se ve en
"Sin asignar"; un JSON sin `horizonte` da cartel y no pantalla blanca; la barra entra en una
fila a 1280 px; tests corren en Actions.

---

## 5. Datos a preparar (antes o durante el tramo B)

1. **Tickets Meta4 YTD:** ya están en §3.2, listos para pegar en el JSON. Fuente Notion,
   página "Priorización de migración — tickets Meta4", corte 08/09/2026.
2. **Equipo de payroll hoy:** extraer de monday, board 6552205482 (Matrix Complejidad
   Clientes), **solo lectura**: cliente, analista responsable (alias), sistema, complejidad,
   pays. Volcar a `config.insumos.equipo_payroll_hoy.filas` con la fecha de corte. Hay un hook
   que bloquea escrituras a monday; no hace falta desactivarlo.
3. **Disponibilidad confidencial:** la carga Willy a mano en su JSON local siguiendo §3.3.
   El chat no la completa ni la estima.

---

## 6. Orden y estimación

A (A0→A4) primero y entero: sin él, todo lo demás muestra números que la app contradice al
lado. Después B, después C, después D. D4 (validación) conviene adelantarlo si el JSON
empieza a dar problemas.

Estimación de esfuerzo de máquina, no de calendario: A y B son los grandes; C es chico; D es
mediano por la cantidad de archivos que toca.

---

## 7. Qué documentar al cerrar cada tramo

- `Herramientas-Tecnicas/DECISIONES.md` (carpeta de migraciones): una entrada por cambio de
  criterio si aparece alguno.
- Notion, página "Priorización de migración — tickets Meta4": una línea por tramo cerrado
  (fecha, qué cambió, qué queda abierto). Ya tiene la entrada del 10/09 con esta decisión.
- `Proyecto/PLAN-DE-PROYECTO.md` §0.bis: cuando la app quede como tablero, referenciarla como
  la vista viva del calendario.
