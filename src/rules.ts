import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { feriadosDeConfig, toISO } from './utils/dates'
import {
  cargaMensual, cargaSemanal, mesSalidaDe, salidasFueraDelPlan, ultimoDiaDelMes,
} from './capacidad'

/**
 * Motor de reglas del programa (brief 10/09/2026 §4-A4). Seis reglas, todas con mensajes
 * para un gerente: nombran cuenta, fase y fecha; nunca un id.
 *
 *  carga_mes     rojo   horas de la persona en el mes > capacidad del mes
 *  carga_semana  ámbar  horas en la semana > capacidad de la semana × tolerancia (aviso)
 *  tope_salidas  rojo   más salidas en vivo en el mes que el tope (3 se permiten si 2 son chicas)
 *  margen        rojo   Pruebas cierra a menos de N hábiles del corte de novedades del mes de salida
 *  blackout      rojo   una Configuración toca el blackout de fin de año
 *  dependencia   rojo   Pruebas arranca antes de que cierre la Configuración de su cuenta
 *
 * Lo que NO es conflicto: dos personas configurando la misma cuenta a la vez, o una persona
 * en dos cuentas la misma semana con dedicación parcial. El solapamiento es el modelo; lo que
 * se controla es el total de horas contra la capacidad.
 */

// ── helpers de texto ─────────────────────────────────────────────────────────────

/** '2026-10-19' → '19/10' */
export function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** '2027-01' → 'Enero 2027' */
export function nombreMes(mesISO: string): string {
  const s = format(parseISO(`${mesISO}-01`), 'LLLL yyyy', { locale: es })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** '2026-10-05' → 'semana del 5/10' */
function textoSemana(lunesISO: string): string {
  return `semana del ${parseInt(lunesISO.slice(8, 10), 10)}/${lunesISO.slice(5, 7)}`
}

function nombreCuenta(proyectoId: string | null, proyectos: Proyecto[], fallback = 'una cuenta'): string {
  return proyectos.find(p => p.id === proyectoId)?.nombre ?? fallback
}

function h(n: number): string {
  return `${Math.round(n)} h`
}

// ── carga ────────────────────────────────────────────────────────────────────────

/**
 * Regla dura: en cada mes, las horas de una persona no pueden superar su capacidad.
 * La violación se cuelga de la fase con más horas en ese mes (para que el panel de la
 * fase la muestre) y lleva `persona_id` + `mes` para el timeline.
 */
export function checkCargaMensual(
  asignaciones: Asignacion[], personas: Persona[], config: Config, proyectos: Proyecto[],
): Violacion[] {
  const out: Violacion[] = []
  for (const c of cargaMensual(personas, asignaciones, config)) {
    if (c.horas <= c.capacidad + 0.01) continue
    const persona = personas.find(p => p.id === c.personaId)
    const alias = persona?.alias ?? c.personaId
    const cuentas = Object.entries(c.porCuenta)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => nombreCuenta(id, proyectos, id))
    const asigRef = asignaciones
      .filter(a => a.persona_id === c.personaId && !a.es_bloqueo && a.inicio.slice(0, 7) <= c.mes && a.fin.slice(0, 7) >= c.mes)
      .sort((a, b) => b.dedicacion_pct - a.dedicacion_pct)[0]
    out.push({
      tipo: 'carga_mes',
      asignacion_id: asigRef?.id ?? '',
      persona_id: c.personaId,
      mes: c.mes,
      severidad: 'rojo',
      mensaje: `${nombreMes(c.mes)}: ${alias} tiene ${h(c.horas)} planificadas contra ${h(c.capacidad)} de capacidad (${cuentas.join(', ')})`,
    })
  }
  return out
}

/**
 * Aviso: una semana puntual por encima de la capacidad × tolerancia. Es ámbar y no rojo
 * porque el control real es mensual; esto solo señala dónde se concentra la carga.
 */
