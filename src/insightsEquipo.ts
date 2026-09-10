import type { Asignacion, Config, Persona, Proyecto, TipoFase, Violacion } from './types'
import { cargaMensual, horasDiaDe, mesSalidaDe, mesesEntre, salidasFueraDelPlan, type CargaMensual } from './capacidad'
import { fechaCorteDe, margenesPorCuenta, nombreMes, salidasPorMes } from './rules'
import { feriadosDeConfig } from './utils/dates'

/**
 * Lectura del EQUIPO de payroll para la pestaña Equipo: qué le pasa a cada persona mes a
 * mes, cómo se reparte cada cuenta y cuándo sale cada una. Es la contraparte de
 * `insightsMigracion.ts` (que responde a gerencia "cuándo terminamos"); acá la pregunta
 * es "qué me toca y cuándo". Toda la matemática de horas viene de `capacidad.ts` y las
 * fechas de corte y márgenes de `rules.ts`: este módulo solo ordena y redacta.
 */

// ── B1: horas por persona por mes ─────────────────────────────────────────────

export interface MesPersona extends CargaMensual {
  /** Fracción de la capacidad usada (horas / capacidad). */
  uso: number
  estado: 'ok' | 'ambar' | 'rojo'
}

export interface CargaPersonaEquipo {
  id: string
  alias: string
  horasDia: number
  meses: MesPersona[]
  total: number
  pico: MesPersona | null
}

/** Meses que muestra la pestaña: del primer mes con fases al último mes de salida propuesto. */
export function mesesDelPrograma(asignaciones: Asignacion[], config: Config): string[] {
  const fases = asignaciones.filter(a => !a.es_bloqueo)
  if (!fases.length) return []
  const desde = fases.reduce((m, a) => (a.inicio < m ? a.inicio : m), fases[0].inicio)
  let hasta = fases.reduce((m, a) => (a.fin > m ? a.fin : m), fases[0].fin).slice(0, 7)
  for (const v of Object.values(config.salidas_en_vivo_propuestas ?? {})) if (typeof v === 'string' && v > hasta) hasta = v
  for (const c of salidasFueraDelPlan(config)) if (c.mes > hasta) hasta = c.mes
  return mesesEntre(desde, `${hasta}-01`)
}

/**
 * Carga por persona y mes con estado: rojo si pasa la capacidad, ámbar entre el 85 % y el
 * 100 %. Solo personas con fases (el resto no aporta nada a esta lectura).
 */
export function cargaEquipo(personas: Persona[], asignaciones: Asignacion[], config: Config): CargaPersonaEquipo[] {
  const meses = mesesDelPrograma(asignaciones, config)
  const carga = cargaMensual(personas, asignaciones, config)
  const out: CargaPersonaEquipo[] = []
  for (const p of personas) {
    const propias = carga.filter(c => c.personaId === p.id)
    if (!propias.some(c => c.horas > 0)) continue
    const porMes = new Map(propias.map(c => [c.mes, c]))
    const filas: MesPersona[] = meses.map(mes => {
      const c = porMes.get(mes) ?? { personaId: p.id, mes, horas: 0, capacidad: 0, disponibilidad: 0, porCuenta: {} }
      const uso = c.capacidad > 0 ? c.horas / c.capacidad : 0
      return { ...c, uso, estado: c.horas > c.capacidad + 0.01 ? 'rojo' : uso >= 0.85 ? 'ambar' : 'ok' }
    })
    const total = filas.reduce((s, f) => s + f.horas, 0)
    const pico = filas.reduce<MesPersona | null>((m, f) => (!m || f.horas > m.horas ? f : m), null)
    out.push({
      id: p.id, alias: p.alias, horasDia: horasDiaDe(p, config),
      meses: filas, total: Math.round(total), pico: pico && pico.horas > 0 ? pico : null,
    })
  }
  return out.sort((a, b) => b.total - a.total)
}

// ── B2: el solapamiento explicado ─────────────────────────────────────────────

const VERBO: Record<TipoFase, string> = {
  Relevamiento: 'releva', Configuracion: 'configura', Pruebas: 'prueba', Vacaciones: 'está de vacaciones por',
}

