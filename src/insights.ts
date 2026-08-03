import { differenceInCalendarMonths, differenceInCalendarWeeks, parseISO } from 'date-fns'
import type { Asignacion, Persona, Proyecto, TipoFase, Violacion } from './types'
import { ORDEN_FASES } from './theme/fases'
import { toISO } from './utils/dates'

export interface CuentaFaltante {
  id: string
  nombre: string
  faltan: TipoFase[]
}

export interface ResumenPlan {
  /** Fin del proceso completo con la configuración actual (última fase planificada). */
  finPlan: string | null
  /** Cuenta cuya última fase cierra el plan. */
  cuentaCierre: string | null
  inicioPlan: string | null
  semanasHastaFin: number | null
  mesesHastaFin: number | null
  /** Cuentas sin ninguna fase planificada. */
  sinPlanificar: Array<{ id: string; nombre: string }>
  /** Cuentas con alguna fase, pero a las que les falta Relevamiento / Configuración / Pruebas. */
  incompletas: CuentaFaltante[]
  /** Personas del equipo sin ninguna fase asignada. */
  personasSinCarga: Array<{ id: string; alias: string }>
  /** Fases activas hoy. */
  enCurso: number
  conflictos: number
  avisos: number
  /** Persona con más semanas sobreasignadas (R2 rojo), si hay alguna. */
  cuello: { alias: string; semanas: number } | null
  cuentasPlanificadas: number
  totalCuentas: number
}

/**
 * Lectura de estado del plan para el panel inferior: cuándo termina el proceso con la
 * configuración actual y qué falta cargar. No inventa datos: si una cuenta no tiene
 * fases, aparece como "sin planificar" y su duración no entra en la fecha de fin.
 */
export function resumenPlan(
  proyectos: Proyecto[],
  asignaciones: Asignacion[],
  personas: Persona[],
  violaciones: Violacion[],
  hoy: Date = new Date(),
): ResumenPlan {
  const fases = asignaciones.filter(a => !a.es_bloqueo)
  const hoyISO = toISO(hoy)

  let finPlan: string | null = null
  let cuentaCierre: string | null = null
  let inicioPlan: string | null = null

  for (const a of fases) {
    if (!inicioPlan || a.inicio < inicioPlan) inicioPlan = a.inicio
    if (!finPlan || a.fin > finPlan) {
      finPlan = a.fin
      const p = proyectos.find(x => x.id === a.proyecto_id)
      cuentaCierre = p?.nombre ?? a._nombre ?? null
    }
  }

  const sinPlanificar: Array<{ id: string; nombre: string }> = []
  const incompletas: CuentaFaltante[] = []
  for (const p of proyectos) {
    const propias = fases.filter(a => a.proyecto_id === p.id)
    if (propias.length === 0) {
      sinPlanificar.push({ id: p.id, nombre: p.nombre })
      continue
    }
    const faltan = ORDEN_FASES.filter(t => !propias.some(a => a.tipo === t))
    if (faltan.length) incompletas.push({ id: p.id, nombre: p.nombre, faltan })
  }

  const personasSinCarga = personas
    .filter(p => !fases.some(a => a.persona_id === p.id))
    .map(p => ({ id: p.id, alias: p.alias }))

  const semanasRojasPorPersona = new Map<string, number>()
  for (const v of violaciones) {
    if (v.tipo !== 'R2' || v.severidad !== 'rojo' || !v.persona_id) continue
    semanasRojasPorPersona.set(v.persona_id, (semanasRojasPorPersona.get(v.persona_id) ?? 0) + 1)
  }
  let cuello: { alias: string; semanas: number } | null = null
  for (const [pid, semanas] of semanasRojasPorPersona) {
    if (cuello && cuello.semanas >= semanas) continue
    const alias = personas.find(p => p.id === pid)?.alias ?? pid
    cuello = { alias, semanas }
  }

  const finDate = finPlan ? parseISO(finPlan) : null

  return {
    finPlan,
    cuentaCierre,
    inicioPlan,
    semanasHastaFin: finDate ? differenceInCalendarWeeks(finDate, hoy, { weekStartsOn: 1 }) : null,
    mesesHastaFin: finDate ? differenceInCalendarMonths(finDate, hoy) : null,
    sinPlanificar,
    incompletas,
    personasSinCarga,
    enCurso: fases.filter(a => a.inicio <= hoyISO && a.fin >= hoyISO).length,
    conflictos: violaciones.filter(v => v.severidad === 'rojo').length,
    avisos: violaciones.filter(v => v.severidad === 'ambar').length,
    cuello,
    cuentasPlanificadas: proyectos.length - sinPlanificar.length,
    totalCuentas: proyectos.length,
  }
}
