# Simulador de Migración: de tablero de fases a tablero del programa

Fecha: 10/09/2026. Estado: **aprobado por Willy el 10/09/2026**. Las decisiones de la
sección 6 quedaron resueltas y el detalle técnico está en
`2026-09-10-simulador-BRIEF-para-implementar.md` (mismo directorio), que es el documento con
el que se arranca el chat de implementación.

Repo de la app: `github.com/bhidalgo-ar/planmigracion` (deploy en
`https://bhidalgo-ar.github.io/planmigracion/`). Copia de trabajo de la versión real:
`H&A/07_Proyectos/Implementaciones/plan-simulador-live` (commit `66d1ce3`). La carpeta
`plan-simulador` de al lado está desactualizada desde el 30/06 y no hay que usarla.

JSON del plan vigente: `Proyecto/planmigracion-v3-propuesta.json` (calendario opción C,
aprobado el 10/09/2026, registrado en Notion y en `PLAN-DE-PROYECTO.md` §0.bis).

---

## 1. Qué queremos que sea la app

Hoy es una mesa genérica de fases por persona con dos reglas de conflicto. Queremos que sea
**el tablero con el que Willy revisa el programa con los stakeholders**: que las reglas que
marca sean las que decidimos, que muestre qué le pasa al equipo de payroll mes a mes, y que
el solapamiento de trabajo entre cuentas se lea como diseño y no como falla.

Fuera de alcance, decidido: TASA/Toyota y TPA (son otro plan). Mockups (se valida sobre este
documento).

---

## 2. Lo que la app hace hoy, verificado contra el código

Cada afirmación tiene el archivo y la función donde está. Sirve para que la validación sea
contra el repo y no contra la memoria.

### 2.1 El motor de reglas tiene dos reglas, y ninguna es la nuestra

`src/rules.ts`:

- `limiteDeCarga` (línea 22): el tope de una persona es `capacidad_horas_semana / 40`,
  menos su `buffer_pct`. **No lee la disponibilidad por año** (`config.disponibilidad`),
  que sí está en el JSON. Gaby queda con tope 0,5 (20 h); Willy con tope 1,0 aunque su
  disponibilidad sea 0,6.
- `checkRule2` (línea 28): por cada semana y persona, si el mismo día hay **fases de
  distintas cuentas** cuya dedicación suma más que el tope, rojo. Si suma más del 80 % del
  tope, ámbar. Dos fases de la misma cuenta nunca son conflicto.
- `checkRule3` (línea 80): una fase que arranca antes del fin de su predecesora es rojo,
  **solo si las dos las hace la misma persona**. El mensaje usa ids crudos
  (`"tim-repaso" empieza el 2026-09-14 antes de que termine "tim-corrida"`).
- `computeViolaciones` (línea 103) las concatena. El tipo `TipoRegla` en `src/types.ts`
  solo admite `'R2' | 'R3'`. La Regla 1 (acantilado Susana → Toyota) fue eliminada en el
  commit `6212fe9` y no existe.

Corrida sobre el JSON v3 (simulación fiel de la lógica): **15 rojos y 3 ámbar**. Once de
los quince son de Gaby por sumar 0,3 + 0,5 de dos cuentas la misma semana contra un tope de
0,5. Ninguno de los 18 es uno de los conflictos que definen nuestros documentos.

### 2.2 La app ignora la capa de calendario del JSON

Claves de `config` que **no aparecen en ningún archivo de `src/`** (verificado con grep):
`salidas_en_vivo_propuestas`, `cortes_novedades_dia`, `tiers_v3` (incluidos
`duraciones_dias` y `blackout_config`), `reglas_calendario` (las tres banderas),
`salidas_en_vivo_fuera_del_plan`, `pisos_soporte_horas_semana`. Entran, se guardan en el
navegador y se vuelven a exportar intactas; no cambian nada en pantalla.

Claves que **sí** lee: `horizonte` (eje del timeline y rango de la Regla 2),
`fechas_clave.transicion_susana_toyota` (perilla Toyota), `feriados_nacionales_2026/2027`
(`src/utils/dates.ts:35 feriadosDeConfig`), `horas_por_fase` y `disponibilidad`
(`src/store.ts:87 horasDeFase`, `src/utils/dates.ts:69 disponibilidadDe`, solo para el botón
"Recalcular duraciones"), `unidades.horas_por_dia`, `cartera_legacy_axton` (solo la cantidad
de cuentas, para el KPI "Cartera en Axton hoy").

### 2.3 "En vivo" se deduce del fin de pruebas

`src/insightsMigracion.ts:46 cuentasMigracion`: una cuenta está en vivo el día que termina
su última fase. Nuestra regla es otra: sale en el mes en que el margen contra el corte de
novedades alcanza. A nivel mes coinciden las trece salvo **DLA** (pruebas terminan el
30/10, sale en noviembre). POF y Finadiet, que están en `salidas_en_vivo_fuera_del_plan`,
no aparecen en el gráfico de trimestres ni en "Cartera en Axton hoy".

