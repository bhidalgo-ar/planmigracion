import { addMonths, endOfMonth, startOfMonth } from 'date-fns'
import { parseDate } from './utils/dates'
import { UMBRAL_AMBAR, type CargaDiaria, type CargaSemanal } from './capacidad'
import type { Asignacion, TipoFase } from './types'

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

/**
 * Alto de una fila de la banda de carga. Desde el 20/10/2026 (opción C del mockup) cada celda
 * es una columna apilada por tipo de trabajo con el % arriba, así que la fila creció de 30 a
 * 64 px. Willy puso el techo en 76: no se usó entero para que la banda no se coma la pantalla
 * con cuatro personas.
 */
export const BANDA_ROW = 64
/** Lugar arriba de la columna para el % (o las "N h" sin dueño de una semana de vacaciones). */
export const BANDA_PCT_H = 12
/** Aire debajo de la columna. */
export const BANDA_PIE = 3
/**
 * Alto del área de la columna y altura de la línea del 100 %: la línea va al 72 % del área,
 * así una semana hasta ~139 % de su capacidad se ve entera antes de recortarse.
 */
export const BANDA_AREA = BANDA_ROW - BANDA_PCT_H - BANDA_PIE
export const BANDA_Y100 = Math.round(BANDA_AREA * 0.72)

/** Alto máximo de una fila de cuenta (opción A, 20/10/2026): una sola línea, nunca crece. */
export const FILA_CUENTA_MAX = 52

/** Tipos de trabajo que apila la columna de carga, de abajo hacia arriba. Vacaciones no es carga. */
export const TIPOS_CARGA: TipoFase[] = ['Relevamiento', 'Configuracion', 'Pruebas', 'Cierre', 'Liquidacion en vivo']

/**
 * Horas de una celda por tipo de trabajo, en el orden de `TIPOS_CARGA` y sin los ceros. `tipoDe`
 * dice el tipo de cada barra; una barra que no está en el mapa (no debería pasar) se ignora.
 */
export function horasPorTipo(porBarra: Record<string, number>, tipoDe: ReadonlyMap<string, TipoFase>): Array<[TipoFase, number]> {
  const suma = new Map<TipoFase, number>()
  for (const [id, h] of Object.entries(porBarra)) {
    const t = tipoDe.get(id)
    if (!t || !(h > 0)) continue
    suma.set(t, (suma.get(t) ?? 0) + h)
  }
  return TIPOS_CARGA.filter(t => suma.has(t)).map(t => [t, suma.get(t)!])
}

/**
 * Alto en px de cada tramo de la columna. La escala es la capacidad de la celda (100 % =
 * `BANDA_Y100`); si la celda no tiene capacidad (vacaciones), se usa `capRef`, la capacidad
 * típica de esa persona en una celda de ese tamaño, para que las horas sin dueño se vean igual.
 * La suma se recorta al área: lo que se pasa lo dice el % de arriba.
 */
export function tramosDeColumna(
  porTipo: Array<[TipoFase, number]>, capacidad: number, capRef: number,
): Array<{ tipo: TipoFase; alto: number }> {
  const base = capacidad > 0 ? capacidad : capRef
  if (!(base > 0)) return []
  const escala = BANDA_Y100 / base
  const out: Array<{ tipo: TipoFase; alto: number }> = []
  let usado = 0
  for (const [tipo, h] of porTipo) {
    const alto = Math.min(h * escala, BANDA_AREA - usado)
    if (alto <= 0) break
    out.push({ tipo, alto })
    usado += alto
  }
  return out
}

// ── Filas de cuenta (opción A, 20/10/2026) ──────────────────────────────────────────────────

/** Id de fila del Timeline por cuenta para una cuenta fuera del plan ('POF' → 'fuera:POF'). */
export const filaFueraDelPlan = (cuenta: string) => `fuera:${cuenta}`

/**
 * La liquidación en vivo de una cuenta como UNA barra: del primer inicio al último fin de sus
 * asignaciones (una por persona). Clave: el id de la cuenta, o `fuera:<alias>` para las de
 * `cuenta_fuera_plan`. Las que no tienen ni cuenta ni alias no se agrupan.
 */
export function liquidacionesEnVivo(asignaciones: Asignacion[]): Map<string, { inicio: string; fin: string; asigs: Asignacion[] }> {
  const out = new Map<string, { inicio: string; fin: string; asigs: Asignacion[] }>()
  for (const a of asignaciones) {
    if (a.tipo !== 'Liquidacion en vivo') continue
    const clave = a.proyecto_id ?? (a.cuenta_fuera_plan ? filaFueraDelPlan(a.cuenta_fuera_plan) : null)
    if (!clave) continue
    const g = out.get(clave)
    if (!g) out.set(clave, { inicio: a.inicio, fin: a.fin, asigs: [a] })
    else {
      if (a.inicio < g.inicio) g.inicio = a.inicio
      if (a.fin > g.fin) g.fin = a.fin
      g.asigs.push(a)
    }
  }
  return out
}

/**
 * El Cierre de la cuenta (delta + aplica, o la Actualización Final de planes viejos) como un
 * solo hito: la fecha es la del último, que es el aplica. null si la cuenta no tiene Cierre.
 */
export function hitoDeCierre(asigs: Asignacion[]): { fecha: string; asigs: Asignacion[] } | null {
  const cierres = asigs.filter(a => a.tipo === 'Cierre' && !a.es_bloqueo)
  if (!cierres.length) return null
  const fecha = cierres.reduce((m, a) => (a.fin > m ? a.fin : m), cierres[0].fin)
  return { fecha, asigs: cierres }
}

/** 'h/día' legible: 2 → '2', 1.5 → '1,5'. */
export function horasDiaLegible(h: number): string {
  const r = Math.round(h * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',')
}

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
