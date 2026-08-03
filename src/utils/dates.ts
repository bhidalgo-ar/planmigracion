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