### 2.4 El import no valida

`src/store.ts importarJSON` (línea ~868): si falta una de las cuatro claves raíz
(`personas`, `proyectos`, `asignaciones`, `config`) la reemplaza por la del seed sin avisar.
Si a `config` le falta `horizonte`, `fechas_clave` o `feriados_nacionales_2026`, la app se
cae con pantalla en blanco. Una fase cuya `persona_id` no existe **no se dibuja**
(`src/components/Timeline.tsx`, `if (!filaDe.has(a.persona_id)) return null`), pero sigue
contando para las fechas de cierre. El único mensaje de error es "Archivo JSON inválido" y
solo salta si el archivo está roto sintácticamente.

### 2.5 Otros detalles que importan para lo que viene

- "Recalcular duraciones" (`src/store.ts recalcularDuraciones`) **sobrescribe
  `dedicacion_pct`** con el promedio de disponibilidad. Con v3 pisaría los 0,1 / 0,5 / 0,6 /
  0,3 que llevan la intención del plan.
- `proyecto.complejidad` está tipado `number | null` pero el código compara contra el string
  `'baja'` (`src/store.ts:91`). El JSON v3 trae `"baja"` para GSMA, Bonafide, Aysa y Ford,
  así que la rama de cuenta chica **sí** se activa; pero el tipo está mal.
- La barra de configuración (`src/components/ConfigPanel.tsx`) tiene 22 controles en dos
  filas, entre ellos la perilla "Inicio Toyota" con presets hardcodeados (`2026-08-03`,
  `2026-10-05`), tres alturas de fila, el toggle Flexible/Estricto y el menú de personas.
- `CLAUDE.md`, `README.md` y `docs/spec.md` del repo describen un producto que no existe
  (cinco fases con UAT y Paralelo, gate de UAT, Regla 1, `avance_pct`). El único documento
  fiel es `specs/disponibilidad-por-persona-y-ano.md`.
- No hay CI de tests: `.github/workflows/deploy.yml` corre `tsc && vite build` y publica.
  Los tests (`test/duraciones.test.ts`, `test/migracion.test.ts`) se corren a mano.

### 2.6 Un error de datos en el JSON v3

`tim-repaso` (14/09 → 15/09) arranca antes de que termine `tim-corrida` (14/09 → 18/09).
Es la única dependencia rota y es del JSON, no de la app. Corregir en el JSON.

---

## 3. Lo que dicen nuestros documentos que debería marcar

Fuentes: `PLAN-DE-PROYECTO.md` §0.bis, `CONFIGURACION-EN-AXTON.md` §12.9, `DECISIONES.md`
D53 y D54, `mockups/mockup-2` bloques 1, 4 y 6.

Conflictos reales, los únicos tres:

1. **Más de dos salidas en vivo en un mes**, tres solo si dos son tier chico. POF
   (sep-26) y Finadiet (oct-26) cuentan.
2. **Configuración que cierra a menos de 5 días hábiles del corte de novedades** del mes
   de salida, o que cae dentro del blackout 21/12 → 08/01.
3. **Persona con más horas en el mes que su capacidad de referencia**: Willy 96 h
   (0,6 × 160), Gaby ~86 h (20 h semanales), Moni pendiente de medir su piso de soporte.

Una sola dependencia dura: **Pruebas no arranca antes de que cierre Configuración**.

Lo que **no** es conflicto y hoy la app marca:

- Moni y Willy configurando la misma cuenta a la vez. Es el modelo: "el plazo lo fija el
  bloque de Willy, no la suma" (§12.9).
- Una persona en dos cuentas la misma semana con dedicación parcial. El control es por
  horas mensuales contra capacidad, no por exclusividad (mockup 2, bloque 6).

---

## 4. Las ideas

Cada una con qué cambia, por qué, y qué toca en el código. Están agrupadas en el orden en
que conviene construirlas.

### Bloque A: que la app entienda el calendario y aplique nuestras reglas

**A1. Leer la capa de calendario del JSON.** Tipar y consumir `salidas_en_vivo_propuestas`,
`cortes_novedades_dia`, `salidas_en_vivo_fuera_del_plan`, `tiers_v3` y
`reglas_calendario`. Toca `src/types.ts` (tipo `Config`), `src/store.ts conFallbackDeSeed`
(fallback al seed si faltan). Sin esto, todo lo demás no tiene datos.

**A2. Mes de salida en vivo como dato, no como deducción.** `cuentasMigracion` toma el mes
de `salidas_en_vivo_propuestas` cuando existe y cae al fin de pruebas solo si no está. POF y
Finadiet entran al gráfico de trimestres y al KPI de cartera. Toca `src/insightsMigracion.ts`
y `src/components/Insights.tsx`. Corrige DLA.

