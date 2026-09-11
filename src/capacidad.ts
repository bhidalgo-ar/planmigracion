import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona } from './types'
import { feriadosDeConfig, getMondayOfWeek, toISO } from './utils/dates'

/**
 * Modelo de capacidad del programa (brief 10/09/2026 §2). Es el ÚNICO lugar donde vive
 * la matemática de horas: la usan las reglas de carga (`rules.ts`) y la pestaña Equipo.
 * Todo en horas, todo día por día:
 *
 *   horas de una fase en un mes = días hábiles de la fase en ese mes × horas_dia × dedicacion_pct
 *   capacidad de una persona    = días hábiles del mes × horas_dia × disponibilidad(persona, mes)
 *
 * "Día hábil" = lunes a viernes menos los feriados del JSON. `horas_dia` es 7 por default
 * (jornada disponible real) y Gaby tiene 4 (jornada fija, no una fracción de 7).
 */

export const HORAS_DIA_DEFAULT = 7

/** Horas por día hábil de una persona: su `horas_dia` si lo tiene, si no el default del config. */
export function horasDiaDe(persona: Persona | undefined, config: Config): number {
  if (persona && typeof persona.horas_dia === 'number' && persona.horas_dia > 0) return persona.horas_dia
  const d = config.capacidad?.horas_dia_default
  return typeof d === 'number' && d > 0 ? d : HORAS_DIA_DEFAULT
}

/** 'YYYY-MM' de una fecha ISO 'YYYY-MM-DD'. */
export function mesDe(iso: string): string {
  return iso.slice(0, 7)
}

const RE_MES = /^\d{4}-\d{2}$/

/** Mes de salida propuesto de una cuenta ('YYYY-MM'), o null si el plan no lo trae. */
export function mesSalidaDe(proyectoId: string, config: Config): string | null {
  const v = config.salidas_en_vivo_propuestas?.[proyectoId]
  return typeof v === 'string' && RE_MES.test(v) ? v : null
}

/** Cuentas fuera del plan (ya configuradas) con su mes de salida, saltando las sin mes válido. */
export function salidasFueraDelPlan(config: Config): Array<{ nombre: string; mes: string }> {
  const cuentas = config.salidas_en_vivo_fuera_del_plan?.cuentas ?? []
  return cuentas
    .filter(c => typeof c.sale_en_vivo === 'string' && RE_MES.test(c.sale_en_vivo))
    .map(c => ({ nombre: c.alias ?? c.nombre, mes: c.sale_en_vivo }))
}

/**
 * Cuántas cuentas están en Axton al cierre de un mes: la cartera legacy (más las del
 * programa que el tablero ya muestra en vivo, ej. Coty) + las que salieron en vivo hasta
 * ese mes inclusive, tanto las propuestas como las fuera del plan.
 */
export function cuentasEnAxton(mesISO: string, config: Config): number {
  const legacy = config.cartera_legacy_axton?.cuentas?.length ?? 0
  const yaEnVivo = config.cartera_legacy_axton?.cuentas_programa_ya_en_vivo?.length ?? 0
  let salidas = 0
  for (const [id, v] of Object.entries(config.salidas_en_vivo_propuestas ?? {})) {
    if (id.startsWith('_') || typeof v !== 'string') continue
    if (v <= mesISO) salidas++
  }
  for (const c of salidasFueraDelPlan(config)) if (c.mes <= mesISO) salidas++
  return legacy + yaEnVivo + salidas
}

/**
 * Cuentas que al cierre de `mesISO` siguen en Meta 4: las del programa con mes de salida
 * posterior, las fuera del plan que todavía no salieron, y las que NO migran en este programa
 * y se quedan en Meta 4 para siempre (`soporte_tickets.meta4_no_migra`: Toyota y TPA, que
 * también soporta Susana). `mes` es cuándo sale; null = no sale nunca. `clave` es con lo que se
 * buscan sus tickets (id de proyecto o alias/nombre).
 */
export function cuentasEnMeta4(mesISO: string, config: Config): Array<{ clave: string; mes: string | null }> {
  const out: Array<{ clave: string; mes: string | null }> = []
  for (const [id, v] of Object.entries(config.salidas_en_vivo_propuestas ?? {})) {
    if (id.startsWith('_') || typeof v !== 'string' || !RE_MES.test(v)) continue
    if (v > mesISO) out.push({ clave: id, mes: v })
  }
  for (const c of salidasFueraDelPlan(config)) if (c.mes > mesISO) out.push({ clave: c.nombre, mes: c.mes })
  for (const clave of Object.keys(config.soporte_tickets?.meta4_no_migra ?? {})) out.push({ clave, mes: null })
  return out
}

