import { parseISO, addDays, startOfWeek, format, addWeeks } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Config } from '../types'

export function parseDate(s: string): Date {
  return parseISO(s)
}

export function toISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function formatFecha(d: Date | string): string {
  const date = typeof d === 'string' ? parseISO(d) : d
  return format(date, "d MMM yyyy", { locale: es })
}

export function formatFechaCorta(d: Date | string): string {
  const date = typeof d === 'string' ? parseISO(d) : d
  return format(date, "d MMM", { locale: es })
}

export function getMondayOfWeek(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 })
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6
}

/** Set de feriados vacío, para los call-sites que no reciben `config` (hábil = solo lun-vie). */
const SIN_FERIADOS: ReadonlySet<string> = new Set()

/** Feriados nacionales configurados (todos los años cargados) como Set de fechas ISO. */
export function feriadosDeConfig(config: Config): Set<string> {
  return new Set([
    ...config.feriados_nacionales_2026,
    ...(config.feriados_nacionales_2027 ?? []),
  ].map(f => f.fecha))
}

function esHabil(d: Date, feriados: ReadonlySet<string>): boolean {
  return !isWeekend(d) && !feriados.has(toISO(d))
}

function nextWorkingDay(d: Date, feriados: ReadonlySet<string>): Date {
  let result = new Date(d)
  while (!esHabil(result, feriados)) {
    result = addDays(result, 1)
  }
  return result
}

/**
 * Día hábil siguiente a `fechaISO` (nunca la misma fecha). Es el handoff correcto entre
 * fases: Pruebas arranca el día hábil siguiente al fin de Configuración, sin esperar
 * al lunes de la semana que viene (lo que costaba hasta 4 días hábiles por fase).
 */
export function siguienteDiaHabil(fechaISO: string, feriados: ReadonlySet<string> = SIN_FERIADOS): string {
  return toISO(nextWorkingDay(addDays(parseISO(fechaISO), 1), feriados))
}

/**
 * Disponibilidad de una persona para migración en un año dado: la fracción de la jornada
 * de 8 hs que le dedica. Sale de `config.disponibilidad` (perilla). Si la persona o el año
 * no están en la tabla, cae al `default` de la tabla y, en última instancia, a 1 (jornada
 * completa) — así un plan importado sin la tabla sigue calculando en vez de romperse.
 */
export function disponibilidadDe(personaId: string, anio: number, config: Config): number {
  const tabla = config.disponibilidad
  const porPersona = tabla?.por_persona_ano?.[personaId]
  const delAnio = porPersona?.[String(anio)]
  if (typeof delAnio === 'number') return delAnio
  return typeof tabla?.default === 'number' ? tabla.default : 1
}

export interface FinPorHoras {
  fin: string
  duracion_dias: number
  /** Promedio de disponibilidad de los días hábiles consumidos. Va a `dedicacion_pct`. */
  dedicacion_promedio: number
}

/**
 * Fin de una fase derivado de HORAS de esfuerzo, no de una duración fija: recorre día por
 * día desde `inicio`, saltea fines de semana y feriados, y por cada día hábil consume
 * `8 × disponibilidad(persona, año de ESE día)`. Termina el día en que el acumulado llega
 * a `horasObjetivo`.
 *
 * El consumo es día por día (y no "disponibilidad de la fecha de inicio para toda la fase")
 * justamente para que una fase que cruza el 31/12 use la disponibilidad de cada año: si no,
 * correr la barra un día sobre el fin de año cambiaría la duración de golpe.
 */
export function calcularFinPorHoras(
  inicio: string,
  horasObjetivo: number,
  personaId: string,
  config: Config,
  feriados: ReadonlySet<string> = SIN_FERIADOS,
): FinPorHoras {
  const horasJornada = config.unidades?.horas_por_dia ?? 8
  let dia = nextWorkingDay(parseISO(inicio), feriados)
  let horas = 0
  let dias = 0
  let sumaDisponibilidad = 0

  // Siempre consume al menos un día hábil: una fase de 0 hs igual ocupa el día que arranca.
  while (true) {
    const disp = disponibilidadDe(personaId, dia.getFullYear(), config)
    dias++
    sumaDisponibilidad += disp
    horas += horasJornada * disp
    if (horas >= horasObjetivo || dias >= MAX_DIAS_FASE) break
    dia = nextWorkingDay(addDays(dia, 1), feriados)
  }

  return {
    fin: toISO(dia),
    duracion_dias: dias,
    dedicacion_promedio: redondear2(sumaDisponibilidad / dias),
  }
}

/** Tope de seguridad: evita un bucle infinito si la disponibilidad de la persona es 0. */
const MAX_DIAS_FASE = 2000

function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Calcula la fecha fin dado un inicio (ISO) y duración en días hábiles (inclusivo). Saltea fines de semana y feriados nacionales si se pasa `feriados`. */
export function calcularFin(inicio: string, duracionDias: number, feriados: ReadonlySet<string> = SIN_FERIADOS): string {
  let d = nextWorkingDay(parseISO(inicio), feriados)
  let count = 1
  while (count < duracionDias) {
    d = addDays(d, 1)
    if (esHabil(d, feriados)) count++
  }
  return toISO(d)
}

/** Cuenta días hábiles (lun-vie, sin feriados) inclusive entre dos fechas ISO. Mínimo 1. Inverso de calcularFin. */
export function diasHabiles(inicioISO: string, finISO: string, feriados: ReadonlySet<string> = SIN_FERIADOS): number {
  let d = parseISO(inicioISO)
  const end = parseISO(finISO)
  let count = 0
  while (d <= end) {
    if (esHabil(d, feriados)) count++
    d = addDays(d, 1)
  }
  return Math.max(1, count)
}

/** Genera todos los lunes entre dos fechas ISO. */
export function getSemanas(desde: string, hasta: string): Date[] {
  const result: Date[] = []
  let current = getMondayOfWeek(parseISO(desde))
  const end = parseISO(hasta)
  while (current <= end) {
    result.push(current)
    current = addWeeks(current, 1)
  }
  return result
}

/** Índice (0-based) de la semana en la que cae una fecha, relativo a una semana inicial. */
export function semanaIndex(fecha: string, desdeLunes: Date): number {
  const lunes = getMondayOfWeek(parseISO(fecha))
  const diffMs = lunes.getTime() - desdeLunes.getTime()
  return Math.floor(diffMs / (7 * 24 * 3600 * 1000))
}

/** Verifica si dos rangos de fechas se solapan (inclusive). */
export function seSuperponen(inicio1: string, fin1: string, inicio2: string, fin2: string): boolean {
  return inicio1 <= fin2 && fin1 >= inicio2
}
