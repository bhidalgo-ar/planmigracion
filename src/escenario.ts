import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { cargaMensual, mesSalidaDe, salidasFueraDelPlan } from './capacidad'
import { computeViolaciones } from './rules'
import { cuentasPorDia, topeParalelo } from './paralelo'
import { feriadosDeConfig } from './utils/dates'
import { adelantarTodoNivelado, type ReporteAdelantar } from './planificadorNivelado'

/**
 * Escenarios de capacidad (23/10/2026). Un escenario es el plan con cambios que todavía no se
 * aplicaron: se guarda una copia del plan como base, se mueven cuentas o se tocan las palancas
 * (tope de cuentas abiertas, jornada y hasta cuánto puede cargarse cada persona) y la vista
 * Comparar muestra qué cambió contra la base. Funciones puras: `test/escenario.test.ts`.
 */

export interface PlanDatos {
  personas: Persona[]
  proyectos: Proyecto[]
  asignaciones: Asignacion[]
  config: Config
}

export interface Palancas {
  /** Cuentas abiertas a la vez del equipo (`reglas_calendario.max_cuentas_en_paralelo`). */
  tope: number
  /** Jornada propia por persona (`horas_dia`). null = la del plan (`horas_dia_default`). */
  horasDia: Record<string, number | null>
  /** Hasta cuánto de su capacidad puede cargarse cada persona (`carga_maxima_pct`). 1 = sin cambio. */
  cargaMaxima: Record<string, number>
}

/** Las personas de implementación que trabajan en el plan: con alguna tarea y sin rol de payroll. */
export function personasDeImplementacion(plan: Pick<PlanDatos, 'personas' | 'asignaciones'>): Persona[] {
  return plan.personas.filter(p => p.rol !== 'payroll' && plan.asignaciones.some(a => a.persona_id === p.id && !a.es_bloqueo))
}

/** Las palancas como están hoy en el plan. */
export function palancasDe(plan: PlanDatos): Palancas {
  const ps = personasDeImplementacion(plan)
  return {
    tope: topeParalelo(plan.config),
    horasDia: Object.fromEntries(ps.map(p => [p.id, p.horas_dia ?? null])),
    cargaMaxima: Object.fromEntries(ps.map(p => [p.id, p.carga_maxima_pct ?? 1])),
  }
}

/** El plan con estas palancas: cambia el tope y las personas, nunca las fechas. */
export function conPalancas(plan: PlanDatos, palancas: Palancas): PlanDatos {
  const personas = plan.personas.map(p => {
    const out: Persona = { ...p }
    if (p.id in palancas.horasDia) {
      const h = palancas.horasDia[p.id]
      if (h == null) delete out.horas_dia
      else out.horas_dia = h
    }
    if (p.id in palancas.cargaMaxima) {
      const c = palancas.cargaMaxima[p.id]
      if (!c || Math.abs(c - 1) < 1e-9) delete out.carga_maxima_pct
      else out.carga_maxima_pct = c
    }
    return out
  })
  const config: Config = {
    ...plan.config,
    reglas_calendario: { ...plan.config.reglas_calendario, max_cuentas_en_paralelo: palancas.tope },
  }
  return { ...plan, personas, config }
}

/**
 * Rearma el calendario de la base con estas palancas, adelantando cada cuenta al primer mes
 * donde entra (`adelantarTodoNivelado`). Parte siempre de la base: probar otras palancas no
 * acumula los rearmados anteriores.
 */
export function rearmarConPalancas(base: PlanDatos, palancas: Palancas, hoyISO: string): { plan: PlanDatos; reporte: ReporteAdelantar } {
  const p = conPalancas(base, palancas)
  const r = adelantarTodoNivelado(p.asignaciones, p.personas, p.config, p.proyectos, { hoyISO })
  return { plan: { ...p, asignaciones: r.asignaciones, config: r.config }, reporte: r.reporte }
}

// ── lecturas del plan ─────────────────────────────────────────────────────────────

/** El mes de la última salida en vivo (cuentas del plan y fuera del plan). */
export function ultimaSalida(plan: Pick<PlanDatos, 'proyectos' | 'config'>): string | null {
  const meses = [
    ...plan.proyectos.map(p => mesSalidaDe(p.id, plan.config)).filter((m): m is string => !!m),
    ...salidasFueraDelPlan(plan.config).map(c => c.mes),
  ]
  return meses.sort().pop() ?? null
}

/** El último día con una tarea del programa (incluida la primera liquidación en vivo). */
export function finDelPrograma(plan: Pick<PlanDatos, 'asignaciones'>): string | null {
  return plan.asignaciones.filter(a => !a.es_bloqueo).map(a => a.fin).sort().pop() ?? null
}

