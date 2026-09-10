# Handoff: Resumen ejecutivo animado (Simulador de Migración)

Repo destino: `bhidalgo-ar/planmigracion` (React + Vite + TypeScript + Zustand + date-fns). Leé `CLAUDE.md` del repo antes de empezar.

## Qué es

Un video de 45 segundos (1920×1080, 16:9) para gerencia que resume el programa Meta4 → Axton en seis escenas: cuántas cuentas ya operan en Axton, la ola de salidas por trimestre, el mes crítico con sus alertas, cuándo termina, y un cierre. Hoy la referencia HTML tiene los datos del plan v3 **escritos a mano**. El objetivo del handoff es que **todo salga del plan cargado en la app**: si Willy mueve una fase, cambia una salida en vivo o importa otro JSON, el video se regenera solo.

## Sobre los archivos de este paquete

Son **referencias de diseño en HTML**, no código para copiar. `resumen-piece.jsx` muestra la coreografía, tiempos, layout y copy exactos; `animations-v3.jsx` y `tweaks-panel.jsx` son el motor de tiempo y el panel del prototipo, útiles para leer la idea (interpolación por cues, un solo árbol siempre montado) pero no hace falta portarlos. `support.js`, `Resumen Ejecutivo.dc.html` y `_ds/` solo sirven para abrir el prototipo en el navegador.

**No incluye el plan JSON**: el que se usó trae `config.equipo_confidencial`. Probá con `test/fixtures/plan-v3.json` del repo.

Fidelidad: **alta**. Colores, tipografía, tamaños, tiempos y textos son finales; recrear tal cual con los tokens que ya usa la app (`var(--celeste)`, etc.).

---

## Arquitectura propuesta: el video como vista derivada del store

Regla única: **ningún nombre de cuenta, mes, número ni texto de subtítulo vive en el componente**. Todo lo calcula una función pura a partir del plan, y el componente solo lo dibuja.

```
src/
  resumen/
    derivarResumen.ts     ← función pura: (personas, proyectos, asignaciones, config, hoy) → ResumenData
    guion.ts              ← genera subtítulos y títulos a partir de ResumenData (templates, no strings fijos)
    motion.ts             ← easing + los tres helpers de movimiento (enter/draw/pop) + animate/clamp
    ResumenAnimado.tsx    ← el componente: reloj T, escenas, exportación
  components/
    ...                   ← agregar la pestaña "Resumen" en App.tsx (o botón en ResumenEjecutivo.tsx)
test/
  resumen.test.ts         ← derivarResumen contra plan-v3.json (valores esperados abajo)
```

### 1. `derivarResumen.ts` — el contrato de datos

Entrada: el mismo estado que ya tiene `useSimuladorStore` (personas, proyectos, asignaciones, config) más `hoy: Date`. Reusar `src/capacidad.ts` y `src/rules.ts`; no duplicar matemática.

```ts
export type ResumenData = {
  hoy: string                         // ISO, se muestra como "10 de septiembre de 2026"
  yaEnAxton: number                   // 10 con plan v3
  porMigrar: number                   // 15
  total: number                       // 25
  salidas: Salida[]                   // ordenadas por mes y luego por orden en config
  trimestres: { label: string; sub: string; salidas: Salida[] }[]   // solo los que tienen ≥1 salida
  meses: { key: string; label: string; salidas: Salida[] }[]        // eje continuo desde el primer mes de salida al último
  fin: { mes: string; label: string; cuenta: string }               // { "2027-04", "abril 2027", "Carrier" }
  cuello: {
    mes: string; label: string                                      // "2027-01", "enero 2027"
    cuentas: string[]                                               // ["Copetro","Campari","Marval","Lowsedo"]
    filas: { cuenta: string; barras: { fase: TipoFase; desde: string; hasta: string }[] }[]
    ventana: { desde: string; hasta: string }                       // rango de fechas del gantt
    blackout: { desde: string; hasta: string } | null
  }
  alertas: { severidad: 'rojo' | 'ambar' | 'info'; texto: string }[]
}
type Salida = { id: string; nombre: string; mes: string /* YYYY-MM */; mesCorto: string /* "sep" */; trimestre: string /* "Q4 2026" */; fueraDelPlan: boolean }
```

