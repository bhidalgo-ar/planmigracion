import type { Asignacion, Config, Persona, Proyecto, TipoFase, Violacion } from './types'
import {
  cargaMensual, cuentasEnAxton, cuentasEnMeta4, horasDiaDe, mesSalidaDe, mesesEntre, salidasFueraDelPlan,
  ticketsAxton, ticketsMeta4Restantes, type CargaMensual,
} from './capacidad'

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
  Relevamiento: 'releva', Configuracion: 'configura', Pruebas: 'prueba', Cierre: 'actualiza',
  Vacaciones: 'está de vacaciones por',
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

export type Tier = 'chica' | 'std' | 'grande' | 'xl'
export const TIER_LABEL: Record<Tier, string> = { chica: 'chica', std: 'estándar', grande: 'grande', xl: 'XL' }

export function tierDe(proyectoId: string, config: Config): Tier | null {
  const t = config.tiers_v3
  if (!t) return null
  if (t.chica?.includes(proyectoId)) return 'chica'
  if (t.std?.includes(proyectoId)) return 'std'
  if (t.grande?.includes(proyectoId)) return 'grande'
  if (t.xl?.includes(proyectoId)) return 'xl'
  return null
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

// ── B3: cómo liquida cada analista, mes a mes ─────────────────────────────────

export interface FilaEquipoHoy {
  cliente: string
  analista: string
  sistema: string
  lider?: string | null
  complejidad?: string | number | null
  pays?: number | null
  /** Quien lleva la cuenta HOY, si la columna `analista` de la Matrix quedó vieja. */
  analista_destino?: string | null
}

function clasificarSistema(sistema: string): 'meta4' | 'axton' | 'otros' {
  const s = (sistema ?? '').toLowerCase().replace(/\s/g, '')
  return s.startsWith('meta') || s === 'm4' ? 'meta4' : s.startsWith('axton') ? 'axton' : 'otros'
}

/** Para matchear el nombre de la Matrix con la cuenta del plan: minúsculas, sin acentos, solo letras y números. */
function claveNombre(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

export interface CeldaAnalista {
  mes: string
  /** Nombres de las cuentas que ese mes liquida en cada sistema. */
  meta4: string[]
  axton: string[]
}

export interface FilaAnalista {
  analista: string
  cuentasHoy: number
  meses: CeldaAnalista[]
  /** Meses del programa en los que liquida en los dos sistemas a la vez. */
  mesesDobles: number
}

export interface TotalMes {
  mes: string
  /** Cuentas en Axton al cierre del mes (legacy + salidas). */
  axton: number
  /** Cuentas del programa (y fuera del plan) que siguen en Meta 4. */
  meta4: number
  ticketsAxton: number | null
  ticketsMeta4: number | null
  /** Cuentas que salen en vivo ese mes. */
  salen: string[]
}

export interface MatrizAnalistas {
  meses: string[]
  /** Analistas que en algún mes liquidan en Meta 4, ordenados por meses en dos sistemas. */
  filas: FilaAnalista[]
  /** Analistas 100 % Axton todo el programa. */
  soloAxton: FilaAnalista[]
  /** Cuentas que migran y no tienen fila en la Matrix: nadie sabe quién las liquida. */
  sinAnalista: string[]
  totales: TotalMes[]
  fuente?: string
  corte?: string
}

/**
 * Cuántas cuentas liquida cada analista en Meta 4 y en Axton al cierre de cada mes del
 * programa. Cruza la Matrix (`config.insumos.equipo_payroll_hoy`) con el mes de salida de
 * cada cuenta: quien la lleva hoy es `analista_destino` si existe, si no `analista`, y la
 * cuenta no cambia de manos al migrar. El objetivo que mide es cuántos meses cada analista
 * liquida en dos sistemas a la vez. null si el plan no trae la Matrix.
 */
export function matrizAnalistas(proyectos: Proyecto[], asignaciones: Asignacion[], config: Config): MatrizAnalistas | null {
  const b = config.insumos?.equipo_payroll_hoy
  if (!b || !Array.isArray(b.filas) || !b.filas.length) return null
  const meses = mesesDelPrograma(asignaciones, config)
  if (!meses.length) return null

  // Cuentas que migran, con su mes: las del plan (por nombre y por id) y las fuera del plan.
  const salidas: Array<{ nombre: string; mes: string; claves: string[] }> = []
  for (const p of proyectos) {
    const mes = mesSalidaDe(p.id, config)
    if (mes) salidas.push({ nombre: p.nombre, mes, claves: [claveNombre(p.nombre), claveNombre(p.id)] })
  }
  for (const c of config.salidas_en_vivo_fuera_del_plan?.cuentas ?? []) {
    if (typeof c.sale_en_vivo !== 'string' || !/^\d{4}-\d{2}$/.test(c.sale_en_vivo)) continue
    salidas.push({ nombre: c.alias ?? c.nombre, mes: c.sale_en_vivo, claves: [claveNombre(c.nombre), ...(c.alias ? [claveNombre(c.alias)] : [])] })
  }
  const salidaDe = (cliente: string) => { const k = claveNombre(cliente); return salidas.find(s => s.claves.includes(k)) ?? null }

  const cubiertas = new Set<string>()
  const porAnalista = new Map<string, FilaAnalista>()
  for (const f of b.filas as FilaEquipoHoy[]) {
    const destino = typeof f.analista_destino === 'string' ? f.analista_destino.trim() : ''
    const quien = destino || (f.analista ?? '').trim() || '[FALTA: analista]'
    const sist = clasificarSistema(f.sistema)
    const salida = salidaDe(f.cliente)
    if (salida) cubiertas.add(salida.nombre)
    const nombre = salida?.nombre ?? f.cliente
    const fila = porAnalista.get(quien) ?? { analista: quien, cuentasHoy: 0, meses: meses.map(mes => ({ mes, meta4: [], axton: [] })), mesesDobles: 0 }
    fila.cuentasHoy++
    for (const c of fila.meses) {
      const enAxton = sist === 'axton' || (salida !== null && salida.mes <= c.mes)
      if (enAxton) c.axton.push(nombre)
      else if (sist === 'meta4' || salida) c.meta4.push(nombre)
    }
    porAnalista.set(quien, fila)
  }
  const todas = [...porAnalista.values()]
  for (const f of todas) f.mesesDobles = f.meses.filter(c => c.meta4.length > 0 && c.axton.length > 0).length
  const conMeta4 = (f: FilaAnalista) => f.meses.some(c => c.meta4.length > 0)
  const filas = todas.filter(conMeta4).sort((a, b) => b.mesesDobles - a.mesesDobles || a.analista.localeCompare(b.analista, 'es'))
  const soloAxton = todas.filter(f => !conMeta4(f)).sort((a, b) => a.analista.localeCompare(b.analista, 'es'))
  const sinAnalista = salidas.filter(s => !cubiertas.has(s.nombre)).map(s => s.nombre).sort((a, b) => a.localeCompare(b, 'es'))
  const totales: TotalMes[] = meses.map(mes => ({
    mes,
    axton: cuentasEnAxton(mes, config),
    meta4: cuentasEnMeta4(mes, config).length,
    ticketsAxton: ticketsAxton(mes, config),
    ticketsMeta4: ticketsMeta4Restantes(mes, config),
    salen: salidas.filter(s => s.mes === mes).map(s => s.nombre),
  }))
  return { meses, filas, soloAxton, sinAnalista, totales, fuente: b.fuente, corte: b.corte }
}

/** Violaciones de carga de una persona en un mes, para enlazar la prosa con la regla. */
export function violacionesDe(violaciones: Violacion[], personaId: string, mes: string): Violacion[] {
  return violaciones.filter(v => v.persona_id === personaId && (v.mes === mes || (v.semana ?? '').slice(0, 7) === mes))
}