export function checkCargaSemanal(
  asignaciones: Asignacion[], personas: Persona[], config: Config,
): Violacion[] {
  const tol = config.capacidad?.aviso_semanal_tolerancia ?? 1.15
  const out: Violacion[] = []
  for (const c of cargaSemanal(personas, asignaciones, config)) {
    if (c.capacidad <= 0 || c.horas <= c.capacidad * tol + 0.01) continue
    const alias = personas.find(p => p.id === c.personaId)?.alias ?? c.personaId
    const viernes = toISO(addDays(parseISO(c.semana), 4))
    const asigRef = asignaciones
      .filter(a => a.persona_id === c.personaId && !a.es_bloqueo && a.inicio <= viernes && a.fin >= c.semana)
      .sort((a, b) => b.dedicacion_pct - a.dedicacion_pct)[0]
    out.push({
      tipo: 'carga_semana',
      asignacion_id: asigRef?.id ?? '',
      persona_id: c.personaId,
      semana: c.semana,
      severidad: 'ambar',
      mensaje: `${alias} concentra ${h(c.horas)} en la ${textoSemana(c.semana)} (capacidad ${h(c.capacidad)})`,
    })
  }
  return out
}

// ── calendario ───────────────────────────────────────────────────────────────────

/** Salidas en vivo por mes: cuentas del plan (con id) y fuera del plan (solo nombre). */
export function salidasPorMes(config: Config, proyectos: Proyecto[]): Map<string, Array<{ id: string | null; nombre: string }>> {
  const m = new Map<string, Array<{ id: string | null; nombre: string }>>()
  const push = (mes: string, s: { id: string | null; nombre: string }) => {
    const arr = m.get(mes) ?? []
    arr.push(s)
    m.set(mes, arr)
  }
  for (const p of proyectos) {
    const mes = mesSalidaDe(p.id, config)
    if (mes) push(mes, { id: p.id, nombre: p.nombre })
  }
  for (const c of salidasFueraDelPlan(config)) push(c.mes, { id: null, nombre: c.nombre })
  return m
}

/**
 * Tope de salidas en vivo por mes (`reglas_calendario.tope_salidas_en_vivo_por_mes`).
 * Excepción: exactamente 3 salidas con al menos 2 de tier chica se permiten, y se informan.
 * Sin tope configurado, la regla no corre.
 */
export function checkTopeSalidas(asignaciones: Asignacion[], config: Config, proyectos: Proyecto[]): Violacion[] {
  const tope = config.reglas_calendario?.tope_salidas_en_vivo_por_mes
  if (typeof tope !== 'number') return []
  const chicas = new Set(config.tiers_v3?.chica ?? [])
  const out: Violacion[] = []

  for (const [mes, salidas] of [...salidasPorMes(config, proyectos).entries()].sort()) {
    if (salidas.length <= tope) continue
    const nombres = salidas.map(s => s.nombre).join(', ')
    const nChicas = salidas.filter(s => s.id && chicas.has(s.id)).length
    // Una fase de referencia: la última Pruebas de alguna de las cuentas del mes.
    const ids = new Set(salidas.map(s => s.id).filter((x): x is string => !!x))
    const ref = asignaciones
      .filter(a => a.proyecto_id && ids.has(a.proyecto_id) && a.tipo === 'Pruebas')
      .sort((a, b) => (a.fin < b.fin ? 1 : -1))[0]
    const permitido = salidas.length === 3 && nChicas >= 2
    out.push({
      tipo: 'tope_salidas',
      asignacion_id: ref?.id ?? '',
      proyecto_id: ref?.proyecto_id ?? undefined,
      mes,
      severidad: permitido ? 'info' : 'rojo',
      mensaje: permitido
        ? `${nombreMes(mes)} tiene ${salidas.length} salidas en vivo (${nombres}): permitido porque ${nChicas === 2 ? 'dos' : nChicas} son tier chico`
        : `${nombreMes(mes)} tiene ${salidas.length} salidas en vivo (${nombres}) y el tope es ${tope}`,
    })
  }
  return out
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Corre una fecha hacia atrás hasta el primer día hábil (ella misma si ya lo es). */
function habilAnteriorOIgual(iso: string, feriados: ReadonlySet<string>): string {
  let d = parseISO(iso)
  for (let i = 0; i < 14; i++) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !feriados.has(toISO(d))) break
    d = addDays(d, -1)
  }
  return toISO(d)
}

/**
 * Corte de novedades de una cuenta en un mes. Primero la fecha concreta de ese período
 * (`cortes_novedades_fechas`, leída de los cronogramas de monday); si el plan no la trae,
 * el día fijo (`cortes_novedades_dia`). En los dos casos corrido hacia atrás si cae en
 * día no hábil.
 */
