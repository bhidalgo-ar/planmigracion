import { addDays } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { getSemanas, toISO } from './utils/dates'

/**
 * Regla 2 · Sobreasignación por persona/DÍA. Se evalúa día por día (lun-vie): si ese
 * día concreto tiene tareas de más de un proyecto activas para la misma persona y la
 * suma de dedicación supera el límite, es colapso. Evaluar por "semana completa" (como
 * antes) daba falsos positivos: dos fases de distintos clientes que caen en la misma
 * semana calendario pero en días que no se tocan (ej. una termina el martes, la otra
 * empieza el jueves) NO son un choque real. Se agrupa por semana solo para no listar
 * una violación por cada día (la línea de la semana con el peor día encontrado).
 *
 * El límite es la capacidad REAL de la persona, no 1.0: media jornada (20 hs/sem) tiene
 * límite 0,5, así que dos fases al 0,5 el mismo día ya la desbordan. Con el 1.0 fijo de
 * antes, a media jornada nunca le saltaba nada.
 */
/**
 * Cuánta carga simultánea aguanta una persona: 1.0 = jornada completa sin buffer.
 * Media jornada (20 de 40 hs/sem) = 0,5. El buffer_pct le descuenta una reserva.
 */
export function limiteDeCarga(persona: Persona): number {
  const jornadas = (persona.capacidad_horas_semana || 40) / 40
  const buffer = persona.buffer_pct || 0
  return Math.max(0.01, jornadas * (1 - buffer))
}

export function checkRule2(
  asignaciones: Asignacion[],
  personas: Persona[],
  config: Config,
): Violacion[] {
  const violations: Violacion[] = []
  const semanas = getSemanas(config.horizonte.desde, config.horizonte.hasta)

  for (const persona of personas) {
    const propias = asignaciones.filter(a => a.persona_id === persona.id)
    if (propias.length < 2) continue

    const limite = limiteDeCarga(persona)
    const limiteAmbar = limite * 0.8

    for (const lunes of semanas) {
      const lunesISO = toISO(lunes)
      let peor: 'rojo' | 'ambar' | null = null
      let asigRef: string | null = null

      for (let i = 0; i < 5; i++) {
        const diaISO = toISO(addDays(lunes, i))
        const activasHoy = propias.filter(a => a.inicio <= diaISO && a.fin >= diaISO)
        if (activasHoy.length < 2) continue

        // Solo cuenta si son de distintos proyectos: solapar fases del mismo
        // cliente el mismo día es planificación esperada, no colapso.
        const proyectosDistintos = new Set(activasHoy.map(a => a.proyecto_id)).size
        if (proyectosDistintos <= 1) continue

        const carga = activasHoy.reduce((sum, a) => sum + a.dedicacion_pct, 0)
        if (carga > limite) { peor = 'rojo'; asigRef = activasHoy[0].id; break }
        if (carga > limiteAmbar) { peor = 'ambar'; asigRef = activasHoy[0].id }
      }

      if (peor && asigRef) {
        violations.push({
          tipo: 'R2',
          asignacion_id: asigRef,
          persona_id: persona.id,
          semana: lunesISO,
          mensaje: peor === 'rojo'
            ? `${persona.alias} tiene tareas de distintos clientes pisándose el mismo día en la semana del ${lunesISO}`
            : `${persona.alias} cerca del límite de carga en la semana del ${lunesISO}`,
          severidad: peor,
        })
      }
    }
  }
  return violations
}

export function checkRule3(asignaciones: Asignacion[]): Violacion[] {
  const byId = new Map(asignaciones.map(a => [a.id, a]))
  const violations: Violacion[] = []

  for (const a of asignaciones) {
    for (const predId of a.predecesoras) {
      const pred = byId.get(predId)
      if (!pred) continue
      // Distintas personas pueden solaparse; el conflicto solo aplica a la misma persona.
      if (a.persona_id !== pred.persona_id) continue
      if (a.inicio < pred.fin) {
        violations.push({
          tipo: 'R3',
          asignacion_id: a.id,
          mensaje: `"${a.id}" empieza el ${a.inicio} antes de que termine "${predId}" (${pred.fin})`,
          severidad: 'rojo',
        })
      }
    }
  }
  return violations
}

export function computeViolaciones(
  asignaciones: Asignacion[],
  personas: Persona[],
  config: Config,
  _proyectos: Proyecto[],
): Violacion[] {
  return [
    ...checkRule2(asignaciones, personas, config),
    ...checkRule3(asignaciones),
  ]
}