/** % de capacidad por persona y mes (las de implementación). */
export function cargaPorMes(plan: PlanDatos): Record<string, Record<string, number>> {
  const ids = new Set(personasDeImplementacion(plan).map(p => p.id))
  const out: Record<string, Record<string, number>> = {}
  for (const c of cargaMensual(plan.personas, plan.asignaciones, plan.config)) {
    if (!ids.has(c.personaId) || c.capacidad <= 0) continue
    ;(out[c.personaId] ??= {})[c.mes] = Math.round((100 * c.horas) / c.capacidad)
  }
  return out
}

/** El mes más cargado de una persona. */
export function picoDe(carga: Record<string, number> | undefined): { pct: number; mes: string } | null {
  let pico: { pct: number; mes: string } | null = null
  for (const [mes, pct] of Object.entries(carga ?? {})) if (!pico || pct > pico.pct) pico = { pct, mes }
  return pico
}

/** Máximo de cuentas abiertas a la vez en un mismo día, por mes. */
export function paraleloPorMes(plan: Pick<PlanDatos, 'asignaciones' | 'config'>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [dia, s] of cuentasPorDia(plan.asignaciones, feriadosDeConfig(plan.config))) {
    const mes = dia.slice(0, 7)
    out[mes] = Math.max(out[mes] ?? 0, s.size)
  }
  return out
}

/** Salidas por mes: nombres de cuenta (del plan y fuera del plan). */
export function salidasDelPlan(plan: Pick<PlanDatos, 'proyectos' | 'config'>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const p of plan.proyectos) {
    const m = mesSalidaDe(p.id, plan.config)
    if (m) (out[m] ??= []).push(p.nombre)
  }
  for (const c of salidasFueraDelPlan(plan.config)) (out[c.mes] ??= []).push(c.nombre)
  return out
}

// ── comparar ──────────────────────────────────────────────────────────────────────

export interface Comparacion {
  ultimaSalida: { antes: string | null; despues: string | null }
  fin: { antes: string | null; despues: string | null }
  rojos: { antes: number; despues: number }
  ambares: { antes: number; despues: number }
  /** Cuentas que cambiaron de mes de salida. */
  movidas: Array<{ id: string; nombre: string; antes: string | null; despues: string | null }>
  /** Meses del rango (de la primera a la última salida de cualquiera de los dos). */
  meses: string[]
  salidas: { antes: Record<string, string[]>; despues: Record<string, string[]> }
  /** Por persona de implementación: % por mes antes y después, y el pico. */
  equipo: Array<{
    id: string; alias: string
    meses: Array<{ mes: string; antes: number | null; despues: number | null }>
    pico: { antes: { pct: number; mes: string } | null; despues: { pct: number; mes: string } | null }
  }>
  paralelo: { antes: number; despues: number; tope: number }
  /** Lo que cambió en las palancas, en castellano. */
  palancas: string[]
}