function ticketsDe(clave: string, tabla: Record<string, number> | undefined): number {
  const v = tabla?.[clave]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Tickets por mes que siguen entrando por Meta 4 al cierre de `mesISO`: la suma de los tickets
 * medidos de las cuentas que todavía no salieron, dividida por los meses medidos. Una cuenta
 * sin fila en la ticketera cuenta 0 (Aysa y Ford: las lleva Outsourcing). null si el plan no
 * trae `soporte_tickets`: entonces nadie estima, la pantalla dice [FALTA].
 */
export function ticketsMeta4Restantes(mesISO: string, config: Config): number | null {
  const t = config.soporte_tickets
  if (!t || !(typeof t.meses_medidos === 'number' && t.meses_medidos > 0)) return null
  let suma = 0
  for (const c of cuentasEnMeta4(mesISO, config)) {
    suma += c.mes === null ? ticketsDe(c.clave, t.meta4_no_migra) : ticketsDe(c.clave, t.meta4_por_cuenta)
  }
  return suma / t.meses_medidos
}

/**
 * Tickets por mes de las cuentas que se quedan en Meta 4 para siempre. Es el piso del soporte
 * de Susana: por debajo de eso no baja, aunque migre todo el programa. null si no hay ticketera.
 */
export function ticketsMeta4Piso(config: Config): number | null {
  const t = config.soporte_tickets
  if (!t || !(typeof t.meses_medidos === 'number' && t.meses_medidos > 0)) return null
  let suma = 0
  for (const v of Object.values(t.meta4_no_migra ?? {})) if (typeof v === 'number' && Number.isFinite(v)) suma += v
  return suma / t.meses_medidos
}

/**
 * Tickets por mes que atiende el soporte Axton al cierre de `mesISO`: los de las cuentas que ya
 * están en Axton hoy más los que trajo cada cuenta que salió en vivo hasta ese mes (se asume
 * que una cuenta genera en Axton los mismos tickets que generaba en Meta 4).
 */
export function ticketsAxton(mesISO: string, config: Config): number | null {
  const t = config.soporte_tickets
  if (!t || !(typeof t.meses_medidos === 'number' && t.meses_medidos > 0)) return null
  let suma = 0
  for (const v of Object.values(t.axton_hoy ?? {})) if (typeof v === 'number' && Number.isFinite(v)) suma += v
  for (const [id, v] of Object.entries(config.salidas_en_vivo_propuestas ?? {})) {
    if (id.startsWith('_') || typeof v !== 'string' || !RE_MES.test(v)) continue
    if (v <= mesISO) suma += ticketsDe(id, t.meta4_por_cuenta)
  }
  for (const c of salidasFueraDelPlan(config)) if (c.mes <= mesISO) suma += ticketsDe(c.nombre, t.meta4_por_cuenta)
  return suma / t.meses_medidos
}

/** Lee un número de un valor que puede ser "[FALTA]" u otra cosa; null si no es número. */
function numeroONull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Fracción de su jornada (`horas_dia`) que una persona dedica a migración en un mes.
 * Prioridad de fuentes:
 *  1. `equipo_confidencial.dedicacion_por_mes[persona][mes].migracion` si es un número
 *     (solo existe en el JSON local de Willy).
 *  2. Moni: la fórmula del soporte Axton, que baja con cada cuenta que entra a Axton.
 *  3. Quien tiene `horas_dia` propio (Gaby): 1,0 — la reducción ya está en sus horas.
 *  4. La disponibilidad por año (`config.disponibilidad`), fallback para no romper planes viejos.
 *  5. 1,0.
 */
export function disponibilidadMes(
  personaId: string,
  mesISO: string,
  config: Config,
  cuentasAxton: number = cuentasEnAxton(mesISO, config),
  persona?: Persona,
): number {
  const conf = numeroONull(config.equipo_confidencial?.dedicacion_por_mes?.[personaId]?.[mesISO]?.migracion)
  if (conf !== null) return Math.max(0, Math.min(1, conf))

  // Susi por tickets: desde la transición toma todo el soporte Meta 4 y los tickets de hoy son
  // su día completo; cada cuenta que sale le devuelve su parte. Antes de la transición, la
  // perilla por año de abajo.
  const susi = config.capacidad?.susi_soporte_meta4
  if (susi && personaId === (susi.persona_id ?? 'susi') && typeof susi.desde === 'string' && mesISO >= susi.desde) {
    const restantes = ticketsMeta4Restantes(mesISO, config)
    if (restantes !== null && typeof susi.base_tickets_mes === 'number' && susi.base_tickets_mes > 0) {
      return Math.max(0, Math.min(1, 1 - restantes / susi.base_tickets_mes))
    }
  }

  const moni = config.capacidad?.moni_soporte_axton
  if (personaId === 'moni' && moni) {
    const disp = moni.base - moni.caida_por_cuenta * (cuentasAxton - moni.cuentas_base)
    return Math.max(moni.piso, Math.min(moni.base, disp))
  }

  if (persona && typeof persona.horas_dia === 'number' && persona.horas_dia > 0) return 1

  const porAnio = config.disponibilidad?.por_persona_ano?.[personaId]?.[mesISO.slice(0, 4)]
  if (typeof porAnio === 'number') return porAnio
  const def = config.disponibilidad?.default
  return typeof def === 'number' ? def : 1
}

function esHabil(d: Date, feriados: ReadonlySet<string>): boolean {
  const dow = d.getDay()
  return dow !== 0 && dow !== 6 && !feriados.has(toISO(d))
}

/** Días hábiles de [inicioISO, finISO] inclusive, como fechas. */
function diasHabilesEntre(inicioISO: string, finISO: string, feriados: ReadonlySet<string>): Date[] {
  const out: Date[] = []
  let d = parseISO(inicioISO)
  const fin = parseISO(finISO)
  while (d <= fin) {
    if (esHabil(d, feriados)) out.push(d)
    d = addDays(d, 1)
  }
  return out
}

export function ultimoDiaDelMes(mesISO: string): Date {
  const [y, m] = mesISO.split('-').map(Number)
  return new Date(y, m, 0)
}

export function ultimoDiaDelMesISO(mesISO: string): string {
  return toISO(ultimoDiaDelMes(mesISO))
}

/** Días hábiles de un mes 'YYYY-MM'. */
export function diasHabilesDelMes(mesISO: string, feriados: ReadonlySet<string>): number {
  return diasHabilesEntre(`${mesISO}-01`, ultimoDiaDelMesISO(mesISO), feriados).length
}

/**
 * Días hábiles en que una persona está de vacaciones, como set de fechas ISO. Salen de los
 * bloqueos `tipo: 'Vacaciones'` de esa persona. Otros bloqueos (corrida inicial,
 * supervisión) son trabajo reservado, no ausencia: no cuentan acá.
 */
export function diasDeVacaciones(personaId: string, asignaciones: Asignacion[], feriados: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const a of asignaciones) {
    if (a.persona_id !== personaId || a.tipo !== 'Vacaciones') continue
    for (const d of diasHabilesEntre(a.inicio, a.fin, feriados)) out.add(toISO(d))
  }
  return out
}