function listar(nombres: string[]): string {
  if (nombres.length <= 1) return nombres[0] ?? ''
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/**
 * Una frase por persona y mes: qué cuentas trabaja a la vez y cuánto suma contra su
 * capacidad. Ej.: "Willy configura Copetro y Campari a la vez (56 h de 84)". Si el total
 * pasa la capacidad, la misma frase lo dice. Devuelve '' si el mes está vacío.
 */
export function fraseDelMes(
  personaAlias: string, mes: MesPersona, asignaciones: Asignacion[], proyectos: Proyecto[],
): string {
  const cuentas = Object.entries(mes.porCuenta).sort((a, b) => b[1] - a[1])
  if (!cuentas.length) return ''
  const nombreDe = (id: string) => proyectos.find(p => p.id === id)?.nombre ?? id
  // Qué hace en cada cuenta ese mes (la fase con más días dentro del mes manda el verbo).
  const porTipo = new Map<TipoFase, string[]>()
  for (const [pid] of cuentas) {
    const fases = asignaciones.filter(a => a.proyecto_id === pid && a.persona_id === mes.personaId && !a.es_bloqueo
      && a.inicio.slice(0, 7) <= mes.mes && a.fin.slice(0, 7) >= mes.mes)
    const tipo = fases.sort((a, b) => b.duracion_dias - a.duracion_dias)[0]?.tipo ?? 'Configuracion'
    porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), nombreDe(pid)])
  }
  const partes = [...porTipo.entries()].map(([tipo, nombres]) =>
    `${VERBO[tipo]} ${listar(nombres)}${nombres.length > 1 ? ' a la vez' : ''}`)
  const horas = `${Math.round(mes.horas)} h de ${Math.round(mes.capacidad)}`
  const cierre = mes.estado === 'rojo'
    ? `: se pasa de su capacidad (${horas})`
    : mes.estado === 'ambar' ? ` (${horas}, cerca del límite)` : ` (${horas})`
  return `${personaAlias} ${partes.join(' y ')}${cierre}`
}

// ── B3: quién hace qué en cada cuenta ─────────────────────────────────────────

export type Tier = 'chica' | 'std' | 'grande'
export const TIER_LABEL: Record<Tier, string> = { chica: 'chica', std: 'estándar', grande: 'grande' }

export function tierDe(proyectoId: string, config: Config): Tier | null {
  const t = config.tiers_v3
  if (!t) return null
  if (t.chica?.includes(proyectoId)) return 'chica'
  if (t.std?.includes(proyectoId)) return 'std'
  if (t.grande?.includes(proyectoId)) return 'grande'
  return null
}

export interface FaseEnCuenta {
  id: string
  tipo: TipoFase
  persona_id: string
  inicio: string
  fin: string
  dedicacion_pct: number
}

export interface CuentaEquipo {
  id: string
  nombre: string
  tier: Tier | null
  mesSalida: string | null
  corte: string | null
  finPruebas: string | null
  /** Hábiles entre el fin de Pruebas y el corte (convención de `rules.ts`). */
  margen: number | null
  estadoMargen: 'ok' | 'rojo' | 'sin_dato'
  fases: FaseEnCuenta[]
  /** Personas con fases en la cuenta, en orden de aparición. */
  personas: string[]
}

/** Una fila por cuenta con fases, ordenada por mes de salida (las sin mes al final). */
export function cuentasEquipo(proyectos: Proyecto[], asignaciones: Asignacion[], config: Config): CuentaEquipo[] {
  const minimo = config.capacidad?.margen_minimo_habiles ?? 5
  const margenes = new Map(margenesPorCuenta(asignaciones, config, proyectos).map(m => [m.proyectoId, m]))
  const out: CuentaEquipo[] = []
  for (const p of proyectos) {
    const fases = asignaciones
      .filter(a => a.proyecto_id === p.id && !a.es_bloqueo)
      .map(a => ({ id: a.id, tipo: a.tipo, persona_id: a.persona_id, inicio: a.inicio, fin: a.fin, dedicacion_pct: a.dedicacion_pct }))
      .sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0))
    if (!fases.length) continue
    const m = margenes.get(p.id)
    const personas: string[] = []
    for (const f of fases) if (!personas.includes(f.persona_id)) personas.push(f.persona_id)
    out.push({
      id: p.id, nombre: p.nombre, tier: tierDe(p.id, config),
      mesSalida: m?.mesSalida ?? mesSalidaDe(p.id, config),
      corte: m?.corte ?? null, finPruebas: m?.finPruebas ?? null,
      margen: m?.habiles ?? null,
      estadoMargen: m?.habiles == null ? 'sin_dato' : m.habiles >= minimo ? 'ok' : 'rojo',
      fases, personas,
    })
  }
  return out.sort((a, b) => {
    const ka = a.mesSalida ?? '9999', kb = b.mesSalida ?? '9999'
    return ka < kb ? -1 : ka > kb ? 1 : a.nombre.localeCompare(b.nombre)
  })
}

// ── B4: la franja de salidas ──────────────────────────────────────────────────

export interface SalidaMes {
  id: string | null
  nombre: string
  fueraDelPlan: boolean
  tier: Tier | null
  corte: string | null
  margen: number | null
  estado: 'ok' | 'rojo' | 'sin_dato'
}

export interface FranjaMes {
  mes: string
  label: string
  salidas: SalidaMes[]
  tope: number | null
  /** 'ok' si entra en el tope; 'permitido' si son 3 con 2 chicas; 'rojo' si se pasa. */
  estadoTope: 'ok' | 'permitido' | 'rojo'
  /** Peor estado del mes: tope y márgenes. */
  estado: 'ok' | 'ambar' | 'rojo'
}