Cómo se deriva cada campo del plan (todas las claves ya existen en `Config`):

- **salidas**: `config.salidas_en_vivo_propuestas` (clave = id de proyecto, valor `YYYY-MM`; ignorar claves que empiezan con `_`) ∪ `config.salidas_en_vivo_fuera_del_plan.cuentas` (`alias ?? nombre`, `sale_en_vivo`). Nombre desde `proyectos[].nombre`. Excluir proyectos con `especial: true` (TASA) y los listados en `cartera_legacy_axton.cuentas_programa_ya_en_vivo`.
- **yaEnAxton**: `cartera_legacy_axton.cuentas.length + cartera_legacy_axton.cuentas_programa_ya_en_vivo.length`. **porMigrar** = `salidas.length`. **total** = suma.
- **trimestres**: agrupar por `Q{ceil(mes/3)} {año}`; `sub` = meses cubiertos en formato corto ("oct – dic") + `n salida(s)`.
- **meses**: cada mes calendario entre `min(salidas.mes)` y `max(salidas.mes)`, aunque tenga 0 salidas.
- **fin**: el `max(mes)`; si hay varias cuentas ese mes, la última en el orden de `salidas_en_vivo_propuestas`.
- **cuello.mes**: el mes de la primera regla `carga_mes` roja que devuelve `rules.ts`. Si no hay ninguna, el mes con más proyectos distintos con fases activas (de `asignaciones`, cualquier tipo salvo `Vacaciones`). `cuentas` = proyectos con al menos una fase que toca ese mes, ordenados por inicio de su primera fase en el mes. `filas` = una por cuenta; `barras` = **fusión por tipo de fase**: las fases del mismo proyecto y mismo tipo asignadas a distintas personas (Gaby, Moni, Guille prueban en paralelo) se colapsan en una barra `min(inicio)..max(fin)`. `ventana` = primer lunes ≥ 14 días antes del mes hasta último domingo ≥ 6 días después. `blackout` desde `config.tiers_v3.blackout_config` si cae dentro de la ventana.
- **alertas**: mapeo directo de `rules.ts` filtrado al mes del cuello y al mes del tope de salidas: `carga_mes` rojo → `"Carga del equipo en {mes} por encima de la capacidad"`; `tope_salidas` info → `"{Mes año}: {n} salidas en vivo, el tope del mes"`. Máximo 2, roja primero. Los mensajes de `rules.ts` ya nombran cuenta/fase/fecha; podés usarlos directo en lugar de estos templates si quedan cortos (≤ 60 caracteres).

Valores esperados con `test/fixtures/plan-v3.json` y `hoy = 2026-09-10` (para `test/resumen.test.ts`): yaEnAxton 10, porMigrar 15, total 25; trimestres Q3 2026 = 1, Q4 2026 = 6, Q1 2027 = 7, Q2 2027 = 1; meses sep 26 … abr 27 (8); fin = abril 2027 / Carrier; cuello = enero 2027 con Copetro, Campari, Marval, Lowsedo; blackout 2026-12-21 → 2027-01-08; una alerta roja de carga y una info de tope en marzo 2027.

### 2. `guion.ts` — copy generado, no fijo

Cada texto del video es una función de `ResumenData`. Textos actuales (mantener redacción; sustituir los números):