/** Horas que una fase consume en un mes dado. Los bloqueos (vacaciones) no son carga. */
export function horasFaseEnMes(
  asig: Asignacion, mesISO: string, persona: Persona | undefined, feriados: ReadonlySet<string>, config: Config,
): number {
  if (asig.es_bloqueo) return 0
  const hd = horasDiaDe(persona, config)
  const dias = diasHabilesEntre(asig.inicio, asig.fin, feriados).filter(d => mesDe(toISO(d)) === mesISO).length
  return red(dias * hd * asig.dedicacion_pct)
}

export interface CargaMensual {
  personaId: string
  /** 'YYYY-MM' */
  mes: string
  horas: number
  capacidad: number
  /** Disponibilidad usada para la capacidad de ese mes (para explicarla en pantalla). */
  disponibilidad: number
  /** Horas desglosadas por cuenta (proyecto_id). Alimenta la prosa de la pestaña Equipo. */
  porCuenta: Record<string, number>
}

export interface CargaSemanal {
  personaId: string
  /** Lunes ISO de la semana. */
  semana: string
  horas: number
  capacidad: number
}

/** Meses 'YYYY-MM' entre dos fechas ISO, inclusive. */
export function mesesEntre(desdeISO: string, hastaISO: string): string[] {
  const out: string[] = []
  let [y, m] = desdeISO.slice(0, 7).split('-').map(Number)
  const fin = hastaISO.slice(0, 7)
  for (let i = 0; i < 600; i++) {
    const mes = `${y}-${String(m).padStart(2, '0')}`
    out.push(mes)
    if (mes >= fin) break
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** Rango [desde, hasta] que cubre todas las fases (no bloqueos); null si no hay ninguna. */
function rangoDeFases(asignaciones: Asignacion[]): { desde: string; hasta: string } | null {
  let desde: string | null = null, hasta: string | null = null
  for (const a of asignaciones) {
    if (a.es_bloqueo) continue
    if (!desde || a.inicio < desde) desde = a.inicio
    if (!hasta || a.fin > hasta) hasta = a.fin
  }
  return desde && hasta ? { desde, hasta } : null
}

/**
 * Horas contra capacidad por persona y mes, para todos los meses que cubren las fases del
 * plan (una fila por persona y mes, aunque el mes esté en cero).
 */
export function cargaMensual(personas: Persona[], asignaciones: Asignacion[], config: Config): CargaMensual[] {
  const rango = rangoDeFases(asignaciones)
  if (!rango) return []
  const feriados = feriadosDeConfig(config)
  const meses = mesesEntre(rango.desde, rango.hasta)
  const out: CargaMensual[] = []

  for (const p of personas) {
    const hd = horasDiaDe(p, config)
    const propias = asignaciones.filter(a => a.persona_id === p.id && !a.es_bloqueo)
    const vacaciones = diasDeVacaciones(p.id, asignaciones, feriados)
    for (const mes of meses) {
      const disp = disponibilidadMes(p.id, mes, config, undefined, p)
      // Los días de vacaciones no son capacidad: se restan de los hábiles del mes.
      let ausentes = 0
      for (const iso of vacaciones) if (mesDe(iso) === mes) ausentes++
      const capacidad = Math.max(0, diasHabilesDelMes(mes, feriados) - ausentes) * hd * disp
      const porCuenta: Record<string, number> = {}
      let horas = 0
      for (const a of propias) {
        if (mesDe(a.inicio) > mes || mesDe(a.fin) < mes) continue
        const h = horasFaseEnMes(a, mes, p, feriados, config)
        if (h <= 0) continue
        horas += h
        const k = a.proyecto_id ?? a._nombre ?? a.id
        porCuenta[k] = red((porCuenta[k] ?? 0) + h)
      }
      out.push({ personaId: p.id, mes, horas: red(horas), capacidad: red(capacidad), disponibilidad: disp, porCuenta })
    }
  }
  return out
}

/**
 * Horas contra capacidad por persona y semana (lunes ISO). La capacidad de la semana sale
 * día por día, así una semana que cruza de mes usa la disponibilidad de cada mes.
 */
export function cargaSemanal(personas: Persona[], asignaciones: Asignacion[], config: Config): CargaSemanal[] {
  const rango = rangoDeFases(asignaciones)
  if (!rango) return []
  const feriados = feriadosDeConfig(config)
  const out: CargaSemanal[] = []
  const primerLunes = getMondayOfWeek(parseISO(rango.desde))
  const ultimo = parseISO(rango.hasta)

  for (const p of personas) {
    const hd = horasDiaDe(p, config)
    const propias = asignaciones.filter(a => a.persona_id === p.id && !a.es_bloqueo)
    const vacaciones = diasDeVacaciones(p.id, asignaciones, feriados)
    const dispCache = new Map<string, number>()
    const dispDe = (mes: string) => {
      let v = dispCache.get(mes)
      if (v === undefined) { v = disponibilidadMes(p.id, mes, config, undefined, p); dispCache.set(mes, v) }
      return v
    }
    for (let lunes = primerLunes; lunes <= ultimo; lunes = addDays(lunes, 7)) {
      let horas = 0, capacidad = 0
      for (let i = 0; i < 5; i++) {
        const d = addDays(lunes, i)
        if (!esHabil(d, feriados)) continue
        const iso = toISO(d)
        // Un día de vacaciones no aporta capacidad; las horas planificadas ese día sí cuentan
        // (ese choque es justamente lo que marca la regla `vacaciones`).
        if (!vacaciones.has(iso)) capacidad += hd * dispDe(mesDe(iso))
        for (const a of propias) if (a.inicio <= iso && a.fin >= iso) horas += hd * a.dedicacion_pct
      }
      out.push({ personaId: p.id, semana: toISO(lunes), horas: red(horas), capacidad: red(capacidad) })
    }
  }
  return out
}

function red(n: number): number {
  return Math.round(n * 100) / 100
}
