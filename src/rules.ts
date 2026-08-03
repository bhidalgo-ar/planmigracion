import { addDays } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { getSemanas, seSuperponen, toISO } from './utils/dates'

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

export function checkRule2(
  asignaciones: Asignacion[],
  personas: Persona[],
  config: Config,
): Violacion[] {
  const violations: Violacion[] = []
  const semanas = getSemanas(config.horizonte.desde, config.horizonte.hasta)

  for (const persona of personas) {
    for (const lunes of semanas) {
      const viernes = addDays(lunes, 4)
      // Claves de semana en hora LOCAL (toISO) para ser consistentes con base/semanaIndex
      // del timeline; toISOString (UTC) corría un día en husos al este de UTC.
      const lunesISO = toISO(lunes)
      const viernesISO = toISO(viernes)

      const activas = asignaciones.filter(
        a => a.persona_id === persona.id && seSuperponen(a.inicio, a.fin, lunesISO, viernesISO),
      )
      if (activas.length === 0) continue

      // Solo hay conflicto si las tareas solapadas son de distintos proyectos.
      // Solapamiento de fases del mismo cliente es planificación esperada, no colapso.
      const proyectosDistintos = new Set(activas.map(a => a.proyecto_id)).size
      if (proyectosDistintos <= 1) continue

      const carga = activas.reduce((sum, a) => sum + a.dedicacion_pct, 0)
      // 100% es la carga planificada normal (una fase a tiempo completo) → verde.
      // Rojo solo si SUPERA la capacidad (típicamente dos fases solapadas).
      // Ámbar solo en la banda fraccional realmente cercana al límite (ej. 85–99%).
      if (carga > 1.0) {
        violations.push({
          tipo: 'R2',
          asignacion_id: activas[0].id,
          persona_id: persona.id,
          semana: lunesISO,
          mensaje: `${persona.alias} tiene ${Math.round(carga * 100)}% de carga la semana del ${lunesISO}`,
          severidad: 'rojo',
        })
      } else if (carga > 0.8 && carga < 1.0) {
        violations.push({
          tipo: 'R2',
          asignacion_id: activas[0].id,
          persona_id: persona.id,
          semana: lunesISO,
          mensaje: `${persona.alias} cerca del límite (${Math.round(carga * 100)}%) semana del ${lunesISO}`,
          severidad: 'ambar',
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