| Momento | Template |
|---|---|
| Apertura título | `Programa de migración Meta4 → Axton` |
| Apertura sub | `Resumen ejecutivo · {hoy largo}` |
| Hoy título | `{yaEnAxton} de {total} cuentas ya operan en Axton` (el número cuenta de 0 a yaEnAxton) |
| Hoy leyenda | `En Axton · {yaEnAxton}` / `En Meta4, por migrar · {porMigrar}` |
| Hoy subtítulo | `Hoy, {yaEnAxton} de las {total} cuentas ya operan en Axton. Faltan {porMigrar}.` |
| Ola título | `La ola de salidas en vivo, trimestre a trimestre` |
| Ola subtítulo 1 | `Las {porMigrar} salen en vivo en {trimestres.length} trimestres.` |
| Ola subtítulo 2 | `{T1} concentra {n1} salidas; {T2}, {n2}.` con los dos trimestres de mayor conteo, en orden cronológico |
| Cuello título | `{Mes año}: {cuentas.length} cuentas al mismo tiempo` (número en letras hasta diez) |
| Cuello subtítulo 1 | `{Mes año} es el mes crítico: {cuentas unidas con comas y "y"} a la vez.` |
| Cuello subtítulo 2 | si hay alerta roja: `La carga supera la capacidad del equipo: es la alerta roja del plan.`; si no: `{n} cuentas se solapan en un mes con blackout de configuración.` |
| Fin título | `Cuándo termina` · contador `{n} / {total}` · `cuentas en Axton` |
| Fin cápsula | `{MES AÑO}` (mayúsculas) · `{cuenta}, la última salida en vivo` |
| Fin subtítulo 1 | `Con esta ola, Axton pasa de {yaEnAxton} a {total} cuentas.` |
| Fin subtítulo 2 | `La última salida en vivo es {cuenta}, en {mes de año}.` |
| Cierre | `{porMigrar} cuentas en {meses.length} meses.` · `El programa cierra en {mes de año}.` · `Hidalgo & Asociados · Simulador de Migración` |
| Header | `Hidalgo & Asociados` / `SIMULADOR DE MIGRACIÓN · RESUMEN EJECUTIVO` / `Plan {nombre del archivo importado o "actual"} · {hoy largo}` |

### 3. `ResumenAnimado.tsx` — un árbol, un reloj

- Suscribirse al store con un selector y `useMemo(() => derivarResumen(...), [personas, proyectos, asignaciones, config])`. Al cambiar el plan, `ResumenData` cambia y el video se redibuja en el mismo instante T: eso es lo "vivo".
- Un solo reloj `T` (segundos autorales, 0–45) via `requestAnimationFrame`; play/pausa, scrubber, loop. Todo se dibuja como función pura de `(T, data)`; nada en `useEffect`.
- Cues fijos por escena (duración total 45 s): `Apertura 0`, `Hoy 4`, `Ola 10`, `Cuello 24`, `Fin 33`, `Cierre 40`, fin 45. Declararlos en un array `ESCENAS = [{nombre, dur}]` para que se pueda retocar sin tocar coreografía.
- **Los layouts escalan con la cantidad de datos** (hoy están fijos para 25 / 4 / 8 / 4):
  - Puntos de la escena Hoy: `total` puntos en una fila; diámetro = `min(56, (1736 - (total-1)*14) / total)`; si `total > 30`, dos filas.
  - Columnas de la Ola: `trimestres.length` columnas centradas con paso `min(373, 1440 / n)`; ancho de chip `min(280, paso - 40)`; si una columna supera 8 chips, reducir alto de chip a `44` y gap a `8`.
  - Eje de meses en Fin: `meses.length` ticks con paso `min(200, 1400 / (n-1))`.
  - Gantt del cuello: filas = `cuello.filas.length` (alto de fila 92, máx. 5 filas; si hay más, mostrar las 5 con más días activos y sumar "+n cuentas" al título).
  - Alertas: 0, 1 o 2 pills apiladas.
- Exportación: reutilizar la ruta de exportación que decidan (MediaRecorder sobre un `<canvas>` con `html2canvas` por frame a 30 fps, o simplemente grabar la pestaña). El prototipo exporta desde el host; en la app alcanza con un botón "Exportar MP4/WebM" que recorra T de 0 a 45 en pasos de 1/30 s.
- Dónde vive: una pestaña `📽 Resumen` en `TABS` de `App.tsx`, o un botón "Ver como video" en `ResumenEjecutivo.tsx`. La pestaña confidencial no participa: `derivarResumen` **no lee** `config.equipo_confidencial`.

