import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config } from './types'
import { getMondayOfWeek, toISO } from './utils/dates'

/**
 * Cuentas abiertas en paralelo, contadas para TODO el equipo (Willy, 23/10/2026): "no estamos
 * trabajando los tres en casi todos los proyectos y es imposible que hagamos más de cuatro a
 * la vez". No es carga en horas (eso es `capacidad.ts`): es cuántas cuentas distintas tienen
 * alguna barra activa el mismo día hábil, sin importar quién la hace ni con qué dedicación.
 *
 * Cuenta toda barra con cuenta que no sea un bloqueo: relevamiento, configuración, pruebas,
 * cierre y el acompañamiento de la primera liquidación (que en el plan es tipo Cierre). Una
 * cuenta que terminó las pruebas y espera el cierre sin barras activas no suma esos días: no
 * hay trabajo abierto.
 *
 * Aritmética pura, sin React: `test/paralelo.test.ts`.
 */

/** Tope de cuentas abiertas a la vez para el equipo. Perilla del JSON, default 4. */
export function topeParalelo(config: Config): number {
  const v = config.reglas_calendario?.max_cuentas_en_paralelo
  return typeof v === 'number' && v > 0 ? v : 4
}

function esHabilISO(iso: string, feriados: ReadonlySet<string>): boolean {
  const d = parseISO(iso).getDay()
  return d !== 0 && d !== 6 && !feriados.has(iso)
}

/** Día hábil → cuentas con alguna barra activa ese día. Solo días con al menos una cuenta. */
export function cuentasPorDia(asignaciones: Asignacion[], feriados: ReadonlySet<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const a of asignaciones) {
    if (a.es_bloqueo || !a.proyecto_id || a.tipo === 'Vacaciones') continue
    for (let d = parseISO(a.inicio); toISO(d) <= a.fin; d = addDays(d, 1)) {
      const iso = toISO(d)
      if (!esHabilISO(iso, feriados)) continue
      let s = out.get(iso)
      if (!s) { s = new Set(); out.set(iso, s) }
      s.add(a.proyecto_id)
    }
  }
  return out
}

export type NivelParalelo = 'dias' | 'semanas' | 'meses'

export interface CeldaParalelo {
  /** Fecha ISO que ancla la celda: el día, el lunes de la semana o el 1° del mes. */
  fecha: string
  /** Máximo de cuentas abiertas el mismo día dentro de la celda. */
  max: number
  /** El primer día en que se llegó a ese máximo. */
  diaPico: string
  /** Las cuentas abiertas ese día pico, ordenadas. */
  cuentas: string[]
}

/**
 * Agrupa el conteo diario en celdas del zoom del Gantt. En semana y mes el número es el
 * MÁXIMO de cuentas abiertas el mismo día, no la suma de cuentas que pasaron por la celda:
 * la pregunta es "¿cuántas tuvimos a la vez?", y una cuenta que cierra el lunes y otra que
 * arranca el viernes no estuvieron a la vez.
 */
export function celdasParalelo(porDia: Map<string, Set<string>>, nivel: NivelParalelo): CeldaParalelo[] {
  const celdas = new Map<string, CeldaParalelo>()
  const dias = [...porDia.keys()].sort()
  for (const dia of dias) {
    const cuentas = porDia.get(dia)!
    const fecha = nivel === 'dias' ? dia
      : nivel === 'semanas' ? toISO(getMondayOfWeek(parseISO(dia)))
        : `${dia.slice(0, 7)}-01`
    const actual = celdas.get(fecha)
    if (!actual || cuentas.size > actual.max) {
      celdas.set(fecha, { fecha, max: cuentas.size, diaPico: dia, cuentas: [...cuentas].sort() })
    }
  }
  return [...celdas.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
}

export type EstadoParalelo = 'ok' | 'tope' | 'pasado'

/** Verde por debajo del tope, ámbar justo en el tope, rojo si se pasa. */
export function estadoParalelo(max: number, tope: number): EstadoParalelo {
  if (max > tope) return 'pasado'
  if (max === tope) return 'tope'
  return 'ok'
}

export interface TramoPasado {
  mes: string
  /** Máximo del mes y el primer día en que se dio. */
  max: number
  diaPico: string
  cuentas: string[]
  /** Días hábiles del mes por encima del tope. */
  dias: number
}

/** Meses con algún día por encima del tope, con su pico. Alimenta la regla `paralelo`. */
export function mesesPasadosDeTope(porDia: Map<string, Set<string>>, tope: number): TramoPasado[] {
  const porMes = new Map<string, TramoPasado>()
  for (const dia of [...porDia.keys()].sort()) {
    const s = porDia.get(dia)!
    if (s.size <= tope) continue
    const mes = dia.slice(0, 7)
    const t = porMes.get(mes)
    if (!t) porMes.set(mes, { mes, max: s.size, diaPico: dia, cuentas: [...s].sort(), dias: 1 })
    else {
      t.dias++
      if (s.size > t.max) { t.max = s.size; t.diaPico = dia; t.cuentas = [...s].sort() }
    }
  }
  return [...porMes.values()]
}