export function fechaCorteDe(proyectoId: string, mesISO: string, config: Config, feriados: ReadonlySet<string>): string | null {
  const exacta = config.cortes_novedades_fechas?.[proyectoId]?.[mesISO]
  if (typeof exacta === 'string' && RE_FECHA.test(exacta)) return habilAnteriorOIgual(exacta, feriados)
  const dia = config.cortes_novedades_dia?.[proyectoId]
  if (typeof dia !== 'number') return null
  const ultimo = ultimoDiaDelMes(mesISO).getDate()
  return habilAnteriorOIgual(`${mesISO}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`, feriados)
}

export interface OrigenCorte {
  fecha: string
  /** monday = el ítem ya existe en el cronograma · estimado = proyectado desde 2026 · dia_fijo = regla vieja */
  origen: 'monday' | 'estimado' | 'dia_fijo'
  /** Qué ronda es el ancla ('1Q', 'v1', 'ronda 1', 'mensual'); null con el día fijo. */
  ronda: string | null
}

/** El corte con su procedencia, para explicarlo en pantalla. */
export function origenCorteDe(proyectoId: string, mesISO: string, config: Config, feriados: ReadonlySet<string>): OrigenCorte | null {
  const fecha = fechaCorteDe(proyectoId, mesISO, config, feriados)
  if (!fecha) return null
  const exacta = config.cortes_novedades_fechas?.[proyectoId]?.[mesISO]
  if (typeof exacta !== 'string') return { fecha, origen: 'dia_fijo', ronda: null }
  const det = config.cortes_novedades_detalle?.[proyectoId]
  const ronda = typeof det?.ancla === 'string' ? det.ancla : null
  const txt = ronda ? det?.por_periodo?.[mesISO]?.[ronda] : undefined
  return { fecha, origen: typeof txt === 'string' && txt.includes('monday') ? 'monday' : 'estimado', ronda }
}

/**
 * Días hábiles que quedan DESPUÉS de `desdeISO` y hasta `hastaISO` inclusive: el margen
 * entre el fin de Pruebas y el corte de novedades. El día del corte cuenta porque es un
 * día de trabajo disponible antes del cierre; el último día de pruebas no, porque ya está
 * ocupado. Es la convención con la que se armó el calendario v3 (todas las cuentas ≥ 5).
 */
export function habilesHasta(desdeISO: string, hastaISO: string, feriados: ReadonlySet<string>): number {
  let n = 0
  let d = addDays(parseISO(desdeISO), 1)
  const fin = parseISO(hastaISO)
  while (d <= fin) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !feriados.has(toISO(d))) n++
    d = addDays(d, 1)
  }
  return n
}

export interface MargenCuenta {
  proyectoId: string
  mesSalida: string
  finPruebas: string | null
  corte: string | null
  /** Hábiles después del fin de Pruebas hasta el corte inclusive (negativo si Pruebas termina después). null si falta un dato. */
  habiles: number | null
}

/** Margen de cada cuenta con mes de salida: fin de su última Pruebas contra el corte de novedades. */
export function margenesPorCuenta(asignaciones: Asignacion[], config: Config, proyectos: Proyecto[]): MargenCuenta[] {
  const feriados = feriadosDeConfig(config)
  const out: MargenCuenta[] = []
  for (const p of proyectos) {
    const mes = mesSalidaDe(p.id, config)
    if (!mes) continue
    const pruebas = asignaciones.filter(a => a.proyecto_id === p.id && a.tipo === 'Pruebas' && !a.es_bloqueo)
    const finPruebas = pruebas.length ? pruebas.reduce((m, a) => (a.fin > m ? a.fin : m), pruebas[0].fin) : null
    const corte = fechaCorteDe(p.id, mes, config, feriados)
    const habiles = finPruebas && corte
      ? (finPruebas >= corte ? -habilesHasta(corte, finPruebas, feriados) : habilesHasta(finPruebas, corte, feriados))
      : null
    out.push({ proyectoId: p.id, mesSalida: mes, finPruebas, corte, habiles })
  }
  return out
}

/**
 * Margen: entre el fin de la última Pruebas y el corte de novedades del mes de salida tiene
 * que haber al menos `capacidad.margen_minimo_habiles` días hábiles. Blackout: ninguna
 * Configuración puede tocar `tiers_v3.blackout_config`.
 */