export function franjaSalidas(proyectos: Proyecto[], asignaciones: Asignacion[], config: Config): FranjaMes[] {
  const meses = mesesDelPrograma(asignaciones, config)
  const porMes = salidasPorMes(config, proyectos)
  const margenes = new Map(margenesPorCuenta(asignaciones, config, proyectos).map(m => [m.proyectoId, m]))
  const tope = config.reglas_calendario?.tope_salidas_en_vivo_por_mes ?? null
  const minimo = config.capacidad?.margen_minimo_habiles ?? 5
  const feriados = feriadosDeConfig(config)
  const chicas = new Set(config.tiers_v3?.chica ?? [])

  return meses.map(mes => {
    const salidas: SalidaMes[] = (porMes.get(mes) ?? []).map(s => {
      if (!s.id) return { id: null, nombre: s.nombre, fueraDelPlan: true, tier: null, corte: null, margen: null, estado: 'ok' as const }
      const m = margenes.get(s.id)
      const margen = m?.habiles ?? null
      return {
        id: s.id, nombre: s.nombre, fueraDelPlan: false, tier: tierDe(s.id, config),
        corte: m?.corte ?? fechaCorteDe(s.id, mes, config, feriados), margen,
        estado: margen == null ? 'sin_dato' : margen >= minimo ? 'ok' : 'rojo',
      }
    })
    const nChicas = salidas.filter(s => s.id && chicas.has(s.id)).length
    const estadoTope: FranjaMes['estadoTope'] = tope == null || salidas.length <= tope
      ? 'ok' : salidas.length === 3 && nChicas >= 2 ? 'permitido' : 'rojo'
    const hayMargenRojo = salidas.some(s => s.estado === 'rojo')
    const estado: FranjaMes['estado'] = estadoTope === 'rojo' || hayMargenRojo ? 'rojo' : estadoTope === 'permitido' ? 'ambar' : 'ok'
    return { mes, label: nombreMes(mes), salidas, tope, estadoTope, estado }
  })
}

// ── B5: insumos ───────────────────────────────────────────────────────────────

export interface FilaTicket { cliente: string; tickets: number; pct_criticas: number; peso: number; escalados: number }

/**
 * Una frase que resuma la tabla de tickets: quién concentra escalados y retrabajo, y quién
 * tiene la tasa de críticas más alta (entre los que tienen un volumen mínimo para que el
 * porcentaje signifique algo).
 */
export function lecturaTickets(filas: FilaTicket[]): string {
  if (!filas.length) return ''
  const porPeso = [...filas].sort((a, b) => b.peso - a.peso || b.escalados - a.escalados)[0]
  const conVolumen = filas.filter(f => f.tickets >= 10)
  const porCriticas = [...(conVolumen.length ? conVolumen : filas)].sort((a, b) => b.pct_criticas - a.pct_criticas)[0]
  if (porPeso.cliente === porCriticas.cliente) {
    return `${porPeso.cliente} concentra escalados, retrabajo y la tasa de críticas más alta.`
  }
  return `${porPeso.cliente} concentra escalados y retrabajo; ${porCriticas.cliente} tiene la tasa de críticas más alta (${Math.round(porCriticas.pct_criticas)} %).`
}

export interface FilaEquipoHoy { cliente: string; analista: string; sistema: string; complejidad?: string | null; pays?: number | null }

/** Distribución de clientes por analista y por sistema; null si el bloque está en [FALTA]. */
export function equipoHoy(config: Config): { filas: FilaEquipoHoy[]; porAnalista: Array<{ analista: string; meta4: number; axton: number; otros: number }>; fuente?: string; corte?: string } | null {
  const b = config.insumos?.equipo_payroll_hoy
  if (!b || !Array.isArray(b.filas) || !b.filas.length) return null
  const m = new Map<string, { meta4: number; axton: number; otros: number }>()
  for (const f of b.filas) {
    const e = m.get(f.analista) ?? { meta4: 0, axton: 0, otros: 0 }
    const s = (f.sistema ?? '').toLowerCase().replace(/\s/g, '')
    if (s.startsWith('meta')) e.meta4++
    else if (s.startsWith('axton')) e.axton++
    else e.otros++
    m.set(f.analista, e)
  }
  const porAnalista = [...m.entries()].map(([analista, e]) => ({ analista, ...e }))
    .sort((a, b) => (b.meta4 + b.axton + b.otros) - (a.meta4 + a.axton + a.otros))
  return { filas: b.filas, porAnalista, fuente: b.fuente, corte: b.corte }
}

/** Violaciones de carga de una persona en un mes, para enlazar la prosa con la regla. */
export function violacionesDe(violaciones: Violacion[], personaId: string, mes: string): Violacion[] {
  return violaciones.filter(v => v.persona_id === personaId && (v.mes === mes || (v.semana ?? '').slice(0, 7) === mes))
}
