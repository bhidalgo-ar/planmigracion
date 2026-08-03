import { useEffect, useMemo, useRef, useState } from 'react'
import { format, addDays, parseISO, differenceInDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { cascadaIds, useSimuladorStore } from '../store'
import { DENSIDAD_PX, useUIStore, type ZoomLevel } from '../uiStore'
import type { Asignacion, TipoFase } from '../types'
import { TIPO_COLOR } from '../theme/fases'
import { getMondayOfWeek, parseDate, toISO, diasHabiles, formatFechaCorta } from '../utils/dates'

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

// ── Componente ──────────────────────────────────────────────────────────────

export function Timeline() {
  const {
    personas, proyectos, asignaciones, config, violaciones,
    clienteSeleccionado, updateAsignacion, shiftCascadaDias, seleccionarCliente,
  } = useSimuladorStore()
  const { mostrarCarga, mostrarDep, zoom, irHoyToken, modoMovimiento, densidad } = useUIStore()

  const scrollRef = useRef<HTMLDivElement>(null)
  const rowsRef   = useRef<HTMLDivElement>(null)

  const { row: ROW_H, bar: BAR_H } = DENSIDAD_PX[densidad]

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
  const filaDe        = useMemo(() => new Map(personas.map((p, i) => [p.id, i])), [personas])

  // barras R3 en rojo
  const barRojo = useMemo(() => {
    const s = new Set<string>()
    for (const v of violaciones)
      if (v.severidad === 'rojo' && v.tipo === 'R3') s.add(v.asignacion_id)
    return s
  }, [violaciones])

  // carga R2: (personaId|lunesISO) → severidad
  const cargaCelda = useMemo(() => {
    const m = new Map<string, 'rojo' | 'ambar'>()
    for (const v of violaciones) {
      if (v.tipo !== 'R2' || !v.persona_id || !v.semana) continue
      const key = `${v.persona_id}|${v.semana}`
      if (v.severidad === 'rojo' || m.get(key) !== 'rojo') m.set(key, v.severidad)
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
      if (drag!.mode !== 'resize' && rowsRef.current) {
        const rect = rowsRef.current.getBoundingClientRect()
        const idx = Math.max(0, Math.min(personas.length - 1, Math.floor((e.clientY - rect.top) / ROW_H)))
        persona = personas[idx].id
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
  }, [drag?.id, personas, pxPerDay, snapDays, ROW_H])

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
      const dur = diasHabiles(d.origInicio, newFin)
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
    let row = filaDe.get(a.persona_id) ?? 0

    if (drag) {
      if (drag.mode === 'phase' && drag.id === a.id) {
        const dayMin = -differenceInDays(parseISO(a.inicio), horizonStart)
        const ddc = Math.max(drag.dd, dayMin)
        inicioISO = toISO(addDays(parseISO(a.inicio), ddc))
        finISO    = toISO(addDays(parseISO(a.fin), ddc))
        row = filaDe.get(drag.persona) ?? row
      } else if (drag.mode === 'resize' && drag.id === a.id) {
        finISO = toISO(addDays(parseISO(drag.origFin), drag.dd))
        if (finISO < drag.origInicio) finISO = drag.origInicio
      } else if (drag.mode === 'cascade' && drag.cascada?.has(a.id)) {
        const ddc = Math.max(drag.dd, -(drag.minDay ?? 0))
        inicioISO = toISO(addDays(parseISO(a.inicio), ddc))
        finISO    = toISO(addDays(parseISO(a.fin), ddc))
        if (drag.id === a.id) row = filaDe.get(drag.persona) ?? row
      }
    }

    const left  = dateToX(inicioISO)
    const right = dateToX(finISO) + pxPerDay   // fin es inclusivo
    const width = Math.max(MIN_BAR_W, right - left)
    const top   = row * ROW_H + (ROW_H - BAR_H) / 2
    return { left, width, top }
  }

  // ── dependencias ────────────────────────────────────────────────────────────

  const depSegs = useMemo(() => {
    if (!mostrarDep || !clienteSeleccionado) return []
    const segs: { x1: number; y1: number; x2: number; y2: number; viola: boolean }[] = []
    const fases = asignaciones.filter(a => a.proyecto_id === clienteSeleccionado)
    const byId  = new Map(asignaciones.map(a => [a.id, a]))
    for (const a of fases) {
      const rowA = filaDe.get(a.persona_id) ?? 0
      for (const predId of a.predecesoras) {
        const pred = byId.get(predId)
        if (!pred) continue
        const rowP = filaDe.get(pred.persona_id) ?? 0
        segs.push({
          x1: dateToX(pred.fin) + pxPerDay,
          y1: rowP * ROW_H + ROW_H / 2,
          x2: dateToX(a.inicio),
          y2: rowA * ROW_H + ROW_H / 2,
          viola: a.inicio < pred.fin,
        })
      }
    }
    return segs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarDep, clienteSeleccionado, asignaciones, personas, pxPerDay, ROW_H])

  const bodyH = personas.length * ROW_H

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
      const semRojas = violaciones.filter(
        v => v.tipo === 'R2' && v.severidad === 'rojo' && v.persona_id === p.id,
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
            Persona
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

        {/* BODY */}
        <div ref={rowsRef} style={{ position: 'relative', height: bodyH }}>

          {/* zebra */}
          {personas.map((p, i) => (
            <div key={p.id} style={{ position: 'absolute', top: i * ROW_H, left: 0, width: bodyW, height: ROW_H, background: i % 2 ? 'var(--paper)' : 'var(--white)', borderBottom: '1px solid var(--line-soft)' }} />
          ))}

          {/* líneas de grilla vertical */}
          {gridLines.map((p, i) => {
            const x = dateToXd(p)
            const strong = p.getDate() === 1 || zoom === 'meses' || zoom === 'trimestres'
            return <div key={i} style={{ position: 'absolute', top: 0, left: x, height: bodyH, borderLeft: `1px solid ${strong ? 'var(--line)' : 'var(--line-soft)'}`, zIndex: 1, pointerEvents: 'none' }} />
          })}

          {/* tintes de carga semanal (R2) */}
          {mostrarCarga && [...cargaCelda.entries()].map(([key, sev]) => {
            const [pid, lunesISO] = key.split('|')
            const row = filaDe.get(pid)
            if (row == null) return null
            const x1 = dateToX(lunesISO)
            const x2 = dateToX(toISO(addDays(parseISO(lunesISO), 4))) + pxPerDay
            return (
              <div key={key} style={{ position: 'absolute', top: row * ROW_H, left: x1, width: x2 - x1, height: ROW_H, background: sev === 'rojo' ? 'var(--error-tint)' : 'var(--warn-tint)', zIndex: 2, pointerEvents: 'none' }} />
            )
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
            {personas.map((p, i) => {
              const st = statsPersona.get(p.id)
              const compacta = densidad === 'compacta'
              return (
                <div key={p.id} style={{ position: 'absolute', top: i * ROW_H, left: 0, width: NAME_W, height: ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: compacta ? 0 : 3, padding: compacta ? '0 10px 0 12px' : '0 10px 0 14px', background: i % 2 ? 'var(--paper)' : 'var(--white)', borderRight: '2px solid var(--line)', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: compacta ? 13 : 15, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.alias}</span>
                    {st && st.semRojas > 0 && (
                      <span title={`${st.semRojas} semana${st.semRojas !== 1 ? 's' : ''} sobreasignada${st.semRojas !== 1 ? 's' : ''}`}
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
          {asignaciones.map(a => {
            // descartar si está completamente fuera del horizonte
            if (
              differenceInDays(parseISO(a.fin),    horizonStart) < 0 ||
              differenceInDays(parseISO(a.inicio),  horizonEnd)   > 0
            ) return null

            const { left, width, top } = geom(a)
            const proyecto    = a.proyecto_id ? proyectoPorId.get(a.proyecto_id) : null
            const esRojo      = barRojo.has(a.id)
            const fill        = esRojo ? 'var(--error)' : TIPO_COLOR[a.tipo as TipoFase]
            const ring        = a.es_bloqueo ? null : ringDe(a)
            const seleccionada = !!clienteSeleccionado && a.proyecto_id === clienteSeleccionado
            const atenuada    = !!clienteSeleccionado && a.proyecto_id !== clienteSeleccionado
            const boxShadow   = ring === 'rojo'
              ? '0 0 0 2px var(--error)'
              : ring === 'ambar' ? '0 0 0 2px var(--warn)'
              : seleccionada   ? '0 0 0 2px var(--celeste)'
              : 'none'
            const label      = a.es_bloqueo ? (a._nombre ?? a.tipo) : `${proyecto?.nombre ?? ''} · ${a.tipo}`
            const arrastrando = drag?.id === a.id
            const tipoCorto  = a.tipo === 'Relevamiento' ? 'Relev.' : a.tipo === 'Configuracion' ? 'Config.' : a.tipo

            return (
              <div key={a.id}
                onMouseDown={e => onBarDown(e, a, 'phase')}
                title={`${label}\n${a.inicio} → ${a.fin} · ${a.duracion_dias} días hábiles${a.es_bloqueo ? '' : (modoMovimiento === 'estricto'
                  ? '\nModo estricto: arrastrar mueve esta fase y las siguientes de la cuenta (no las anteriores) · Shift = solo esta tarea · borde derecho = estirar'
                  : '\nModo flexible: arrastrar mueve solo esta tarea · Shift = esta fase y las siguientes · borde derecho = estirar')}`}
                style={{
                  position: 'absolute', left, top, width, height: BAR_H,
                  background: fill, borderRadius: BAR_H > 34 ? 8 : 6, display: 'flex',
                  flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 1,
                  paddingLeft: 9, paddingRight: 10,
                  overflow: 'hidden', fontSize: BAR_H > 34 ? 11.5 : 10, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap',
                  boxShadow, cursor: a.es_bloqueo ? 'default' : 'grab',
                  opacity: a.es_bloqueo ? (atenuada ? 0.25 : 0.55) : (atenuada ? 0.38 : 1),
                  zIndex: arrastrando ? 15 : 10,
                  transition: arrastrando ? 'none' : 'left var(--t-fast) var(--ease), top var(--t-fast) var(--ease), width var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease), opacity var(--t-fast) var(--ease)',
                  userSelect: 'none',
                }}>
                <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700 }}>
                  {proyecto ? `${proyecto.nombre} · ${tipoCorto}` : label}
                </span>
                {BAR_H > 34 && width > 130 && (
                  <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 9.5, fontWeight: 500, opacity: 0.85 }}>
                    {formatFechaCorta(a.inicio)} → {formatFechaCorta(a.fin)} · {a.duracion_dias}d
                  </span>
                )}
                {!a.es_bloqueo && (
                  <div onMouseDown={e => onBarDown(e, a, 'resize')}
                    style={{ position: 'absolute', right: 0, top: 0, width: BAR_H > 34 ? 10 : 8, height: '100%', cursor: 'ew-resize', background: 'rgba(255,255,255,0.18)', borderRadius: '0 6px 6px 0' }} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