function mesesEntreClaves(desde: string, hasta: string): string[] {
  const out: string[] = []
  let [y, m] = desde.split('-').map(Number)
  for (let i = 0; i < 120; i++) {
    const k = `${y}-${String(m).padStart(2, '0')}`
    if (k > hasta) break
    out.push(k)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

const cuenta = (vs: Violacion[], sev: Violacion['severidad']) => vs.filter(v => v.severidad === sev).length

/** Qué cambió entre la base del escenario y el plan de ahora. */
export function compararPlanes(base: PlanDatos, actual: PlanDatos): Comparacion {
  const vb = computeViolaciones(base.asignaciones, base.personas, base.config, base.proyectos)
  const va = computeViolaciones(actual.asignaciones, actual.personas, actual.config, actual.proyectos)
  const sb = salidasDelPlan(base), sa = salidasDelPlan(actual)
  const todas = [...Object.keys(sb), ...Object.keys(sa)].sort()
  const meses = todas.length ? mesesEntreClaves(todas[0], todas[todas.length - 1]) : []
  const movidas = actual.proyectos
    .map(p => ({ id: p.id, nombre: p.nombre, antes: mesSalidaDe(p.id, base.config), despues: mesSalidaDe(p.id, actual.config) }))
    .filter(m => m.antes !== m.despues)
  const cb = cargaPorMes(base), ca = cargaPorMes(actual)
  const ids = new Set([...personasDeImplementacion(base), ...personasDeImplementacion(actual)].map(p => p.id))
  const mesesCarga = [...new Set([...Object.values(cb), ...Object.values(ca)].flatMap(x => Object.keys(x)))].sort()
  const equipo = actual.personas.filter(p => ids.has(p.id)).map(p => ({
    id: p.id, alias: p.alias,
    meses: mesesCarga.map(mes => ({ mes, antes: cb[p.id]?.[mes] ?? null, despues: ca[p.id]?.[mes] ?? null })),
    pico: { antes: picoDe(cb[p.id]), despues: picoDe(ca[p.id]) },
  }))
  const pb = Math.max(0, ...Object.values(paraleloPorMes(base)))
  const pa = Math.max(0, ...Object.values(paraleloPorMes(actual)))
  return {
    ultimaSalida: { antes: ultimaSalida(base), despues: ultimaSalida(actual) },
    fin: { antes: finDelPrograma(base), despues: finDelPrograma(actual) },
    rojos: { antes: cuenta(vb, 'rojo'), despues: cuenta(va, 'rojo') },
    ambares: { antes: cuenta(vb, 'ambar'), despues: cuenta(va, 'ambar') },
    movidas, meses, salidas: { antes: sb, despues: sa }, equipo,
    paralelo: { antes: pb, despues: pa, tope: topeParalelo(actual.config) },
    palancas: describirPalancas(base, actual),
  }
}

/** Las palancas que cambiaron entre dos planes, para leerlas de corrido. */
export function describirPalancas(base: PlanDatos, actual: PlanDatos): string[] {
  const out: string[] = []
  const tb = topeParalelo(base.config), ta = topeParalelo(actual.config)
  if (tb !== ta) out.push(`tope de cuentas abiertas ${tb} → ${ta}`)
  const hd = (p: Persona | undefined, cfg: Config) => p?.horas_dia ?? cfg.capacidad?.horas_dia_default ?? 8
  for (const p of actual.personas) {
    const b = base.personas.find(x => x.id === p.id)
    if (hd(b, base.config) !== hd(p, actual.config)) out.push(`${p.alias} ${hd(b, base.config)} h → ${hd(p, actual.config)} h por día`)
    const cb = b?.carga_maxima_pct ?? 1, ca = p.carga_maxima_pct ?? 1
    if (Math.abs(cb - ca) > 1e-9) out.push(`${p.alias} hasta ${Math.round(cb * 100)} % → ${Math.round(ca * 100)} %`)
  }
  return out
}

// ── qué aporta cada palanca ───────────────────────────────────────────────────────

export interface PasoEscalera { etiqueta: string; palancas: Palancas }

/**
 * Los pasos para ver qué aporta cada palanca, de a una: solo el tope, después la jornada, después
 * cada persona al tope de carga por separado y al final todas juntas. Solo incluye los pasos de
 * las palancas que efectivamente cambian respecto de la base.
 */
export function pasosEscalera(base: Palancas, objetivo: Palancas, aliasDe: (id: string) => string): PasoEscalera[] {
  const pasos: PasoEscalera[] = []
  const horasCambian = Object.keys(objetivo.horasDia).filter(id => (objetivo.horasDia[id] ?? null) !== (base.horasDia[id] ?? null))
  const cargaCambia = Object.keys(objetivo.cargaMaxima).filter(id => Math.abs((objetivo.cargaMaxima[id] ?? 1) - (base.cargaMaxima[id] ?? 1)) > 1e-9)
  const soloTope: Palancas = { ...base, tope: objetivo.tope }
  pasos.push({ etiqueta: objetivo.tope !== base.tope ? `Solo tope ${objetivo.tope}` : 'Sin cambiar palancas', palancas: soloTope })
  let acumulado = soloTope
  if (horasCambian.length) {
    acumulado = { ...acumulado, horasDia: { ...base.horasDia, ...Object.fromEntries(horasCambian.map(id => [id, objetivo.horasDia[id]])) } }
    const txt = horasCambian.map(id => `${aliasDe(id)} ${objetivo.horasDia[id] ?? 'jornada del plan'} h`).join(', ')
    pasos.push({ etiqueta: `+ ${txt}`, palancas: acumulado })
  }
  if (cargaCambia.length > 1) {
    for (const id of cargaCambia) {
      pasos.push({
        etiqueta: `+ solo ${aliasDe(id)} al ${Math.round((objetivo.cargaMaxima[id] ?? 1) * 100)} %`,
        palancas: { ...acumulado, cargaMaxima: { ...base.cargaMaxima, [id]: objetivo.cargaMaxima[id] } },
      })
    }
  }
  if (cargaCambia.length) {
    const todos = cargaCambia.length > 1 ? 'todos' : aliasDe(cargaCambia[0])
    pasos.push({ etiqueta: `+ ${todos} al ${Math.round(Math.max(...cargaCambia.map(id => objetivo.cargaMaxima[id])) * 100)} %`, palancas: objetivo })
  }
  return pasos
}