**A3. Reemplazar la Regla 2 por carga mensual contra capacidad.** Para cada persona y mes:
horas = suma de (días hábiles de cada fase en ese mes × 8 × dedicación); capacidad =
disponibilidad del año × 8 × días hábiles del mes. Rojo si horas > capacidad; ámbar entre
el 85 % y el 100 %. Sin la precondición de "distintas cuentas": el solapamiento es el modelo,
lo que se controla es el total. Toca `src/rules.ts` (nueva `checkCargaMensual`, se retira
`checkRule2` y `limiteDeCarga`), `src/types.ts` (`TipoRegla`), y
`src/components/ResumenEjecutivo.tsx` línea ~38 (`REGLA_NOMBRE` está tipado con las claves
viejas y se rompe con una regla nueva).

**A4. Regla de tope de salidas por mes.** Cuenta `salidas_en_vivo_propuestas` más
`salidas_en_vivo_fuera_del_plan` por mes; rojo si supera `tope_salidas_en_vivo_por_mes`,
salvo tres con dos de tier chico. Nueva función en `src/rules.ts`.

**A5. Regla de margen y blackout.** Para cada cuenta: días hábiles entre el fin de su
última fase de Pruebas y el corte de novedades del mes de salida (corregido hacia atrás por
fin de semana y feriado). Rojo si < 5. Y rojo si una fase de Configuración toca el rango de
`tiers_v3.blackout_config`. Nueva función en `src/rules.ts`; reutiliza `feriadosDeConfig`.

**A6. Regla 3 solo para Configuración → Pruebas, con mensaje legible.** Se mantiene la
dependencia dura, se saca la condición de "misma persona" (la dependencia es de la cuenta,
no de quién la hace), y el mensaje pasa a "Las pruebas de TIM arrancan el 28/09, antes de
que cierre su configuración (01/10)". Toca `checkRule3`.

**A7. Mensajes para un gerente.** Todas las violaciones nombran cuenta, fase y fecha en
castellano; ninguna muestra un id. Es la convención que el propio `CLAUDE.md` del repo pide
en §8 y no se cumple.

### Bloque B: la pestaña "Equipo" para los stakeholders

Hoy la pestaña Insights responde "¿cómo avanza la migración?" (trimestres, ola, cartera).
Falta la que responde **"¿qué le pasa al equipo de payroll?"**. Propuesta: una tercera
pestaña, "Equipo", con cuatro vistas. Nuevo componente `src/components/Equipo.tsx` con su
lógica en `src/insightsEquipo.ts` (misma separación que Insights/insightsMigracion).

**B1. Horas por persona por mes contra capacidad.** Barras por mes (sep-26 → abr-27) para
Willy, Moni y Gaby, con la línea de capacidad de cada uno dibujada encima. Es el bloque 6
del mockup 2, recalculado en vivo cuando se mueve algo. El pico de enero de Willy queda a la
vista sin que nadie lo tenga que buscar. Usa el mismo cálculo que A3.

**B2. El solapamiento explicado.** Debajo de cada mes, la lectura en prosa de qué hay
superpuesto y cuánto suma: "Diciembre: Willy configura Copetro y Campari a la vez, 77 h de
96. Moni carga las dos en Axton, 42 h de 80." Es la respuesta directa a "hoy aparece como
alerta y no es cierto": deja de ser alerta y pasa a ser la descripción del plan, con la
alerta solo si el total pasa la capacidad.

**B3. Quién hace qué en cada cuenta.** Por cuenta, una fila con sus fases apiladas por
persona y el bloque de Moni corriendo adentro del de Willy, como está previsto. Con el
tier, el mes de salida y el corte de novedades al costado. Reemplaza y amplía el
"Quién hace cada cuenta" actual de Insights.

**B4. La franja de salidas.** Una fila por mes con las cuentas que salen en vivo, cuántas
caben (tope) y el margen de cada una en días hábiles. Verde si todas ≥ 5, rojo si alguna
queda corta o si el mes se pasa del tope. Es la tabla de Notion, viva.

### Bloque C: simplificar la barra y las filas

**C1. Barra de dos filas a una.** Dejar a la vista: zoom (Días/Semanas/Meses/Trimestres),
Hoy, Deshacer, Resumen, Importar/Exportar y el chip de estado. Mover a "Más": alturas de
fila, Flexible/Estricto, Carga semanal, Dependencias, Expandir, Planificar pendientes,
Vaciar, Reset. **Sacar**: la perilla "Inicio Toyota" y sus presets (TASA no está en el plan;
la perilla sin cuenta crea fases huérfanas), y "Recalcular duraciones" mientras pise las
dedicaciones del JSON. Toca `src/components/ConfigPanel.tsx` y `src/uiStore.ts`.

