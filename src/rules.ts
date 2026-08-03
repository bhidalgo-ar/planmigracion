import { addDays } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { getSemanas, toISO } from './utils/dates'

/**
 * Regla 1 · Acantilado Susana → Toyota. Toda fase de Configuración asignada a `susi`
 * que cruce o sea posterior a la fecha de pase a Toyota (perilla `transicion_susana_toyota`)
 * se marca en rojo, excepto en el proyecto especial TASA/Toyota (ella sigue ahí después
 * de pasar). Sin fecha definida, la regla no corre (nada que evaluar todavía).
 */
export function checkRule1(
  asignaciones: Asignacion[],
  proyectos: Proyecto[],
  config: Config,
): Violacion[] {
  const transicion = config.fechas_clave.transicion_susana_toyota
  if (!transicion) return []
  const proyectoPorId = new Map(proyectos.map(p => [p.id, p]))
  const violations: Violacion[] = []

  for (const a of asignaciones) {
    if (a.es_bloqueo || a.tipo !== 'Configuracion' || a.persona_id !== 'susi') continue
    const proyecto = a.proyecto_id ? proyectoPorId.get(a.proyecto_id) : null
    if (proyecto?.especial) continue // TASA/Toyota: ahí es donde Susi sigue trabajando

    if (a.fin >= transicion) {
      const yaEnToyota = a.inicio >= transicion
      violations.push({
        tipo: 'R1',
        asignacion_id: a.id,
        persona_id: a.persona_id,
        mensaje: yaEnToyota
          ? `Susi configura ${proyecto?.nombre ?? a.id} después de pasar a Toyota (desde ${transicion})`
          : `Susi configura ${proyecto?.nombre ?? a.id} y la fase cruza su pase a Toyota (${transicion})`,
        severidad: 'rojo',
      })
    }
  }
  return violations
}

/**
 * Regla 2 · Sobreasignación por persona/DÍA. Se evalúa día por día (lun-vie): si ese
 * día concreto tiene tareas de más de un proyecto activas para la misma persona y la
 * suma de dedicación supera el límite, es colapso. Evaluar por "semana completa" (como
 * antes) daba falsos positivos: dos fases de distintos clientes que caen en la misma
 * semana calendario pero en días que no se tocan (ej. una termina el martes, la otra
 * empieza el jueves) NO son un choque real. Se agrupa por semana solo para no listar
 * una violación por cada día (la línea de la semana con el peor día encontrado).
 */
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
        if (carga > 1.0) { peor = 'rojo'; asigRef = activasHoy[0].id; break }
        if (carga > 0.8) { peor = 'ambar'; asigRef = activasHoy[0].id }
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
  proyectos: Proyecto[],
): Violacion[] {
  return [
    ...checkRule1(asignaciones, proyectos, config),
    ...checkRule2(asignaciones, personas, config),
    ...checkRule3(asignaciones),
  ]
}
