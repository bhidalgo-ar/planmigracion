import { useEffect, useMemo, useRef, useState } from 'react'
import { format, addDays, parseISO, differenceInDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { cascadaIds, useSimuladorStore } from '../store'
import { aplicarOrdenYFiltro, DENSIDAD_PX, useUIStore, type ZoomLevel } from '../uiStore'
import type { Asignacion, Persona, TipoFase } from '../types'
import { TIPO_COLOR, TIPO_LABEL } from '../theme/fases'
import { cargaSemanal, mesSalidaDe, UMBRAL_AMBAR } from '../capacidad'
import { tierDe, TIER_LABEL } from '../insightsEquipo'
import { margenesPorCuenta, predecesoraViolada } from '../rules'
import { nombreTarea } from '../tareas'
import { getMondayOfWeek, parseDate, toISO, diasHabiles, feriadosDeConfig, formatFechaCorta } from '../utils/dates'

// Píxeles por día calendario según nivel de zoom
const PX_PER_DAY: Record<ZoomLevel, number> = {
  dias:       20,
  semanas:    32 / 7,   // 32px por semana
  meses:      3.5,      // ~107px por mes
  trimestres: 1.5,      // ~137px por trimestre
}

// Snap de drag (en días)
const SNAP_DAYS: Record<ZoomLevel, number> = {
  dias: 1, semanas: 7, meses: 7, trimestres: 7,
}

const NAME_W  = 176
const HEADER_H = 48
const MIN_BAR_W = 8
/** Separación vertical entre dos carriles (renglones) de la misma fila. */
const GAP_CARRIL = 6
/** Radio del rombo de una barra de Cierre (hito de un día) y del monograma de persona. */
const HITO_R = 8

/**
 * Iniciales de una persona para el monograma de la barra: 'Gaby F.' → 'GF', 'Moni' → 'Mo'.
 * Siempre dos letras a propósito: con una sola, Moni y Mati (o Guille y Gaby) quedarían
 * iguales, que es justo lo que se quiere poder distinguir.
 */
function inicialesDe(alias: string): string {
  const palabras = alias.trim().split(/\s+/).filter(Boolean)
  if (palabras.length > 1) return (palabras[0][0] + palabras[1][0]).toUpperCase()
  const p = palabras[0] ?? alias
  return (p[0] ?? '').toUpperCase() + (p[1] ?? '').toLowerCase()
}

/**
 * Una barra angosta no puede gastar 19 px en aire: con el padding de siempre, el texto no
 * entra y la barra queda muda.
 */
const esBarraAngosta = (width: number) => width < 64
const padDeBarra = (width: number) => (esBarraAngosta(width) ? 4 : 9)

/**
 * Ancho real de un texto en píxeles. Se mide con un canvas en lugar de estimar por cantidad
 * de letras porque la diferencia es enorme: en esta tipografía "GF" ocupa casi lo mismo que
 * "Gaby" —las mayúsculas miden casi el doble que las minúsculas— y con un promedio único el
 * texto entraba donde no entraba. Se cachea porque son pocas combinaciones repetidas muchas
 * veces.
 */
const anchoCache = new Map<string, number>()
let ctxMedidor: CanvasRenderingContext2D | null | undefined
function anchoDeTexto(txt: string, fontSize: number): number {
  const clave = `${fontSize}|${txt}`
  const cacheado = anchoCache.get(clave)
  if (cacheado !== undefined) return cacheado
  if (ctxMedidor === undefined) {
    ctxMedidor = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  // Sin canvas (entornos sin DOM real) se cae a una estimación por cantidad de letras.
  const w = ctxMedidor
    ? (ctxMedidor.font = `700 ${fontSize}px "Plus Jakarta Sans", system-ui, sans-serif`, ctxMedidor.measureText(txt).width)
    : txt.length * fontSize * 0.6
  anchoCache.set(clave, w)
  return w
}

/**
 * Qué texto entra en una barra de `width` píxeles, descontando el lugar del monograma
 * cuando corresponde. Recibe las variantes de la más completa a la más corta y devuelve la
 * primera que entra entera.
 */
function textoDeBarra(variantes: string[], width: number, fontSize: number, conMonograma: boolean): string {
  const reservaMono = conMonograma ? HITO_R * 2 + 6 : 0
  const util = width - padDeBarra(width) * 2 - reservaMono - (esBarraAngosta(width) ? 0 : 10)
  const entra = variantes.find(v => v === '' || anchoDeTexto(v, fontSize) <= util)
  return entra ?? ''
}

/** 'cascade' = la fase arrastrada + las posteriores de la misma cuenta (modo estricto). */
type DragMode = 'phase' | 'cascade' | 'resize'
interface DragState {
  id: string
  mode: DragMode
  proyectoId: string | null
  startX: number
  origInicio: string
  origFin: string
  origDur: number
  origPersona: string
  minDay?: number   // días mínimos desde horizonStart de la fase más temprana afectada
  dd: number        // días desplazados (snapshot; múltiplo de snapDays)
  persona: string
  cascada?: Set<string>   // ids que se mueven en bloque (solo en mode 'cascade')
}

const ROL_LABEL: Record<string, string> = {
  relevamiento: 'RELEV.', configuracion: 'CONFIG.', pruebas: 'PRUEBAS',
}

/** Las tres fases que se compactan en una sola barra por fase cuando la cuenta no está
 * seleccionada (el Cierre queda siempre aparte, como hito). */
const FASES_COMPACTABLES: TipoFase[] = ['Relevamiento', 'Configuracion', 'Pruebas']

// ── helpers de períodos ──────────────────────────────────────────────────────

function eachMondayBetween(from: Date, to: Date): Date[] {
  const result: Date[] = []
  let cur = getMondayOfWeek(from)
  while (cur <= to) { result.push(new Date(cur)); cur = addDays(cur, 7) }
  return result
}

function eachMonthStart(from: Date, to: Date): Date[] {
  const result: Date[] = []
  let cur = new Date(from.getFullYear(), from.getMonth(), 1)
  while (cur <= to) { result.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1) }
  return result
}

function eachQuarterStart(from: Date, to: Date): Date[] {
  const result: Date[] = []
  const qm = (m: number) => Math.floor(m / 3) * 3
  let cur = new Date(from.getFullYear(), qm(from.getMonth()), 1)
  while (cur <= to) {
    result.push(new Date(cur))
    cur = new Date(cur.getFullYear(), cur.getMonth() + 3, 1)
  }
  return result
}

// Label para una celda del header según zoom
function getPeriodLabel(
  p: Date, _i: number, zoom: ZoomLevel, hoy: Date,
): { isGroupStart: boolean; groupLabel: string; mainLabel: string; isHoy: boolean } {
  switch (zoom) {
    case 'dias': {
      const isFirst = p.getDate() === 1
      const showDay = isFirst || p.getDate() % 5 === 0
      return {
        isGroupStart: isFirst,
        groupLabel: isFirst ? format(p, 'MMM', { locale: es }).toUpperCase() : '',
        mainLabel: showDay ? String(p.getDate()) : '',
        isHoy: p.toDateString() === hoy.toDateString(),
      }
    }
    case 'semanas': {
      const isFirst = p.getDate() <= 7
      return {
        isGroupStart: isFirst,
        groupLabel: isFirst ? format(p, 'MMM', { locale: es }).toUpperCase() : '',
        mainLabel: String(p.getDate()),
        isHoy: hoy >= p && hoy <= addDays(p, 6),
      }
    }
    case 'meses': {
      const isJan = p.getMonth() === 0
      return {
        isGroupStart: isJan,
        groupLabel: isJan ? String(p.getFullYear()) : '',
        mainLabel: format(p, 'MMM', { locale: es }).toUpperCase(),
        isHoy: hoy.getFullYear() === p.getFullYear() && hoy.getMonth() === p.getMonth(),
      }
    }
    case 'trimestres': {
      const q = Math.floor(p.getMonth() / 3) + 1
      const isQ1 = q === 1
      return {
        isGroupStart: isQ1,
        groupLabel: isQ1 ? String(p.getFullYear()) : '',
        mainLabel: `T${q}`,
        isHoy: hoy >= p && hoy < new Date(p.getFullYear(), p.getMonth() + 3, 1),
      }
    }
  }
}

/** Una fila del timeline: una persona (modo persona) o una cuenta (modo cuenta). */
interface Fila { id: string; titulo: string }
/** Fila del modo cuenta para las barras sin cuenta: corridas iniciales, vacaciones. */
const SIN_CUENTA = '__sin_cuenta__'
/** Alto de la banda de carga semanal (modo cuenta): encabezado + una fila por persona con fases. */
const BANDA_HDR = 22
const BANDA_ROW = 34
/** 'oct 26' */
const mesCorto = (mes: string) => format(parseISO(`${mes}-01`), 'MMM yy', { locale: es })

/** Fila sintética para las fases cuya `persona_id` no existe en el plan. */
const SIN_ASIGNAR = '__sin_asignar__'
const FILA_SIN_ASIGNAR: Persona = {
  id: SIN_ASIGNAR, alias: 'Sin asignar', skills: [], capacidad_horas_semana: 0, buffer_pct: 0,
  _nota: 'Fases con una persona que no existe en el plan. Arrastralas a alguien del equipo.',
}

/**
 * Lo que se dibuja en el timeline. En modo cuenta, mientras la cuenta no está seleccionada
 * ("colapsada"), Relevamiento, Configuración y Pruebas entran como un solo item por fase
 * (`kind: 'fase'`), y solo al seleccionarla (`kind: 'barra'`, una por tarea) se ve el detalle.
 * El Cierre es siempre un hito (`kind: 'cierre'`), colapsada o no: un rombo de un día no
 * necesita esconderse. `asig` viaja en los items de una sola barra real (barra/cierre); los
 * de fase agrupan varias (`asigIds`) y no son arrastrables.
 */
interface ItemBarra {
  id: string
  kind: 'barra' | 'fase' | 'cierre'
  tipo: TipoFase
  inicio: string
  fin: string
  personaIds: string[]
  asigIds: string[]
  filaId: string
  asig?: Asignacion
  esBloqueo?: boolean
}

// ── Componente ──────────────────────────────────────────────────────────────

export function Timeline() {
  const {
    personas: personasTodas, proyectos, asignaciones, config, violaciones,
    clienteSeleccionado, updateAsignacion, shiftCascadaDias, seleccionarCliente,
  } = useSimuladorStore()
  const {
    mostrarCarga, mostrarDep, mostrarConflictos, zoom, irHoyToken, modoMovimiento, densidad,
    ordenPersonas, personasOcultas, previsualizacion, modoFilas,
  } = useUIStore()
  const porCuenta = modoFilas === 'cuenta'

  // Filas que se ven, en el orden elegido por el usuario. Todo el render y la
  // matemática de arrastre vertical trabajan sobre esta lista, no sobre el store.
  // Una fase cuya persona no existe en el plan no desaparece: se dibuja en una fila
  // "Sin asignar" al final, para que se vea y se pueda arrastrar a alguien.
  const idsPersonas = useMemo(() => new Set(personasTodas.map(p => p.id)), [personasTodas])
  const hayHuerfanas = useMemo(() => asignaciones.some(a => !idsPersonas.has(a.persona_id)), [asignaciones, idsPersonas])
  const personas = useMemo(() => {
    const visibles = aplicarOrdenYFiltro(personasTodas, ordenPersonas, personasOcultas)
    return hayHuerfanas ? [...visibles, FILA_SIN_ASIGNAR] : visibles
  }, [personasTodas, ordenPersonas, personasOcultas, hayHuerfanas])
  // Modo cuenta: una fila por cuenta, ordenadas por mes de salida y después por su primera
  // fase. Las barras sin cuenta (corridas iniciales, vacaciones) van a una fila propia al final.
  const hayBloqueosSueltos = useMemo(() => asignaciones.some(a => !a.proyecto_id), [asignaciones])
  const filasCuenta = useMemo((): Fila[] => {
    const primera = new Map<string, string>()
    for (const a of asignaciones) {
      if (!a.proyecto_id || a.es_bloqueo) continue
      const m = primera.get(a.proyecto_id)
      if (!m || a.inicio < m) primera.set(a.proyecto_id, a.inicio)
    }
    const orden = [...proyectos].sort((a, b) => {
      const ma = mesSalidaDe(a.id, config) ?? '9999', mb = mesSalidaDe(b.id, config) ?? '9999'
      if (ma !== mb) return ma < mb ? -1 : 1
      const pa = primera.get(a.id) ?? '9999', pb = primera.get(b.id) ?? '9999'
      return pa < pb ? -1 : pa > pb ? 1 : a.nombre.localeCompare(b.nombre, 'es')
    })
    const out: Fila[] = orden.map(p => ({ id: p.id, titulo: p.nombre }))
    if (hayBloqueosSueltos) out.push({ id: SIN_CUENTA, titulo: 'Sin cuenta' })
    return out
  }, [proyectos, asignaciones, config, hayBloqueosSueltos])
  const filas: Fila[] = useMemo(
    () => (porCuenta ? filasCuenta : personas.map(p => ({ id: p.id, titulo: p.alias }))),
    [porCuenta, filasCuenta, personas],
  )
  /** Id de la fila donde se dibuja una fase: su cuenta (modo cuenta) o su persona (modo persona, "Sin asignar" si no existe). */
  const filaIdDe = (a: Asignacion) => porCuenta
    ? (a.proyecto_id ?? SIN_CUENTA)
    : (idsPersonas.has(a.persona_id) ? a.persona_id : SIN_ASIGNAR)
  const aliasPorId = useMemo(() => new Map(personasTodas.map(p => [p.id, p.alias])), [personasTodas])

  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef   = useRef<HTMLDivElement>(null)

  const { row: ROW_H, bar: BAR_H } = DENSIDAD_PX[densidad]
  const feriados = useMemo(() => feriadosDeConfig(config), [config])

  const horizonStart = useMemo(() => parseDate(config.horizonte.desde), [config.horizonte.desde])
  const horizonEnd   = useMemo(() => parseDate(config.horizonte.hasta), [config.horizonte.hasta])
  const pxPerDay  = PX_PER_DAY[zoom]
  const snapDays  = SNAP_DAYS[zoom]
  const totalDays = useMemo(() => differenceInDays(horizonEnd, horizonStart) + 1, [horizonStart, horizonEnd])
  const bodyW     = NAME_W + totalDays * pxPerDay

  // fecha ISO → posición x en píxeles (continua)
  const dateToX = (iso: string): number =>
    NAME_W + differenceInDays(parseISO(iso), horizonStart) * pxPerDay

  const dateToXd = (d: Date): number =>
    NAME_W + differenceInDays(d, horizonStart) * pxPerDay

  const proyectoPorId = useMemo(() => new Map(proyectos.map(p => [p.id, p])), [proyectos])
  const filaDe        = useMemo(() => new Map(filas.map((f, i) => [f.id, i])), [filas])

  /**
   * Los items a dibujar por fila (`ItemBarra`, ver arriba) y sus carriles. En modo cuenta,
   * la cuenta seleccionada se "expande" a una barra por tarea (Opción A); el resto queda
   * compactada a una barra por fase (Opción D: menos densidad, un clic la abre). En modo
   * persona y en la fila "Sin cuenta" siempre es una barra por asignación, como antes.
   *
   * Antes se empacaban SIEMPRE las asignaciones individuales de la cuenta entera, así que
   * cada fila medía lo que pedía su peor solapamiento aunque estuviera colapsada; ahora la
   * mayoría de las filas quedan en un carril (la fase-resumen rara vez se pisa con otra) y
   * solo la fila expandida crece.
   */
  const { itemsPorFila, carrilDe, carrilesDeFila } = useMemo(() => {
    const itemsPorFila = new Map<string, ItemBarra[]>()
    const carrilDe = new Map<string, number>()
    const carrilesDeFila = new Map<string, number>()

    function empacar(items: ItemBarra[]): number {
      const orden = [...items].sort((x, y) =>
        x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : x.fin < y.fin ? -1 : x.fin > y.fin ? 1 : 0)
      const finDeCarril: string[] = []
      for (const it of orden) {
        let c = finDeCarril.findIndex(fin => fin < it.inicio)
        if (c === -1) { c = finDeCarril.length; finDeCarril.push(it.fin) }
        else if (finDeCarril[c] < it.fin) finDeCarril[c] = it.fin
        carrilDe.set(it.id, c)
      }
      return Math.max(1, finDeCarril.length)
    }

    if (porCuenta) {
      for (const f of filasCuenta) {
        if (f.id === SIN_CUENTA) continue
        const propias = asignaciones.filter(a => a.proyecto_id === f.id && !a.es_bloqueo)
        const cierres = propias.filter(a => a.tipo === 'Cierre')
        const expandida = clienteSeleccionado === f.id
        const items: ItemBarra[] = []
        if (expandida) {
          for (const a of propias) {
            if (a.tipo === 'Cierre') continue
            items.push({ id: a.id, kind: 'barra', tipo: a.tipo, inicio: a.inicio, fin: a.fin, personaIds: [a.persona_id], asigIds: [a.id], filaId: f.id, asig: a })
          }
        } else {
          for (const tipo of FASES_COMPACTABLES) {
            const bs = propias.filter(a => a.tipo === tipo)
            if (!bs.length) continue
            const inicio = bs.reduce((m, a) => (a.inicio < m ? a.inicio : m), bs[0].inicio)
            const fin = bs.reduce((m, a) => (a.fin > m ? a.fin : m), bs[0].fin)
            items.push({
              id: `${f.id}::${tipo}`, kind: 'fase', tipo, inicio, fin,
              personaIds: [...new Set(bs.map(a => a.persona_id))], asigIds: bs.map(a => a.id), filaId: f.id,
            })
          }
        }
        for (const c of cierres) {
          items.push({ id: c.id, kind: 'cierre', tipo: 'Cierre', inicio: c.inicio, fin: c.fin, personaIds: [c.persona_id], asigIds: [c.id], filaId: f.id, asig: c })
        }
        itemsPorFila.set(f.id, items)
        carrilesDeFila.set(f.id, empacar(items))
      }
    }
    // Filas de persona y la fila "Sin cuenta": siempre una barra por asignación.
    for (const a of asignaciones) {
      const filaId = porCuenta ? (a.proyecto_id ? null : SIN_CUENTA) : (idsPersonas.has(a.persona_id) ? a.persona_id : SIN_ASIGNAR)
      if (filaId === null) continue
      const item: ItemBarra = {
        id: a.id, kind: a.tipo === 'Cierre' && !a.es_bloqueo ? 'cierre' : 'barra', tipo: a.tipo,
        inicio: a.inicio, fin: a.fin, personaIds: [a.persona_id], asigIds: [a.id], filaId, asig: a, esBloqueo: a.es_bloqueo,
      }
      const arr = itemsPorFila.get(filaId)
      if (arr) arr.push(item); else itemsPorFila.set(filaId, [item])
    }
    for (const [filaId, items] of itemsPorFila) {
      if (carrilesDeFila.has(filaId)) continue
      carrilesDeFila.set(filaId, empacar(items))
    }
    return { itemsPorFila, carrilDe, carrilesDeFila }
  }, [porCuenta, filasCuenta, asignaciones, clienteSeleccionado, idsPersonas])

  /**
   * Dónde empieza y cuánto mide cada fila. Con un solo carril el alto es ROW_H y todo queda
   * igual que antes; cada carril extra suma una barra más su separación.
   */
  const { topDeFila, altoDeFila, bodyH } = useMemo(() => {
    const topDeFila = new Map<string, number>()
    const altoDeFila = new Map<string, number>()
    let acc = 0
    for (const f of filas) {
      const n = carrilesDeFila.get(f.id) ?? 1
      const h = ROW_H + (n - 1) * (BAR_H + GAP_CARRIL)
      topDeFila.set(f.id, acc)
      altoDeFila.set(f.id, h)
      acc += h
    }
    return { topDeFila, altoDeFila, bodyH: acc }
  }, [filas, carrilesDeFila, ROW_H, BAR_H])

  /** Y de una barra: el arranque de su fila, centrada en su carril. */
  const topBarra = (filaId: string, carril: number) =>
    (topDeFila.get(filaId) ?? 0) + (ROW_H - BAR_H) / 2 + carril * (BAR_H + GAP_CARRIL)

  // Conflictos en rojo por cuenta, para el badge de la fila en modo cuenta.
  const statsCuenta = useMemo(() => {
    const m = new Map<string, number>()
    const cuentaDeFase = new Map(asignaciones.map(a => [a.id, a.proyecto_id]))
    for (const v of violaciones) {
      if (v.severidad !== 'rojo') continue
      const pid = v.proyecto_id ?? (v.asignacion_id ? cuentaDeFase.get(v.asignacion_id) : null)
      if (pid) m.set(pid, (m.get(pid) ?? 0) + 1)
    }
    return m
  }, [violaciones, asignaciones])

  /** Margen de cada cuenta contra el corte de novedades (fin del cierre, o de Pruebas si no
   * tiene). Solo modo cuenta: un corchete y una fecha de corte por fila. */
  const margenPorCuenta = useMemo(() => {
    if (!porCuenta) return new Map<string, ReturnType<typeof margenesPorCuenta>[number]>()
    return new Map(margenesPorCuenta(asignaciones, config, proyectos).map(m => [m.proyectoId, m]))
  }, [porCuenta, asignaciones, config, proyectos])

  const minimoMargen = config.capacidad?.margen_minimo_habiles ?? 2
  const blackout = config.tiers_v3?.blackout_config

  const asigProyecto = useMemo(() => new Map(asignaciones.map(a => [a.id, a.proyecto_id])), [asignaciones])

  // Carga semanal de todas las personas con fases: la usan la banda (modo cuenta) y la curva
  // de ocupación de fondo (modo persona). Un solo cálculo para las dos vistas.
  const cargaSemanalTodas = useMemo(() => {
    const conFases = personasTodas.filter(p => asignaciones.some(a => a.persona_id === p.id && !a.es_bloqueo))
    return { personas: conFases, semanas: cargaSemanal(conFases, asignaciones, config) }
  }, [personasTodas, asignaciones, config])

  // Banda de carga (modo cuenta): horas planificadas contra capacidad, por persona y semana,
  // con el desglose por cuenta para apilar sin necesitar una leyenda de colores.
  const bandaFilas = useMemo(() => {
    if (!porCuenta) return []
    const { personas: conFases, semanas: carga } = cargaSemanalTodas
    const hoyMs = Date.now()
    const semanaHoyISO = toISO(getMondayOfWeek(new Date()))
    return conFases.map(p => {
      const propias = carga.filter(c => c.personaId === p.id)
      const conCap = propias.filter(c => c.capacidad > 0)
      // Capacidad real de la semana actual (o la más cercana con capacidad), no un promedio de
      // todo el horizonte: la de Moni baja con el tiempo y un promedio la disimula (D2 con Willy).
      const actual = conCap.find(c => c.semana === semanaHoyISO)
        ?? conCap.slice().sort((a, b) => Math.abs(parseISO(a.semana).getTime() - hoyMs) - Math.abs(parseISO(b.semana).getTime() - hoyMs))[0]
      const semanas = propias.filter(c => c.horas > 0).map(c => {
        const porCuentaHoras = new Map<string, number>()
        for (const [barraId, h] of Object.entries(c.porBarra)) {
          const pid = asigProyecto.get(barraId) ?? SIN_CUENTA
          porCuentaHoras.set(pid, (porCuentaHoras.get(pid) ?? 0) + h)
        }
        return {
          semana: c.semana, horas: c.horas, capacidad: c.capacidad,
          porCuenta: [...porCuentaHoras.entries()].sort((a, b) => b[1] - a[1]),
        }
      })
      return { persona: p, semanas, capSemana: actual?.capacidad ?? 0 }
    })
  }, [porCuenta, cargaSemanalTodas, asigProyecto])
  const bandaH = porCuenta && bandaFilas.length ? BANDA_HDR + bandaFilas.length * BANDA_ROW : 0

  // barras que se pintan enteras de rojo: la fase en sí rompe una regla del calendario
  // (pruebas antes de cerrar la configuración, poco margen al corte, configuración en blackout)
  const barRojo = useMemo(() => {
    const s = new Set<string>()
    if (!mostrarConflictos) return s
    for (const v of violaciones)
      if (v.severidad === 'rojo' && (v.tipo === 'dependencia' || v.tipo === 'margen' || v.tipo === 'blackout' || v.tipo === 'vacaciones') && v.asignacion_id)
        s.add(v.asignacion_id)
    return s
  }, [violaciones, mostrarConflictos])

  // carga: (personaId|lunesISO) → severidad. Alimenta la curva de ocupación (modo persona)
  // y el anillo de las barras. `carga_semana` (ámbar) tiñe su semana; `carga_mes` (rojo)
  // tiñe todas las semanas del mes que se pasa de capacidad.
  const cargaCelda = useMemo(() => {
    const m = new Map<string, 'rojo' | 'ambar'>()
    const marcar = (key: string, sev: 'rojo' | 'ambar') => {
      if (sev === 'rojo' || m.get(key) !== 'rojo') m.set(key, sev)
    }
    for (const v of violaciones) {
      if (!v.persona_id || v.severidad === 'info') continue
      if (v.tipo === 'carga_semana' && v.semana) marcar(`${v.persona_id}|${v.semana}`, v.severidad)
      if (v.tipo === 'carga_mes' && v.mes) {
        const [y, mo] = v.mes.split('-').map(Number)
        const ultimo = new Date(y, mo, 0)
        for (let d = getMondayOfWeek(new Date(y, mo - 1, 1)); d <= ultimo; d = addDays(d, 7))
          marcar(`${v.persona_id}|${toISO(d)}`, v.severidad)
      }
    }
    return m
  }, [violaciones])

  // ¿la barra está en alguna semana sobrecargada? → anillo
  function ringDe(a: Asignacion): 'rojo' | 'ambar' | null {
    let worst: 'rojo' | 'ambar' | null = null
    for (const [key, sev] of cargaCelda) {
      if (!key.startsWith(a.persona_id + '|')) continue
      const lunesISO = key.split('|')[1]
      const viernesISO = toISO(addDays(parseISO(lunesISO), 4))
      if (a.inicio <= viernesISO && a.fin >= lunesISO) {
        if (sev === 'rojo') return 'rojo'
        worst = 'ambar'
      }
    }
    return worst
  }

  // ── drag ────────────────────────────────────────────────────────────────────

  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  useEffect(() => { dragRef.current = drag }, [drag])

  useEffect(() => {
    if (!drag) return
    const startX = drag.startX

    function onMove(e: MouseEvent) {
      const rawDd = Math.round((e.clientX - startX) / (pxPerDay * snapDays)) * snapDays
      let persona = dragRef.current?.persona ?? drag!.persona
      // Vertical = reasignar persona. En cascada solo cambia de fila la fase arrastrada;
      // las siguientes se mueven en el tiempo pero conservan su asignado.
      // En modo cuenta las filas son cuentas: arrastrar en vertical no reasigna a nadie.
      // Dividir por ROW_H vale porque acá las filas son de personas y todas miden igual: los
      // carriles de alto variable existen solo en modo cuenta, que esta rama no atiende.
      if (drag!.mode !== 'resize' && rowsRef.current && !porCuenta) {
        const rect = rowsRef.current.getBoundingClientRect()
        const idx = Math.max(0, Math.min(personas.length - 1, Math.floor((e.clientY - rect.top) / ROW_H)))
        persona = personas[idx]?.id ?? persona
      }
      setDrag(d => (d && d.dd === rawDd && d.persona === persona) ? d : (d ? { ...d, dd: rawDd, persona } : d))
    }

    function onUp() {
      const d = dragRef.current
      if (d) commitDrag(d)
      setDrag(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, personas, pxPerDay, snapDays, ROW_H, porCuenta])

  function commitDrag(d: DragState) {
    if (d.mode === 'cascade') {
      const ddc = Math.max(d.dd, -(d.minDay ?? 0))
      if (ddc === 0 && d.persona === d.origPersona) { seleccionarCliente(d.proyectoId); return }
      shiftCascadaDias(d.id, ddc, d.persona !== d.origPersona ? d.persona : undefined)
      return
    }
    if (d.mode === 'resize') {
      let newFin = toISO(addDays(parseISO(d.origFin), d.dd))
      if (newFin < d.origInicio) newFin = d.origInicio
      const dur = diasHabiles(d.origInicio, newFin, feriados)
      if (dur !== d.origDur) updateAsignacion(d.id, { duracion_dias: dur })
      return
    }
    // phase
    const dayMin = -differenceInDays(parseISO(d.origInicio), horizonStart)
    const ddc = Math.max(d.dd, dayMin)
    if (ddc === 0 && d.persona === d.origPersona) { seleccionarCliente(d.proyectoId); return }
    const inicio = toISO(addDays(parseISO(d.origInicio), ddc))
    const patch: Partial<Asignacion> = {}
    if (inicio !== d.origInicio) patch.inicio = inicio
    if (d.persona !== d.origPersona) patch.persona_id = d.persona
    if (Object.keys(patch).length) updateAsignacion(d.id, patch)
  }

  function onBarDown(e: React.MouseEvent, a: Asignacion, mode: DragMode) {
    if (a.es_bloqueo) return
    if (e.button !== 0) return   // botón medio → deja pasar el pan del fondo
    e.preventDefault(); e.stopPropagation()
    // Modo estricto = arrastra esta fase y las SIGUIENTES de la cuenta (no las anteriores).
    // Shift invierte el modo puntualmente.
    const estricto = modoMovimiento === 'estricto'
    const enCascada = estricto ? !e.shiftKey : e.shiftKey
    const cascadeMode = mode !== 'resize' && enCascada && !!a.proyecto_id
    let cascada: Set<string> | undefined
    let minDay: number | undefined
    if (cascadeMode) {
      cascada = cascadaIds(asignaciones, a.id)
      const days = asignaciones
        .filter(x => cascada!.has(x.id))
        .map(x => differenceInDays(parseISO(x.inicio), horizonStart))
      minDay = days.length ? Math.max(0, Math.min(...days)) : 0
    }
    setDrag({
      id: a.id, mode: cascadeMode ? 'cascade' : mode,
      proyectoId: a.proyecto_id,
      startX: e.clientX,
      origInicio: a.inicio, origFin: a.fin, origDur: a.duracion_dias,
      origPersona: a.persona_id, minDay, dd: 0, persona: a.persona_id,
      cascada,
    })
  }

  // ── pan: agarrar el fondo con el mouse y desplazar ─────────────────────────

  const [paneando, setPaneando] = useState(false)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  // Las barras cortan la propagación: si el mousedown llega acá, fue en el fondo.
  // El botón del medio pana siempre, incluso arrancando sobre una barra.
  function onFondoDown(e: React.MouseEvent) {
    if (e.button !== 0 && e.button !== 1) return
    const el = scrollRef.current
    if (!el) return
    panRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    setPaneando(true)
    e.preventDefault()
  }

  useEffect(() => {
    if (!paneando) return
    let movido = false

    function onMove(e: MouseEvent) {
      const p = panRef.current, el = scrollRef.current
      if (!p || !el) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      // Umbral: un clic con temblor de mano sigue siendo un clic.
      if (!movido && Math.abs(dx) + Math.abs(dy) < 4) return
      movido = true
      el.scrollLeft = p.left - dx
      el.scrollTop  = p.top - dy
    }

    function onUp() {
      // Clic seco en el fondo = deseleccionar la cuenta.
      if (!movido && clienteSeleccionado) seleccionarCliente(null)
      setPaneando(false)
      panRef.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneando, clienteSeleccionado])

  // Rueda: si no hay scroll vertical (equipo chico), la rueda desplaza en horizontal.
  function onWheel(e: React.WheelEvent) {
    const el = scrollRef.current
    if (!el || e.deltaY === 0) return
    const sinVertical = el.scrollHeight <= el.clientHeight + 1
    if (sinVertical || e.shiftKey) el.scrollLeft += e.deltaY
  }

  // scroll al seleccionar cuenta
  useEffect(() => {
    if (!clienteSeleccionado || !scrollRef.current) return
    const fases = asignaciones.filter(a => a.proyecto_id === clienteSeleccionado)
    if (!fases.length) return
    const minIso = fases.reduce((m, a) => (a.inicio < m ? a.inicio : m), fases[0].inicio)
    const x = dateToX(minIso)
    scrollRef.current.scrollTo({ left: Math.max(0, x - 120), behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSeleccionado])

  // scroll al día de hoy (botón "📍 Hoy")
  useEffect(() => {
    if (irHoyToken === 0 || !scrollRef.current) return
    const d = differenceInDays(new Date(), horizonStart)
    const x = NAME_W + d * pxPerDay
    const visible = scrollRef.current.clientWidth
    scrollRef.current.scrollTo({ left: Math.max(0, x - Math.max(120, visible / 2)), behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irHoyToken])

  // líneas verticales de referencia
  const transicion = config.fechas_clave.transicion_susana_toyota
  const transicionX = transicion ? dateToX(transicion) : null

  const hoyX = useMemo(() => {
    const d = differenceInDays(new Date(), horizonStart)
    if (d < 0 || d >= totalDays) return null
    return NAME_W + d * pxPerDay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonStart, totalDays, pxPerDay])

  // ── geometría de barras (con preview de drag) ────────────────────────────

  function geom(a: Asignacion) {
    let inicioISO = a.inicio, finISO = a.fin
    let filaId = filaIdDe(a)

    if (drag) {
      if (drag.mode === 'phase' && drag.id === a.id) {
        const dayMin = -differenceInDays(parseISO(a.inicio), horizonStart)
        const ddc = Math.max(drag.dd, dayMin)
        inicioISO = toISO(addDays(parseISO(a.inicio), ddc))
        finISO    = toISO(addDays(parseISO(a.fin), ddc))
        if (filaDe.has(drag.persona)) filaId = drag.persona
      } else if (drag.mode === 'resize' && drag.id === a.id) {
        finISO = toISO(addDays(parseISO(drag.origFin), drag.dd))
        if (finISO < drag.origInicio) finISO = drag.origInicio
      } else if (drag.mode === 'cascade' && drag.cascada?.has(a.id)) {
        const ddc = Math.max(drag.dd, -(drag.minDay ?? 0))
        inicioISO = toISO(addDays(parseISO(a.inicio), ddc))
        finISO    = toISO(addDays(parseISO(a.fin), ddc))
        if (drag.id === a.id && filaDe.has(drag.persona)) filaId = drag.persona
      }
    }

    const left  = dateToX(inicioISO)
    const right = dateToX(finISO) + pxPerDay   // fin es inclusivo
    const width = Math.max(MIN_BAR_W, right - left)
    const top   = topBarra(filaId, carrilDe.get(a.id) ?? 0)
    return { left, width, top }
  }

  // ── dependencias ────────────────────────────────────────────────────────────

  const depSegs = useMemo(() => {
    if (!mostrarDep || !clienteSeleccionado) return []
    const segs: { x1: number; y1: number; x2: number; y2: number; viola: boolean }[] = []
    const fases = asignaciones.filter(a => a.proyecto_id === clienteSeleccionado)
    const byId  = new Map(asignaciones.map(a => [a.id, a]))
    for (const a of fases) {
      const filaA = filaIdDe(a)
      if (!filaDe.has(filaA)) continue
      for (const predId of a.predecesoras) {
        const pred = byId.get(predId)
        if (!pred) continue
        const filaP = filaIdDe(pred)
        if (!filaDe.has(filaP)) continue
        // La flecha apunta al centro de cada barra, que con carriles ya no es el de la fila.
        segs.push({
          x1: dateToX(pred.fin) + pxPerDay,
          y1: topBarra(filaP, carrilDe.get(pred.id) ?? 0) + BAR_H / 2,
          x2: dateToX(a.inicio),
          y2: topBarra(filaA, carrilDe.get(a.id) ?? 0) + BAR_H / 2,
          viola: predecesoraViolada(a, pred, config, feriados) === true,
        })
      }
    }
    return segs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarDep, clienteSeleccionado, asignaciones, personas, pxPerDay, ROW_H, BAR_H, topDeFila, carrilDe, config, feriados])

  // ── períodos para header ─────────────────────────────────────────────────

  const periodos = useMemo((): Date[] => {
    switch (zoom) {
      case 'dias':
        return Array.from({ length: totalDays }, (_, i) => addDays(horizonStart, i))
      case 'semanas':
        return eachMondayBetween(horizonStart, horizonEnd)
      case 'meses':
        return eachMonthStart(horizonStart, horizonEnd)
      case 'trimestres':
        return eachQuarterStart(horizonStart, horizonEnd)
    }
  }, [zoom, horizonStart, horizonEnd, totalDays])

  // líneas verticales en el body (no en zoom días, demasiadas)
  const gridLines = useMemo(() => {
    if (zoom === 'dias') return eachMonthStart(horizonStart, horizonEnd)
    return periodos
  }, [zoom, periodos, horizonStart, horizonEnd])

  const hoy = new Date()

  // ── métricas por persona para la columna izquierda ──────────────────────────

  const statsPersona = useMemo(() => {
    const m = new Map<string, { fases: number; cuentas: number; semRojas: number }>()
    for (const p of personas) {
      const suyas = asignaciones.filter(a => a.persona_id === p.id && !a.es_bloqueo)
      // meses en que la persona se pasa de su capacidad
      const semRojas = violaciones.filter(
        v => v.tipo === 'carga_mes' && v.severidad === 'rojo' && v.persona_id === p.id,
      ).length
      m.set(p.id, {
        fases: suyas.length,
        cuentas: new Set(suyas.map(a => a.proyecto_id)).size,
        semRojas,
      })
    }
    return m
  }, [personas, asignaciones, violaciones])

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div
      ref={scrollRef}
      className="timeline-scroll"
      onMouseDown={onFondoDown}
      onWheel={onWheel}
      title="Arrastrá el fondo (o el botón del medio) para desplazar el timeline"
      style={{
        overflowY: 'auto', height: '100%', background: 'var(--white)',
        cursor: paneando ? 'grabbing' : 'grab',
      }}
    >
      <div style={{ position: 'relative', width: bodyW, minWidth: bodyW }}>

        {/* HEADER */}
        <div style={{ position: 'sticky', top: 0, zIndex: 30, height: HEADER_H, background: 'var(--white)', borderBottom: '2px solid var(--line)', display: 'flex' }}>
          {/* Columna Persona */}
          <div style={{ position: 'sticky', left: 0, zIndex: 31, width: NAME_W, flexShrink: 0, display: 'flex', alignItems: 'center', paddingLeft: 12, fontSize: 12, fontWeight: 700, color: 'var(--t2)', background: 'var(--paper)', borderRight: '2px solid var(--line)' }}>
            {porCuenta ? 'Cuenta · sale en vivo' : 'Persona'}
          </div>
          {/* Celdas de períodos */}
          <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
            {periodos.map((p, i) => {
              const nextP = periodos[i + 1] ?? addDays(horizonEnd, 1)
              const x = dateToXd(p) - NAME_W
              const w = Math.max(1, dateToXd(nextP) - dateToXd(p))
              const { isGroupStart, groupLabel, mainLabel, isHoy } = getPeriodLabel(p, i, zoom, hoy)
              return (
                <div key={i} style={{
                  position: 'absolute', left: x, width: w, height: HEADER_H, top: 0,
                  borderRight: '1px solid var(--line-soft)',
                  background: isHoy ? 'var(--celeste-dim)' : isGroupStart ? 'var(--paper)' : 'var(--white)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', userSelect: 'none',
                }}>
                  {groupLabel && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--t2)', letterSpacing: '0.08em' }}>{groupLabel}</span>}
                  {mainLabel  && <span style={{ fontSize: 8, color: isGroupStart ? 'var(--t2)' : 'var(--t3)', fontWeight: isGroupStart ? 600 : 400 }}>{mainLabel}</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* BANDA DE CARGA (modo cuenta): pegada debajo del encabezado, siempre visible mientras
            se scrollea — antes vivía al pie de la pantalla y el scroll se la comía. Apilada por
            cuenta (sin leyenda de colores: el nombre va escrito adentro de cada tramo) en vez
            de por severidad, así se ve de un vistazo qué cuenta causa el pico. */}
        {bandaH > 0 && (
          <div style={{ position: 'sticky', top: HEADER_H, height: bandaH, zIndex: 25, background: 'var(--white)', borderBottom: '2px solid var(--line)', boxShadow: '0 4px 12px rgba(30,58,95,0.06)', display: 'flex' }}>
            <div style={{ position: 'sticky', left: 0, top: 0, width: NAME_W, flexShrink: 0, zIndex: 20 }}>
              <div style={{ height: BANDA_HDR, background: 'var(--paper)', borderRight: '2px solid var(--line)', borderBottom: '1px solid var(--line-soft)', display: 'flex', alignItems: 'center', paddingLeft: 12, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--celeste-dark)' }}>
                Carga por semana
              </div>
              {bandaFilas.map((f, i) => (
                <div key={f.persona.id} style={{ height: BANDA_ROW, background: i % 2 ? 'var(--paper)' : 'var(--white)', borderRight: '2px solid var(--line)', borderBottom: '1px solid var(--line-soft)', display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 14 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>{f.persona.alias}</span>
                  {f.capSemana > 0 && <span className="num" style={{ fontSize: 9.5, color: 'var(--t2)' }}>{Math.round(f.capSemana)} h/sem</span>}
                </div>
              ))}
            </div>
            <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: bodyW - NAME_W, height: BANDA_HDR, background: 'var(--paper)', borderBottom: '1px solid var(--line-soft)' }} />
              {bandaFilas.map((f, i) => (
                <div key={f.persona.id} style={{ position: 'absolute', top: BANDA_HDR + i * BANDA_ROW, left: 0, width: bodyW - NAME_W, height: BANDA_ROW, background: i % 2 ? 'var(--paper)' : 'var(--white)', borderBottom: '1px solid var(--line-soft)' }} />
              ))}
              {gridLines.map((p, i) => (
                <div key={i} style={{ position: 'absolute', top: 0, left: dateToXd(p) - NAME_W, height: bandaH, borderLeft: '1px solid var(--line-soft)', zIndex: 1, pointerEvents: 'none' }} />
              ))}
              {hoyX !== null && <div style={{ position: 'absolute', top: 0, left: hoyX - NAME_W, height: bandaH, borderLeft: '2px solid var(--celeste)', zIndex: 5, pointerEvents: 'none' }} />}
              {bandaFilas.map((f, i) => f.semanas.map(c => {
                const x1 = dateToX(c.semana) - NAME_W
                if (x1 < -1 || x1 > bodyW) return null
                const w = Math.max(3, 7 * pxPerDay - 2)
                const pct = c.capacidad > 0 ? c.horas / c.capacidad : 9
                const hMax = BANDA_ROW - 8
                let acc = 0
                return (
                  <div key={c.semana} style={{ position: 'absolute', left: x1 + 1, top: BANDA_HDR + i * BANDA_ROW + 4, width: w, height: hMax }}
                    title={`${f.persona.alias} · semana del ${formatFechaCorta(c.semana)}: ${Math.round(c.horas)} h de ${Math.round(c.capacidad)} (${c.capacidad > 0 ? Math.round(pct * 100) + ' %' : 'sin capacidad: vacaciones'})\n${c.porCuenta.map(([pid, h]) => `${proyectoPorId.get(pid)?.nombre ?? (pid === SIN_CUENTA ? 'Sin cuenta' : pid)}: ${Math.round(h)} h`).join('\n')}`}>
                    {c.porCuenta.map(([pid, h], k) => {
                      const alto = Math.min(hMax * 1.6, hMax * (h / c.capacidad))
                      const y = hMax - acc - alto
                      acc += alto
                      const nombre = proyectoPorId.get(pid)?.nombre ?? (pid === SIN_CUENTA ? 'Sin cuenta' : pid)
                      const esSeleccionada = pid === clienteSeleccionado
                      const fondo = esSeleccionada ? 'var(--celeste)' : k === 0 ? 'var(--t1)' : k === 1 ? 'var(--t2)' : k === 2 ? 'var(--t3)' : 'var(--line)'
                      const oscuro = esSeleccionada || k < 2
                      // Ellipsis por CSS, no por cantidad de letras: con el texto centrado, cortar
                      // por longitud recortaba los dos lados y dejaba una tira ilegible del medio.
                      return (
                        <div key={pid} style={{ position: 'absolute', left: 0, top: y, width: '100%', height: Math.max(0, alto), background: fondo, borderRadius: 2, border: '1px solid var(--white)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                          {alto >= 9 && w >= 26 && <span className="num" style={{ fontSize: 7.5, fontWeight: 700, color: oscuro ? '#fff' : 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 3px', display: 'block', width: '100%' }}>{nombre}</span>}
                        </div>
                      )
                    })}
                    {pct > 1.10 && (
                      <span className="num" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: -13, fontSize: 8.5, fontWeight: 800, color: 'var(--error-tx)', whiteSpace: 'nowrap' }}>{Math.round(pct * 100)}%</span>
                    )}
                  </div>
                )
              }))}
            </div>
          </div>
        )}

        {/* BODY */}
        <div ref={rowsRef} style={{ position: 'relative', height: bodyH }}>

          {/* zebra */}
          {filas.map((f, i) => (
            <div key={f.id} style={{ position: 'absolute', top: topDeFila.get(f.id) ?? 0, left: 0, width: bodyW, height: altoDeFila.get(f.id) ?? ROW_H, background: porCuenta && clienteSeleccionado === f.id ? 'var(--celeste-dim)' : i % 2 ? 'var(--paper)' : 'var(--white)', borderBottom: '1px solid var(--line-soft)' }} />
          ))}

          {/* blackout de configuración: contexto de por qué una barra de Configuración da roja */}
          {blackout && blackout.length === 2 && (() => {
            const x0 = dateToX(blackout[0]), x1 = dateToX(blackout[1]) + pxPerDay
            if (x1 <= NAME_W || x0 >= bodyW) return null
            return (
              <div title={`Blackout de configuración: ${formatFechaCorta(blackout[0])} → ${formatFechaCorta(blackout[1])}`} style={{
                position: 'absolute', top: 0, left: Math.max(x0, NAME_W), width: Math.min(x1, bodyW) - Math.max(x0, NAME_W), height: bodyH, zIndex: 1, pointerEvents: 'none',
                background: 'repeating-linear-gradient(135deg, var(--error-tint) 0 6px, transparent 6px 12px)',
              }} />
            )
          })()}

          {/* líneas de grilla vertical */}
          {gridLines.map((p, i) => {
            const x = dateToXd(p)
            const strong = p.getDate() === 1 || zoom === 'meses' || zoom === 'trimestres'
            return <div key={i} style={{ position: 'absolute', top: 0, left: x, height: bodyH, borderLeft: `1px solid ${strong ? 'var(--line)' : 'var(--line-soft)'}`, zIndex: 1, pointerEvents: 'none' }} />
          })}

          {/* Curva de ocupación (modo persona): el área de fondo de cada fila muestra la forma
              de la carga semana a semana contra su capacidad, no solo un tinte plano. */}
          {mostrarCarga && !porCuenta && personas.map(p => {
            const top = topDeFila.get(p.id) ?? 0
            const semanas = cargaSemanalTodas.semanas.filter(c => c.personaId === p.id && c.capacidad > 0)
            if (!semanas.length) return null
            const hMax = ROW_H - 6
            return semanas.map(c => {
              const x = dateToX(c.semana)
              if (x < NAME_W - 1 || x > bodyW) return null
              const w = Math.max(2, 7 * pxPerDay - 1)
              const pct = c.horas / c.capacidad
              const color = pct > 1 ? 'var(--error)' : pct >= UMBRAL_AMBAR ? 'var(--warn)' : 'var(--ok)'
              const alto = Math.min(hMax * 1.3, hMax * pct)
              return (
                <div key={`${p.id}-${c.semana}`}
                  title={`${p.alias} · semana del ${formatFechaCorta(c.semana)}: ${Math.round(c.horas)} h de ${Math.round(c.capacidad)} (${Math.round(pct * 100)} %)`}
                  style={{ position: 'absolute', left: x, top: top + (ROW_H - alto), width: w, height: alto, background: color, opacity: 0.16, zIndex: 2, pointerEvents: 'none' }} />
              )
            })
          })}

          {/* Línea de hoy (celeste) */}
          {hoyX !== null && (
            <div style={{ position: 'absolute', top: 0, left: hoyX, height: bodyH, borderLeft: '2px solid var(--celeste)', zIndex: 5, pointerEvents: 'none' }}>
              <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 9, fontWeight: 700, color: '#fff', background: 'var(--celeste)', padding: '1px 6px', borderRadius: 9999, whiteSpace: 'nowrap' }}>
                Hoy
              </span>
            </div>
          )}

          {/* Línea de Inicio Toyota (roja punteada) */}
          {transicionX !== null && (
            <div style={{ position: 'absolute', top: 0, left: transicionX, height: bodyH, borderLeft: '2px dashed var(--error)', zIndex: 4, pointerEvents: 'none' }}>
              <span style={{ position: 'absolute', top: 20, left: 4, fontSize: 9, fontWeight: 700, color: '#fff', background: 'var(--error)', padding: '1px 6px', borderRadius: 9999, whiteSpace: 'nowrap' }}>
                Inicio Toyota
              </span>
            </div>
          )}

          {/* Corte de novedades y margen (modo cuenta): una línea punteada por fila en la
              fecha del corte, y un corchete con los hábiles entre el fin de la última barra
              (el Cierre, o Pruebas si la cuenta no tiene) y esa fecha. */}
          {porCuenta && filasCuenta.map(f => {
            const mg = margenPorCuenta.get(f.id)
            if (!mg || !mg.corte || !mg.finBarra) return null
            const top = topDeFila.get(f.id) ?? 0
            const alto = altoDeFila.get(f.id) ?? ROW_H
            const xCorte = dateToX(mg.corte) + pxPerDay / 2
            const xFin = dateToX(mg.finBarra) + pxPerDay
            const cumple = mg.habiles !== null && mg.habiles >= minimoMargen
            const color = cumple ? 'var(--ok-tx)' : 'var(--error-tx)'
            const yBracket = top + alto - 13
            return (
              <div key={`margen-${f.id}`} style={{ position: 'absolute', top, left: 0, width: bodyW, height: alto, pointerEvents: 'none', zIndex: 3 }}>
                <div style={{ position: 'absolute', top: 0, left: xCorte, height: alto, borderLeft: '1.5px dashed var(--t1)' }} />
                {mg.habiles !== null && xCorte - xFin > 10 && (
                  <>
                    <div style={{ position: 'absolute', top: yBracket, left: xFin, width: Math.max(0, xCorte - xFin), height: 0, borderTop: `1.2px solid ${color}` }} />
                    <span className="num" style={{ position: 'absolute', top: yBracket - 12, left: (xFin + xCorte) / 2, transform: 'translateX(-50%)', fontSize: 9, fontWeight: 800, color, whiteSpace: 'nowrap', background: 'var(--white)', padding: '0 3px' }}>
                      {mg.habiles} h. al corte
                    </span>
                  </>
                )}
              </div>
            )
          })}

          {/* Dependencias de la cuenta seleccionada */}
          {depSegs.length > 0 && (
            <svg style={{ position: 'absolute', top: 0, left: 0, width: bodyW, height: bodyH, zIndex: 6, pointerEvents: 'none', overflow: 'visible' }}>
              <defs>
                <marker id="haArrow"    markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--t3)" /></marker>
                <marker id="haArrowRed" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="var(--error)" /></marker>
              </defs>
              {depSegs.map((s, i) => (
                <path key={i}
                  d={`M ${s.x1} ${s.y1} C ${s.x1 + 26} ${s.y1}, ${s.x2 - 26} ${s.y2}, ${s.x2} ${s.y2}`}
                  fill="none"
                  stroke={s.viola ? 'var(--error)' : 'var(--celeste)'}
                  strokeWidth={s.viola ? 2 : 1.4}
                  strokeDasharray={s.viola ? undefined : '5 4'}
                  markerEnd={`url(#${s.viola ? 'haArrowRed' : 'haArrow'})`}
                />
              ))}
            </svg>
          )}

          {/* Columna de nombres (sticky left) */}
          <div style={{ position: 'sticky', left: 0, top: 0, width: NAME_W, height: bodyH, zIndex: 20, pointerEvents: 'none' }}>
            {porCuenta ? filasCuenta.map((f, i) => {
              const p = proyectoPorId.get(f.id)
              const mes = p ? mesSalidaDe(p.id, config) : null
              const tier = p ? tierDe(p.id, config) : null
              const rojos = statsCuenta.get(f.id) ?? 0
              const compacta = densidad === 'compacta'
              const sel = clienteSeleccionado === f.id
              return (
                <div key={f.id}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => p && seleccionarCliente(sel ? null : p.id)}
                  style={{ position: 'absolute', top: topDeFila.get(f.id) ?? 0, left: 0, width: NAME_W, height: altoDeFila.get(f.id) ?? ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: compacta ? 0 : 2, padding: compacta ? '0 10px 0 9px' : '0 10px 0 11px', background: sel ? 'var(--celeste-dim)' : i % 2 ? 'var(--paper)' : 'var(--white)', borderRight: '2px solid var(--line)', borderBottom: '1px solid var(--line-soft)', borderLeft: `3px solid ${sel ? 'var(--celeste)' : 'transparent'}`, pointerEvents: 'auto', cursor: p ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: compacta ? 13 : 14.5, fontWeight: 700, color: p ? 'var(--t1)' : 'var(--t3)', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.titulo}</span>
                    {tier && (
                      <span style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 700, color: 'var(--t2)', background: 'var(--line-soft)', borderRadius: 9999, padding: '1px 6px' }}>{TIER_LABEL[tier]}</span>
                    )}
                    {mostrarConflictos && rojos > 0 && (
                      <span title={`${rojos} conflicto${rojos !== 1 ? 's' : ''} en esta cuenta`}
                        style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, color: '#fff', background: 'var(--error)', borderRadius: 9999, padding: '1px 6px' }}>
                        ⚠ {rojos}
                      </span>
                    )}
                  </div>
                  {!compacta && (
                    <span className="num" style={{ fontSize: 10, color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                      {mes ? `sale ${mesCorto(mes)}` : p ? 'sin mes de salida' : 'corridas y vacaciones'}
                    </span>
                  )}
                </div>
              )
            }) : personas.map((p, i) => {
              const st = statsPersona.get(p.id)
              const compacta = densidad === 'compacta'
              return (
                <div key={p.id} style={{ position: 'absolute', top: topDeFila.get(p.id) ?? 0, left: 0, width: NAME_W, height: altoDeFila.get(p.id) ?? ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: compacta ? 0 : 3, padding: compacta ? '0 10px 0 12px' : '0 10px 0 14px', background: i % 2 ? 'var(--paper)' : 'var(--white)', borderRight: '2px solid var(--line)', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: compacta ? 13 : 15, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.alias}</span>
                    {mostrarConflictos && st && st.semRojas > 0 && (
                      <span title={`${st.semRojas} mes${st.semRojas !== 1 ? 'es' : ''} por encima de su capacidad`}
                        style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, color: '#fff', background: 'var(--error)', borderRadius: 9999, padding: '1px 6px' }}>
                        ⚠ {st.semRojas}
                      </span>
                    )}
                  </div>
                  {p.rol && (
                    <span style={{ fontSize: compacta ? 8.5 : 9.5, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--celeste-dark)' }}>{ROL_LABEL[p.rol]}</span>
                  )}
                  {!compacta && (
                    <span style={{ fontSize: 10.5, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                      {st && st.fases > 0
                        ? `${st.fases} fase${st.fases !== 1 ? 's' : ''} · ${st.cuentas} cuenta${st.cuentas !== 1 ? 's' : ''}`
                        : 'sin carga'}
                    </span>
                  )}
                  {densidad === 'amplia' && (
                    <span style={{ fontSize: 10, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                      {p.capacidad_horas_semana} hs/sem
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Barras de fase */}
          {filas.flatMap(f => (itemsPorFila.get(f.id) ?? []).map(item => {
            // descartar si está completamente fuera del horizonte, o si la fila está oculta
            if (
              differenceInDays(parseISO(item.fin),    horizonStart) < 0 ||
              differenceInDays(parseISO(item.inicio),  horizonEnd)   > 0
            ) return null
            if (!filaDe.has(item.filaId)) return null

            const seleccionada = !!clienteSeleccionado && item.filaId === clienteSeleccionado
            const atenuada    = !!clienteSeleccionado && item.filaId !== clienteSeleccionado && (porCuenta || (item.asig ? item.asig.proyecto_id !== clienteSeleccionado : false))
            const fontSize   = BAR_H > 34 ? 11.5 : 10

            // ── Cierre: hito de un día, siempre rombo, no se arrastra ──────────────
            if (item.kind === 'cierre') {
              const a = item.asig!
              const x = dateToX(a.inicio) + pxPerDay / 2
              const y = topBarra(item.filaId, carrilDe.get(item.id) ?? 0) + BAR_H / 2
              const alias = aliasPorId.get(a.persona_id) ?? a.persona_id
              const esRojo = barRojo.has(a.id)
              const fill = esRojo ? 'var(--error)' : TIPO_COLOR.Cierre
              return (
                <div key={item.id}
                  onMouseDown={porCuenta ? e => e.stopPropagation() : undefined}
                  onClick={porCuenta ? () => seleccionarCliente(seleccionada ? null : item.filaId) : undefined}
                  title={`${nombreTarea(a)} · ${alias}\n${a.inicio} → ${a.fin}`}
                  style={{
                    position: 'absolute', left: x - HITO_R, top: y - HITO_R, width: HITO_R * 2, height: HITO_R * 2,
                    background: fill, transform: 'rotate(45deg)', borderRadius: 3,
                    boxShadow: seleccionada ? '0 0 0 2px var(--celeste)' : esRojo && mostrarConflictos ? '0 0 0 2px var(--error)' : 'none',
                    opacity: atenuada ? 0.35 : 1, cursor: porCuenta ? 'pointer' : 'default', zIndex: 11,
                  }} />
              )
            }

            // geometría real: para 'barra' usa geom() (soporta preview de drag); 'fase' es estática.
            const g = item.kind === 'barra' ? geom(item.asig!) : {
              left: dateToX(item.inicio),
              width: Math.max(MIN_BAR_W, dateToX(item.fin) + pxPerDay - dateToX(item.inicio)),
              top: topBarra(item.filaId, carrilDe.get(item.id) ?? 0),
            }
            const esRojoItem = item.asigIds.some(id => barRojo.has(id))
            const fill = esRojoItem ? 'var(--error)' : TIPO_COLOR[item.tipo]
            const ring = item.kind === 'barra' && !item.esBloqueo && mostrarConflictos ? ringDe(item.asig!) : null
            const boxShadow = ring === 'rojo' ? '0 0 0 2px var(--error)'
              : ring === 'ambar' ? '0 0 0 2px var(--warn)'
              : seleccionada && item.kind === 'fase' ? '0 0 0 2px var(--celeste)'
              : 'none'
            const angosta = esBarraAngosta(g.width)
            const padX = padDeBarra(g.width)
            const arrastrando = item.kind === 'barra' && drag?.id === item.id
            const enPrevisualizacion = item.kind === 'barra' && previsualizacion?.asignaciones.some(x => x.id === item.id)

            let texto = ''
            let monograma: string | null = null
            if (item.kind === 'fase') {
              const iniciales = item.personaIds.map(pid => inicialesDe(aliasPorId.get(pid) ?? pid))
              texto = textoDeBarra([`${TIPO_LABEL[item.tipo]} · ${iniciales.join(' ')}`, iniciales.join(' ')], g.width, fontSize, false)
            } else if (item.esBloqueo) {
              texto = textoDeBarra([item.asig!._nombre ?? item.tipo], g.width, fontSize, false)
            } else {
              const alias = aliasPorId.get(item.personaIds[0]) ?? item.personaIds[0]
              monograma = inicialesDe(alias)
              const tarea = nombreTarea(item.asig!)
              const proyecto = item.asig!.proyecto_id ? proyectoPorId.get(item.asig!.proyecto_id) : null
              const variantes = porCuenta
                ? [tarea]
                : [proyecto ? `${proyecto.nombre} · ${tarea}` : tarea, tarea]
              texto = textoDeBarra([...variantes, ''], g.width, fontSize, g.width >= 22)
            }

            const title = item.kind === 'fase'
              ? `${TIPO_LABEL[item.tipo]} de ${proyectoPorId.get(item.filaId)?.nombre ?? item.filaId} · ${item.personaIds.map(pid => aliasPorId.get(pid) ?? pid).join(', ')}\n${item.inicio} → ${item.fin} · clic para ver el detalle`
              : `${item.esBloqueo ? (item.asig!._nombre ?? item.tipo) : nombreTarea(item.asig!)} · ${aliasPorId.get(item.asig!.persona_id) ?? item.asig!.persona_id}\n${item.asig!.inicio} → ${item.asig!.fin} · ${item.asig!.duracion_dias} días hábiles${item.esBloqueo ? '' : (modoMovimiento === 'estricto'
                ? '\nModo estricto: arrastrar mueve esta fase y las siguientes de la cuenta (no las anteriores) · Shift = solo esta tarea · borde derecho = estirar'
                : '\nModo flexible: arrastrar mueve solo esta tarea · Shift = esta fase y las siguientes · borde derecho = estirar')}`

            return (
              <div key={item.id}
                onMouseDown={item.kind === 'barra' && !item.esBloqueo ? e => onBarDown(e, item.asig!, 'phase') : porCuenta ? e => e.stopPropagation() : undefined}
                onClick={item.kind === 'fase' ? () => seleccionarCliente(seleccionada ? null : item.filaId) : undefined}
                title={title}
                style={{
                  position: 'absolute', left: g.left, top: g.top, width: g.width, height: BAR_H,
                  background: fill, borderRadius: BAR_H > 34 ? 8 : 6, display: 'flex',
                  alignItems: 'center', justifyContent: angosta && !monograma ? 'center' : 'flex-start', gap: 5,
                  paddingLeft: padX, paddingRight: padX,
                  overflow: 'hidden', fontSize, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
                  boxShadow, cursor: item.kind === 'barra' && !item.esBloqueo ? 'grab' : item.kind === 'fase' ? 'pointer' : 'default',
                  opacity: item.esBloqueo ? (atenuada ? 0.25 : 0.55)
                    : enPrevisualizacion ? 0.22
                    : (atenuada ? 0.38 : 1),
                  zIndex: arrastrando ? 15 : item.kind === 'fase' ? 9 : 10,
                  transition: arrastrando ? 'none' : 'left var(--t-fast) var(--ease), top var(--t-fast) var(--ease), width var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease), opacity var(--t-fast) var(--ease)',
                  userSelect: 'none',
                }}>
                {monograma && (
                  <span style={{
                    flexShrink: 0, width: HITO_R * 2, height: HITO_R * 2, borderRadius: '50%', background: 'rgba(255,255,255,0.92)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, fontWeight: 800, color: TIPO_COLOR[item.tipo],
                  }}>{monograma}</span>
                )}
                {texto && <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700 }}>{texto}</span>}
                {item.kind === 'barra' && !item.esBloqueo && (
                  <div onMouseDown={e => onBarDown(e, item.asig!, 'resize')}
                    style={{ position: 'absolute', right: 0, top: 0, width: BAR_H > 34 ? 10 : 8, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.18)', borderRadius: '0 6px 6px 0' }} />
                )}
              </div>
            )
          }))}

          {/* Fases fantasma: dónde quedaría la cuenta si saliera en el mes que el mouse está tocando en el panel. */}
          {previsualizacion?.asignaciones.map(a => {
            const filaId = filaIdDe(a)
            if (!filaDe.has(filaId)) return null
            const left = dateToX(a.inicio)
            const width = Math.max(MIN_BAR_W, dateToX(a.fin) + pxPerDay - left)
            const top = topBarra(filaId, carrilDe.get(a.id) ?? 0)
            return (
              <div key={`prev-${a.id}`} title={`${a.inicio} → ${a.fin}`} style={{
                position: 'absolute', left, top, width, height: BAR_H, zIndex: 12, pointerEvents: 'none',
                borderRadius: BAR_H > 34 ? 8 : 6, border: `2px dashed ${TIPO_COLOR[a.tipo]}`,
                background: 'var(--white)', opacity: 0.92, boxSizing: 'border-box',
              }} />
            )
          })}
        </div>
      </div>
    </div>
  )
}
