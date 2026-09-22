# Espacio en pantalla y legibilidad — SPEC

> 22/09/2026. Decidido con Willy sobre la app desplegada (`bhidalgo-ar.github.io/planmigracion`)
> y verificado contra `main` en el commit `83ef524` (PR #31 ya adentro).
>
> **Objetivo en una frase**: que la pantalla muestre el plan y no los controles, y que la carga
> de trabajo del equipo se entienda de un vistazo. No es un rediseño estético: es sacar lo que
> no se usa y arreglar una banda que hoy no comunica lo que dice comunicar.

---

## 1. Qué se queda y qué se va (decidido, no a discutir)

Willy revisó los 18 controles de la barra uno por uno. El resultado:

| Control | Decisión |
|---|---|
| Zoom (desplegable) | **queda visible** — ver §6, pregunta abierta |
| Por cuenta / Por persona | **queda visible** — ver §6, pregunta abierta |
| 📍 Hoy | **queda visible** — ver §6, pregunta abierta |
| 👥 Personas | **a opciones** |
| ↩ Deshacer | **a opciones** (el atajo Ctrl+Z se mantiene) |
| 🧭 Replanificar | **a opciones** |
| ↑ Importar | **a opciones** |
| ↓ Exportar | **a opciones** |
| 📄 Resumen PDF | **a opciones** |
| Alto de fila | **sube a la barra** — se usa |
| Expandir timeline | **sube a la barra** — se usa |
| Al mover (Flexible / Estricto) | a opciones (ya está ahí) |
| Resaltar conflictos | a opciones (ya está ahí) |
| Carga semanal | a opciones (ya está ahí) |
| Dependencias | a opciones (ya está ahí) |
| 🪄 Planificar pendientes | a opciones (ya está ahí) |
| 🗑 Vaciar asignaciones | a opciones (ya está ahí) |
| ↺ Reset | a opciones (ya está ahí) |

Y fuera de la barra:

- **IntroBar** (el párrafo explicativo de cada pestaña): **se saca**. Willy no la lee.
  El texto no se borra: pasa al modal "Cómo se armó este plan", que ya existe y ya se abre
  desde ahí. En la barra queda un solo acceso.
- **AccountRail** (la columna de cuentas de la izquierda, 218 px): **a opciones**. Willy no la
  lee, y muestra lo mismo que la columna de nombres del timeline, a 20 px de distancia.
- **DetailPanel** (el panel de la derecha, 336 px): **pasa a on-demand**. Ver §6: hay una
  distinción importante que hay que confirmar antes de tocarlo.

**Regla de "a opciones"**: nada se borra. Todo lo que sale de la barra vive en el menú "···",
que es el mismo mecanismo que ya existe. Un control escondido sigue siendo un control.

---

## 2. Lo que esto recupera

Medido sobre el código, en una notebook de 1366 px de ancho (el caso peor real).

**A lo ancho**, en la vista Timeline hoy hay **730 px fijos** antes de que se dibuje un solo
día del calendario:

| Pieza | Ancho |
|---|---|
| AccountRail | 218 px |
| Columna de nombres del timeline (`NAME_W`) | 176 px |
| DetailPanel | 336 px |

Al Gantt le quedan **636 px**: menos de la mitad de la pantalla es el plan.

Con AccountRail en opciones y el DetailPanel on-demand, quedan **176 px fijos** y el Gantt
pasa a **1190 px**. Es **+87 % de calendario visible** sin comprar un monitor.

**A lo alto** hoy hay **172 px** de barras apiladas antes del contenido:

| Pieza | Alto |
|---|---|
| Header (logo, pestañas, tema) | 56 px |
| Barra de herramientas | 45 px |
| IntroBar | 40 px |
| PanelInsights (al pie) | 31 px |

Sacando la IntroBar y fusionando la barra de herramientas con el header (le sobra lugar: con
seis controles en vez de dieciocho, entran en la misma línea que las pestañas), queda en
**87 px**. Son **85 px menos de chrome**, la mitad.

---

## 3. El eje de tiempo arranca donde arranca el plan

Hoy el timeline dibuja meses vacíos a la izquierda y a la derecha del plan.

- **Cabeza**: el eje arranca en **1/9/2026**, no antes.
- **Cola**: el eje termina en el fin de la última barra del plan más un mes de aire, no en un
  horizonte fijo.

**Lo que NO se hace**: recortar meses vacíos *del medio*. En un Gantt el eje X es tiempo lineal
y la distancia entre dos barras significa cuánto tiempo pasa entre ellas. Si se comprimen los
huecos internos, dos cuentas separadas por tres meses se ven pegadas y el tablero empieza a
mentir sobre el plan. Los meses vacíos del medio se quedan; son información.

---

## 4. La banda de carga: el diagnóstico

Willy: *"sigue sin entenderse mucho la carga de trabajo"*. No es una impresión. Miré el código
(`Timeline.tsx:884-899`) y la banda tiene cuatro problemas concretos.

**4.1 El color no dice carga.** El `CLAUDE.md` del repo dice que la banda muestra
"verde / ámbar / rojo por % de su capacidad". **El código no hace eso.** Los tramos se pintan
por *orden de apilado*:

```
fondo = esSeleccionada ? celeste : k === 0 ? --t1 : k === 1 ? --t2 : k === 2 ? --t3 : --line
```

O sea: grises por posición en la pila. Una semana al 40 % y una al 100 % se ven **exactamente
igual**. Eso es lo que se ve en la captura: tres filas de barras azul marino uniformes. El
único indicio de sobrecarga es un `%` naranja que aparece recién arriba del 110 %.

**4.2 La altura miente y se desborda.**

```
alto = Math.min(hMax * 1.6, hMax * (h / c.capacidad))
```

`hMax` es 26 px (`BANDA_ROW` 34 menos 8). El tope es 1,6 × eso = **41 px**, o sea que un tramo
puede dibujar 15 px **fuera de su propia fila** y pisar la de al lado. Además, al estar
clampeado a 1,6, una semana al 160 % y una al 300 % se ven iguales. Los tramos que se pisan
entre Moni, Gaby y Guille en la captura son esto.

**4.3 Texto de 7,5 px.** El nombre de la cuenta se escribe adentro del tramo a `fontSize: 7.5`.
No es chico: es ilegible. El piso para texto en pantalla son 9-10 px, y acá encima va cortado
con ellipsis dentro de pocos píxeles de ancho.

**4.4 Tres codificaciones compitiendo, ninguna es la que se busca.** Altura = carga,
gris = orden de apilado, naranja = exceso. La pregunta que la banda tiene que contestar en un
segundo es *"¿alguien está pasado esta semana?"*, y para eso hay que leer alturas relativas
contra una capacidad que no está dibujada.

---

## 5. La banda de carga: la propuesta

Una barra por persona y por semana. El estado primero, la atribución después.

1. **Color por estado, con los umbrales que ya existen en el plan.** Verde por debajo del
   90 %, ámbar entre 90 % y `aviso_semanal_tolerancia` (1,10 en el seed), rojo por encima.
   Son los mismos umbrales que usa `rules.ts` para la regla `carga_semana`, así que la banda
   y las alertas dicen lo mismo — hoy pueden discrepar.
2. **Línea de capacidad dibujada al 100 %**, cruzando la fila de lado a lado. Así se ve dónde
   está el techo sin leer un número, que es lo que ya hace bien la pestaña Equipo.
3. **La altura se clampea al alto de la fila**, y el exceso se marca con un tope rojo saliente
   de 2 px en vez de desbordando. Nunca más una barra pisando la fila de al lado.
4. **Nada de texto adentro de la barra.** Se va el nombre de cuenta a 7,5 px.
5. **El % se escribe solo en ámbar y rojo.** En verde no hace falta: el color ya lo dijo.
6. **La atribución por cuenta se conserva, pero a demanda.** Dos caminos, los dos ya
   construidos: el `title` de la barra ya lista las horas por cuenta, y cuando hay una cuenta
   seleccionada en el timeline, su tramo dentro de la barra se resalta. Así se contesta
   "¿qué cuenta causa el pico?" sin sacrificar "¿hay un pico?".
7. **`BANDA_ROW` baja de 34 a 28 px**: sin texto adentro no necesita tanto alto. Son 18 px más
   de calendario con tres personas en pantalla.

**El trade-off, explícito**: hoy la banda intenta mostrar el apilado por cuenta a primera
vista, y por eso usa grises por orden en vez de color por estado. La propuesta invierte la
prioridad: estado a primera vista, atribución al hover o al seleccionar. Si la atribución
inmediata importa más que el estado, esto hay que discutirlo antes de construirlo — pero
entonces el color tiene que salir del apilado y entrar en otro canal, porque las dos cosas
no caben en el mismo.

---

## 6. Preguntas abiertas (contestar antes de construir)

**6.1 Los tres controles que no se respondieron.** Zoom, Por cuenta / Por persona y 📍 Hoy
quedaron sin marcar en la revisión. Asumí que **se quedan visibles**: son los toggles de vista
que se tocan durante una reunión y cuestan poco espacio. Si también van a opciones, la barra
queda con dos controles (Alto de fila y Expandir timeline) y conviene fusionarla con el header.

**6.2 El DetailPanel — esta es la importante.** Willy dijo: *"la de asignaciones por tarea
ahora lo hago en Claude no en la app"*. El panel de la derecha tiene **dos cosas distintas**
adentro:

- Las **FaseCard** (asignaciones por tarea: quién hace qué, duración, dedicación). Esto es lo
  que Willy hace en Claude. Se puede ir a opciones sin costo.
- El **BloqueSalida** ("Sale en vivo"): la tira de meses candidatos pintada según qué pasaría.
  Según el `CLAUDE.md`, **mover una cuenta es cambiar su mes de salida**, y esta tira es *el*
  mecanismo para hacerlo. Si se va a opciones, se esconde la interacción principal del tablero.

**Propuesta**: el panel no desaparece ni se esconde, pasa a **on-demand**. Cerrado por
defecto (0 px), se abre al hacer clic en una cuenta y se cierra al deseleccionar. Así se
recuperan los 336 px cuando no se está moviendo nada, y la tira de meses sigue a un clic.
Las FaseCard, adentro del panel, arrancan colapsadas.

Confirmar: ¿el panel entero a opciones, o on-demand con las FaseCard colapsadas?

---

## 7. Orden de trabajo

Un PR por paso, con sus tests, verificando en el navegador con el plan v3 antes de cerrar.

1. **La barra y la IntroBar.** Es el más barato y el más visible: seis controles arriba, el
   resto en "···", la IntroBar afuera. Recupera 85 px de alto sin tocar ninguna lógica.
2. **El eje de tiempo desde el 1/9.** Cambio chico y acotado a `Timeline.tsx`.
3. **La banda de carga.** El de más valor y el que más criterio necesita. Va después de
   contestar §6.2, porque si el DetailPanel cambia de ancho, la banda se redibuja igual.
4. **AccountRail a opciones y DetailPanel on-demand.** Los 554 px de ancho. Último porque es
   el que más toca el layout de `App.tsx` y conviene hacerlo con los otros tres ya estables.

**No se toca en ninguno de los cuatro**: los colores de fase, los carriles por fila, la
matemática de `capacidad.ts`, las reglas, el bloque confidencial ni el contrato del JSON.

---

## 8. Lo que quedó afuera a propósito

De la crítica de minimalismo del 22/09/2026 (`../2026-09-22-critica-diseno-minimalismo.md`)
hay treinta hallazgos más, verificados uno por uno contra este mismo commit. No entran acá
porque son otro problema: el de esa lista es que **la app no tiene escala tipográfica** — 236
declaraciones de `fontSize` inline en 14 componentes y cero tokens, contra un sistema de
color, radio y sombra que sí está bien armado. Eso se resuelve con tokens, no con borrados, y
es un tramo de trabajo propio.

Un hallazgo de esa crítica **no hay que aplicar**: sacar los glifos ⚠ y ✓ para dejar solo el
color. Deja el color como único canal de significado, que es exactamente lo que falla para
quien tiene daltonismo, y va contra el criterio del resto del código (los tokens de gráfico
están validados por separación CVD y contraste).