Tweaks (como props / estado local, persistidos en `localStorage` con las otras preferencias de UI): `mostrarAlertas: boolean`, `subtitulos: boolean`.

---

## Escenas y coreografía (referencia exacta: `resumen-piece.jsx`)

Tres únicos helpers de movimiento (no usar otros easings):

- `enter(T, inicio, dur=0.7)`: opacity 0→1 + translateY 24→0, `easeOutCubic`.
- `draw(T, inicio, dur=0.8)`: progreso 0→1, `easeInOutCubic`. También sirve para fundir (`1 - draw`).
- `pop(T, inicio, dur=0.6)`: opacity rápida + scale 0.6→1 con `easeOutBack`.

Deriva global de cámara: `scale(1 + 0.012·sin(0.35·T))` sobre todo el contenido, para que ningún frame quede quieto.

**Header persistente**: isotipo 168 px centrado en (960, 384) durante Apertura → viaja a 56 px en (72, 44) entre `Hoy−0.7` y `Hoy+0.2` → vuelve al centro entre `Cierre−0.6` y `Cierre+0.3`. A la derecha del isotipo chico: "Hidalgo & Asociados" 18/700 negro (el `&` en itálica gris 400) y debajo la etiqueta 13/700 `#007896`, uppercase, tracking 0.14em. Arriba a la derecha: "Plan v3 · 10 de septiembre de 2026" 18/400 gris.

| Escena | s | Qué pasa |
|---|---|---|
| Apertura | 0–4 | Título 64/700 celeste entra a 0.5 s; subtítulo 30/400 gris a 1.1 s. Todo funde de `Hoy−0.45` a `Hoy`. |
| Hoy | 4–10 | Etiqueta HOY 22/600 gris uppercase + título 76/700 negro (número en celeste). 25 círculos 56 px, gap 14, fila centrada en y=532: aparecen con `pop` escalonado 0.06 s desde `Hoy+0.3`; los 10 primeros se pintan de celeste de `Hoy+1.4` cada 0.1 s (el contador del título sube con ellos). Leyenda 28/400 a `Hoy+2.9`. |
| Ola | 10–24 | Los 10 celestes se encogen y desaparecen (`Ola−0.4`, 0.6 s). Cada uno de los 15 pendientes viaja de su lugar en la fila a su ranura de columna (izq = centro de columna − 140, top = 800 − (k+1)·54 − k·10), pasando de 56×56 a 280×54, borde gris → relleno celeste; texto "Nombre · mes" 24/700 + 22/400 aparece en el último 30 % del viaje. Inicio `Ola+0.3 + j·0.13`, duración 1 s. Línea base `#E7E6E6` de x 240 a 1680 dibujándose en 0.9 s. Etiquetas "Q4 2026" 30/700 + "oct – dic · 6 salidas" 24/400 gris entran cuando aterriza el primer chip de su columna. Título 56/700 celeste a `Ola+0.3`. Todo funde en `Cuello−0.6`. |
| Cuello | 24–33 | Entra con fade + scale 0.96→1. Título 56/700 celeste alineado a x=120. Eje semanal (lunes) 20/600 gris con líneas verticales 1 px `#E7E6E6`. Zona de blackout rayada 135° (gris 10 %) con borde derecho discontinuo y etiqueta 18/600. Filas de 60 px de alto cada 92 px; nombre 28/700 alineado a la derecha en x 120–280. Barras radio 8, se dibujan de izquierda a derecha en 0.7 s, escalonadas 0.28 s desde `Cuello+1.0`; etiqueta de fase 20/600 solo si la barra supera 130 px. Colores de fase: Relevamiento `#B3E6F2` texto `#007896`; Configuración `#00ACD4` texto blanco; Pruebas `#007896` texto blanco. Alertas en y=748, apiladas, `pop` a `Cuello+4.6` y `+6.2`: pill 24/700 con punto 14 px; roja `rgba(232,85,24,.10)` / borde `rgba(232,85,24,.45)` / texto `#E85518`; ámbar `rgba(245,158,11,.12)` / `rgba(245,158,11,.5)` / texto `#9A6200`. Funde en `Fin−0.6`. |
| Fin | 33–40 | Título 56/700 celeste; contador 120/700 (número celeste, "/ 25" gris 300); "cuentas en Axton" 26/400 gris. Eje de meses celeste 3 px de x 260 a 1660 (paso 200) dibujándose en 1.2 s desde `Fin+0.4`; ticks 3×22 y etiquetas 22/600 gris (el último mes en negro). 15 puntos de 26 px caen desde 260 px arriba hasta apilarse sobre su mes (34 px entre puntos), uno cada 0.17 s desde `Fin+0.9`; el contador suma uno por punto que aterriza. Cápsula "ABRIL 2027" (24/700 uppercase, celeste) + "Carrier, la última salida en vivo" 26/400 con `pop` a `Fin+4.2`. Funde en `Cierre−0.6`. |
| Cierre | 40–45 | "15 cuentas en 8 meses." 64/700 negro a `Cierre+0.4`; "El programa cierra en abril de 2027." 44/600 celeste y wordmark 26/300 gris a `Cierre+1.1`. Funde a `fin−0.7` dejando solo el isotipo centrado, que es el primer frame del loop. |