**C2. Filas sin carga ocultas por default.** Susi, Leo, Lau y Axton tienen cero fases en v3
y ocupan cuatro carriles vacíos. El menú de personas ya existe (`MenuPersonas.tsx`); alcanza
con arrancar con las personas sin fases ocultas y una opción "Ver todas". Toca
`src/uiStore.ts` (estado inicial de `personasOcultas`).

**C3. Tier visible en lugar de "complejidad sin definir".** El pill del `DetailPanel` y el
badge del `AccountRail` muestran chica / estándar / grande leyendo `tiers_v3`. Toca
`src/components/DetailPanel.tsx`, `AccountRail.tsx`, y corrige el tipo de `complejidad` en
`src/types.ts` a `'baja' | 'media' | 'alta' | null` (hoy dice `number | null` y el código
compara contra `'baja'`).

### Bloque D: higiene que evita accidentes

**D1. Validar el JSON al importar.** Chequeo de forma (las cuatro claves raíz, las
sub-claves obligatorias de `config`, tipos de cada campo) y de referencias (`persona_id`,
`proyecto_id` y `predecesoras` existentes). Resultado: un cartel con qué entró, qué faltó y
qué claves se ignoraron, en vez de "Archivo JSON inválido" o pantalla en blanco. Toca
`src/store.ts importarJSON` y `src/components/ConfigPanel.tsx handleImport`. Librería
sugerida: Zod (define la forma esperada y devuelve errores legibles); pesa poco y no hay
nada parecido en el proyecto.

**D2. Fases con persona inexistente en una fila "Sin asignar"**, en vez de invisibles.
Toca `src/components/Timeline.tsx`.

**D3. Corregir `tim-repaso` en el JSON v3** (arranca antes de su corrida). Es un cambio de
datos en `Proyecto/planmigracion-v3-propuesta.json`.

**D4. Actualizar `CLAUDE.md` y archivar `docs/spec.md` y `docs/metodologia-fases.md`** del
repo: hoy son una trampa para cualquier chat que arranque leyéndolos. El `CLAUDE.md` nuevo
tiene que decir que el modelo son tres fases, que las reglas son las de la sección 3 de este
documento, y que `specs/` es la fuente de verdad.

**D5. Correr los tests en el deploy.** Agregar `npm test` al workflow antes del build.
`test/` ya existe; el motor de reglas nuevo tiene que llegar con sus tests.

---

## 5. Orden de construcción

1. **A1 → A2 → A3 → A4 → A5 → A6/A7** en un solo tramo. Al terminar, la app importa el v3
   tal cual y muestra cero conflictos salvo los reales (esperados: ninguno de tope, ninguno
   de margen, y hay que ver si enero de Willy pasa los 96 h con la regla mensual).
2. **B1 → B4 → B2 → B3.** Primero los números, después la prosa.
3. **C1 → C2 → C3.**
4. **D1 → D2 → D5 → D4.** D3 se hace hoy, en el JSON, sin esperar a nada.

Cada tramo es un PR contra `main` del repo, deploy automático a Pages, y se verifica en el
navegador importando el v3 antes de dar por cerrado.

---

## 6. Decisiones que tiene que tomar Willy antes del detalle técnico

1. **Qué significa `dedicacion_pct`.** Opción recomendada: fracción de una jornada de 8 h
   (0,6 = 4,8 h por día). Es la lectura que usó el mockup 2 para llegar a 425/276/371 h y a
   los 98 h de enero, y la única que permite detectar un pico. La alternativa (fracción del
   tiempo de migración de la persona) nunca puede dar sobrecarga por construcción.
2. **Granularidad del control de carga.** Recomendado: **mes** como regla dura (rojo) y
   semana solo como aviso (ámbar), porque los documentos hablan en horas por mes y una
   regla semanal llena el tablero de rojo con un promedio mensual holgado.
3. **Capacidad de Moni.** Su piso de soporte sigue en `null`. Mientras no se mida, la app
   usa su disponibilidad (0,8 en 2026, 0,6 en 2027) y lo dice en pantalla como supuesto.
   ¿Alcanza, o se espera la medición de la semana de registro antes de mostrarla?
4. **Si la pestaña "Equipo" reemplaza a "Insights" o convive.** Recomendado: convive.
   Insights responde a gerencia ("cuándo terminamos"); Equipo responde al equipo ("qué me
   toca y cuándo").

---

## 7. Lo que queda afuera a propósito

TASA/Toyota y TPA. Escenarios A/B guardados. Redo. Multiplicador por entidades (Lowsedo ×3,
Carrier ×2): el plan v3 ya lo absorbe con el tier "grande". Conexión con monday. Cualquier
regla de piso de soporte hasta que exista el número.