export function checkMargenYBlackout(asignaciones: Asignacion[], config: Config, proyectos: Proyecto[]): Violacion[] {
  const out: Violacion[] = []
  const minimo = config.capacidad?.margen_minimo_habiles ?? 5

  for (const m of margenesPorCuenta(asignaciones, config, proyectos)) {
    if (m.habiles === null || m.habiles >= minimo) continue
    const p = proyectos.find(x => x.id === m.proyectoId)!
    const ref = asignaciones
      .filter(a => a.proyecto_id === p.id && a.tipo === 'Pruebas')
      .sort((a, b) => (a.fin < b.fin ? 1 : -1))[0]
    out.push({
      tipo: 'margen',
      asignacion_id: ref?.id ?? '',
      proyecto_id: p.id,
      mes: m.mesSalida,
      severidad: 'rojo',
      mensaje: m.habiles < 0
        ? `Las pruebas de ${p.nombre} terminan el ${ddmm(m.finPruebas!)}, después del corte de novedades del ${ddmm(m.corte!)}`
        : `Las pruebas de ${p.nombre} terminan el ${ddmm(m.finPruebas!)}, a ${m.habiles} día${m.habiles !== 1 ? 's' : ''} hábil${m.habiles !== 1 ? 'es' : ''} del corte de novedades del ${ddmm(m.corte!)} (mínimo ${minimo})`,
    })
  }

  const blackout = config.tiers_v3?.blackout_config
  if (blackout && blackout.length === 2) {
    const [b0, b1] = blackout
    for (const a of asignaciones) {
      if (a.tipo !== 'Configuracion' || a.es_bloqueo) continue
      if (a.inicio <= b1 && a.fin >= b0) {
        out.push({
          tipo: 'blackout',
          asignacion_id: a.id,
          proyecto_id: a.proyecto_id ?? undefined,
          persona_id: a.persona_id,
          severidad: 'rojo',
          mensaje: `La configuración de ${nombreCuenta(a.proyecto_id, proyectos)} (${ddmm(a.inicio)} a ${ddmm(a.fin)}) cae dentro del blackout del ${ddmm(b0)} al ${ddmm(b1)}`,
        })
      }
    }
  }
  return out
}

/**
 * La única dependencia dura del modelo: las Pruebas de una cuenta no arrancan antes de
 * que cierre TODA su Configuración, sin importar quién hace cada una (la dependencia es
 * de la cuenta, no de la persona). Si la cuenta tiene varias configuraciones, manda la
 * que termina más tarde.
 */
export function checkDependenciaConfigPruebas(asignaciones: Asignacion[], proyectos: Proyecto[]): Violacion[] {
  const out: Violacion[] = []
  const porCuenta = new Map<string, Asignacion[]>()
  for (const a of asignaciones) {
    if (a.es_bloqueo || !a.proyecto_id) continue
    porCuenta.set(a.proyecto_id, [...(porCuenta.get(a.proyecto_id) ?? []), a])
  }
  for (const [pid, fases] of porCuenta) {
    const configs = fases.filter(a => a.tipo === 'Configuracion')
    if (!configs.length) continue
    const finConfig = configs.reduce((m, a) => (a.fin > m ? a.fin : m), configs[0].fin)
    for (const a of fases) {
      if (a.tipo !== 'Pruebas' || a.inicio > finConfig) continue
      out.push({
        tipo: 'dependencia',
        asignacion_id: a.id,
        proyecto_id: pid,
        persona_id: a.persona_id,
        severidad: 'rojo',
        mensaje: `Las pruebas de ${nombreCuenta(pid, proyectos)} arrancan el ${ddmm(a.inicio)}, antes de que cierre su configuración (${ddmm(finConfig)})`,
      })
    }
  }
  return out
}

export function computeViolaciones(
  asignaciones: Asignacion[],
  personas: Persona[],
  config: Config,
  proyectos: Proyecto[],
): Violacion[] {
  return [
    ...checkDependenciaConfigPruebas(asignaciones, proyectos),
    ...checkMargenYBlackout(asignaciones, config, proyectos),
    ...checkTopeSalidas(asignaciones, config, proyectos),
    ...checkCargaMensual(asignaciones, personas, config, proyectos),
    ...checkCargaSemanal(asignaciones, personas, config),
  ]
}