Subtítulos: un solo elemento, centrado, `bottom: 5%`, 34/600 negro, fade 0.18 s. Tiempos en `guion.ts` según la tabla de templates: `Hoy+0.6`, `Ola+0.6`, `Ola+4.5`, `Cuello+0.8`, `Cuello+4.8`, `Fin+0.6`, `Fin+4.4`; cada uno termina 0.4 s antes del siguiente cue de escena o cuando arranca el siguiente subtítulo.

## Tokens

- Celeste `#00ACD4` · celeste profundo `#007896` · celeste claro `#B3E6F2` · gris `#8C837B` · negro `#000000` · blanco `#FFFFFF` · borde `#E7E6E6` · error `#E85518` · warning `#F59E0B`.
- Tipografía: `'Source Sans 3', 'Source Sans Pro', Arial, sans-serif` (pesos 300/400/600/700). La app ya carga la familia por `var(--font)`.
- Radios: pills y puntos `9999px`; barras del gantt `8px`.
- Lienzo 1920×1080, fondo blanco; escalar con `transform: scale()` al contenedor manteniendo 16:9.

## Assets

- `assets/logo-ha.png` — isotipo oficial H&A (el repo ya lo tiene en `src/assets/logo-ha.png`; usar ese).

## Capturas

En `screenshots/`, un frame por escena (el número final es el segundo del video): `01-apertura-2s.jpg`, `02-hoy-8s.jpg`, `03-ola-transicion-11s.jpg`, `04-ola-18s.jpg`, `05-cuello-31s.jpg`, `06-fin-38s.jpg`, `07-cierre-42s.jpg`. La 03 muestra los puntos de la fila viajando a sus columnas, mitad de camino.

## Archivos del paquete

- `Resumen Ejecutivo.dc.html` — página del prototipo (abrir en navegador; requiere `support.js` y `_ds/` al lado).
- `resumen-piece.jsx` — **la referencia principal**: coreografía, layout, copy, datos hoy hardcodeados.
- `animations-v3.jsx`, `tweaks-panel.jsx` — motor y panel del prototipo (solo lectura).
- `support.js`, `_ds/` — runtime del prototipo.

## Orden sugerido de trabajo (un PR por tramo, con tests)

1. `derivarResumen.ts` + `test/resumen.test.ts` contra `plan-v3.json` con los valores esperados de arriba.
2. `guion.ts` + tests de los templates (singular/plural, número en letras, "y" final).
3. `motion.ts` y `ResumenAnimado.tsx` con datos derivados; pestaña en `App.tsx`.
4. Layout adaptativo (más/menos cuentas, trimestres, meses) probado con un plan modificado a mano.
5. Exportación a video.
