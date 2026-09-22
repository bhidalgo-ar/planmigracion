import { addMonths, endOfMonth, startOfMonth } from 'date-fns'
import { parseDate } from './utils/dates'
import { UMBRAL_AMBAR, type CargaDiaria, type CargaSemanal } from './capacidad'

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

/** Alto de una fila de la banda. El círculo de carga vive centrado adentro. */
export const BANDA_ROW = 30
/** Diámetro del círculo de carga (22/09/2026, reemplaza la barra apilada — ver `celdasSemana`). */
export const BANDA_DOT = 22

/** % de uso para mostrar en el círculo, redondeado. `null` si no hay capacidad contra qué medir. */
export function pctDeCarga(horas: number, capacidad: number): number | null {
  if (capacidad <= 0) return null
  return Math.round((horas / capacidad) * 100)
}

// ── Celdas de la banda de carga, una forma por nivel de zoom ────────────────────────────────
//
// La banda sigue el mismo selector de escala que el Gantt (Días / Semanas / Meses /
// Trimestres): a nivel Día, un círculo por día hábil; a nivel Semana (el de siempre), uno
// por semana; a Mes y Trimestre, uno por mes — Willy no pidió un cuarto nivel para
// trimestre, así que cae en el mismo agrupado que Mes.

export interface CeldaBandaCarga {
  /** Fecha ISO que ancla la celda: el día, el lunes de la semana, o el 1° del mes. */
  fecha: string
  horas: number
  capacidad: number
  /** Horas por barra (id de asignación), para el detalle al hacer clic. */
  porBarra: Record<string, number>
  /**
   * Solo en celdas de mes: alguna semana adentro llegó a rojo aunque el promedio del mes no
   * lo diga (Willy, 22/09/2026: "mes = promedio, con warning si alguna semana se pasa").
   */
  alerta?: boolean
}

export function celdasSemana(semanal: CargaSemanal[]): CeldaBandaCarga[] {
  return semanal.map(c => ({ fecha: c.semana, horas: c.horas, capacidad: c.capacidad, porBarra: c.porBarra }))
}

export function celdasDia(diaria: CargaDiaria[]): CeldaBandaCarga[] {
  return diaria.map(c => ({ fecha: c.dia, horas: c.horas, capacidad: c.capacidad, porBarra: c.porBarra }))
}

/**
 * Agrupa las semanas en meses: horas y capacidad sumadas del mes (para el % promedio) y
 * `alerta` si alguna semana individual llegó a rojo, aunque el promedio no llegue.
 */
export function celdasMes(semanal: CargaSemanal[]): CeldaBandaCarga[] {
  const porMes = new Map<string, CargaSemanal[]>()
  for (const c of semanal) {
    const mes = c.semana.slice(0, 7)
    const grupo = porMes.get(mes)
    if (grupo) grupo.push(c); else porMes.set(mes, [c])
  }
  return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, grupo]) => {
    const porBarra: Record<string, number> = {}
    for (const c of grupo) for (const [id, h] of Object.entries(c.porBarra)) porBarra[id] = (porBarra[id] ?? 0) + h
    return {
      fecha: `${mes}-01`,
      horas: grupo.reduce((s, c) => s + c.horas, 0),
      capacidad: grupo.reduce((s, c) => s + c.capacidad, 0),
      porBarra,
      alerta: grupo.some(c => estadoDeCarga(c.horas, c.capacidad) === 'rojo'),
    }
  })
}
