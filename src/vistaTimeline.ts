import { addMonths, endOfMonth, startOfMonth } from 'date-fns'
import { parseDate } from './utils/dates'
import { UMBRAL_AMBAR } from './capacidad'

/**
 * Geometría de la vista del timeline: el rango del eje de tiempo y la banda de carga semanal.
 * Vive acá y no dentro del componente porque es aritmética pura (sin React, sin DOM) y así
 * se puede testear: `test/vista-timeline.test.ts`.
 */

/**
 * Rango del eje de tiempo: arranca donde arranca el plan y termina donde termina, no en el
 * horizonte del JSON (spec 2026-09-22, §3). Con el plan v3 el horizonte declara jun 2026 →
 * oct 2027 y las barras van de sep 2026 a abr 2027: diez meses de calendario vacío que se
 * scrolleaban igual.
 *
 * Lo que NO se comprime son los meses vacíos del MEDIO: en un Gantt la distancia entre dos
 * barras es el tiempo que pasa entre ellas, y apretar los huecos internos haría que dos
 * cuentas separadas por tres meses se vean pegadas. Los del medio son información.
 *
 * `hoy` siempre entra en el rango: si no, la línea de hoy y el botón 📍 apuntarían afuera.
 */
export function rangoDelEje(
  asignaciones: { inicio: string; fin: string }[],
  horizonte: { desde: string; hasta: string },
  hoy: Date,
): { desde: Date; hasta: Date } {
  const hDesde = parseDate(horizonte.desde)
  const hHasta = parseDate(horizonte.hasta)
  if (!asignaciones.length) return { desde: hDesde, hasta: hHasta }

  let min = asignaciones[0].inicio
  let max = asignaciones[0].fin
  for (const a of asignaciones) {
    if (a.inicio < min) min = a.inicio
    if (a.fin > max) max = a.fin
  }

  // Cabeza pegada al mes de la primera barra (nunca antes del horizonte declarado, que es
  // de donde salen los feriados); cola con un mes de aire para poder mover algo hacia atrás.
  let desde = startOfMonth(parseDate(min))
  if (desde < hDesde) desde = hDesde
  let hasta = endOfMonth(addMonths(parseDate(max), 1))

  if (hoy < desde) desde = startOfMonth(hoy)
  if (hoy > hasta) hasta = endOfMonth(hoy)
  // Un plan degenerado (una sola barra en el pasado) no puede dejar el eje invertido.
  if (hasta < desde) hasta = endOfMonth(desde)
  return { desde, hasta }
}

export type EstadoCarga = 'ok' | 'ambar' | 'rojo' | 'sin_capacidad'

/**
 * Color de una semana de la banda: **por porcentaje de capacidad**, no por orden de apilado.
 *
 * Hasta el 22/09/2026 la banda pintaba cada tramo con un gris distinto según su posición en
 * la pila (`--t1`, `--t2`, `--t3`), así que una semana al 40 % y una al 100 % se veían
 * idénticas y el único indicio de sobrecarga era un número naranja arriba del 110 %. El
 * `CLAUDE.md` decía "verde / ámbar / rojo por % de su capacidad" desde el principio: esto lo
 * hace cierto.
 *
 * Los umbrales son los mismos que usan la pestaña Equipo (por mes) y la curva de ocupación
 * del modo persona (por semana): `UMBRAL_AMBAR` para el aviso, pasarse de capacidad para el
 * rojo. Un mismo % de uso se ve del mismo color en las tres vistas.
 *
 * Capacidad 0 son vacaciones o una persona sin disponibilidad ese mes: no es 0 % de uso, es
 * una semana en la que no hay contra qué medir, y se dibuja distinto.
 */
export function estadoDeCarga(horas: number, capacidad: number): EstadoCarga {
  if (capacidad <= 0) return horas > 0 ? 'sin_capacidad' : 'ok'
  const uso = horas / capacidad
  if (uso > 1 + 1e-9) return 'rojo'
  if (uso >= UMBRAL_AMBAR) return 'ambar'
  return 'ok'
}

/** Alto de una fila de la banda y de sus piezas. La etiqueta del % tiene lugar propio arriba. */
export const BANDA_ROW = 28
/** Franja reservada arriba de cada fila para el % de las semanas ámbar y rojas. */
export const BANDA_ETQ = 9
/** Alto de la caja de una barra: el 100 % de capacidad. Nada dibuja más alto que esto. */
export const BANDA_BAR_H = BANDA_ROW - BANDA_ETQ - 2

/**
 * Alto en píxeles de la barra de una semana, y cuánto sobresale del techo.
 *
 * La versión vieja clampeaba a `1.6 × hMax`, con dos problemas: un tramo podía dibujar 15 px
 * FUERA de su fila y pisar la de al lado (el clamp era por tramo y las alturas se acumulaban,
 * así que con varias cuentas en la misma semana el desborde era mayor), y una semana al 160 %
 * se veía igual que una al 300 %. Acá la barra nunca pasa de `BANDA_BAR_H`: el exceso se dice
 * con un tope saliente de 2 px y con el número, no invadiendo la fila del vecino.
 */
export function altoDeBarra(horas: number, capacidad: number): { alto: number; excedida: boolean } {
  if (capacidad <= 0) return { alto: horas > 0 ? BANDA_BAR_H : 0, excedida: horas > 0 }
  const uso = horas / capacidad
  return { alto: Math.min(1, uso) * BANDA_BAR_H, excedida: uso > 1 + 1e-9 }
}
