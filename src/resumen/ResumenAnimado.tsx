import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { addDays, parseISO } from 'date-fns'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { TIPO_LABEL } from '../theme/fases'
import type { TipoFase } from '../types'
import logoUrl from '../assets/logo-ha.png'
import { toISO } from '../utils/dates'
import {
  derivarResumen, diaYMesCorto,
  type Cuello as CuelloData, type ResumenData, type Salida,
} from './derivarResumen'
import { armarGuion, CUES, hashDeSegundo, segundoDelHash, subtituloEn } from './guion'
import { clamp, draw, enter, lerp, pop, Easing } from './motion'

/**
 * El resumen ejecutivo como video: 45 segundos, 1920×1080, seis escenas.
 *
 * Cómo está armado, en una línea: hay UN reloj (`T`, segundos desde el arranque) y UN
 * árbol de elementos siempre montado. Cada elemento se dibuja como función pura de
 * `(T, data)`. No hay `useEffect` que anime nada, no hay transiciones de CSS, no hay
 * componentes que se monten y desmonten por escena. Por eso se puede arrastrar el
 * scrubber a cualquier segundo y ver exactamente el mismo frame siempre.
 *
 * Los datos salen de `derivarResumen(...)` sobre el plan cargado en el store. Cambiar
 * una fase en el timeline cambia el video en el mismo instante T.
 */

// ── el lienzo ────────────────────────────────────────────────────────────────────

const W = 1920, H = 1080

/**
 * La paleta va escrita a mano y no como `var(--celeste)` a propósito: el video es una
 * pieza de 1920×1080 con fondo blanco que se exporta y se manda por mail. Los tokens de
 * la app cambian con el modo oscuro, y un video que cambia de color según cómo tenía la
 * pantalla quien lo grabó no sirve. Son los mismos valores del modo claro del H&A DS.
 */
const CEL = '#00ACD4', CELD = '#007896', CELL = '#B3E6F2'
const GRIS = '#8C837B', INK = '#000000', BORDER = '#E7E6E6'
const ERR = '#E85518', WARN = '#F59E0B'
const F = "'Source Sans 3','Source Sans Pro',Arial,Helvetica,sans-serif"

const COLOR_FASE: Record<string, { bg: string; fg: string }> = {
  Relevamiento: { bg: CELL, fg: CELD },
  Configuracion: { bg: CEL, fg: '#fff' },
  Pruebas: { bg: CELD, fg: '#fff' },
  Vacaciones: { bg: GRIS, fg: '#fff' },
}

// Medidas fijas del diseño. Lo que depende de cuántos datos hay se calcula en `layoutDe`.
const DOT_MAX = 56, DOT_GAP = 14, DOT_Y = 532, ANCHO_UTIL = 1736
const BASE_Y = 800, CHIP_GAP = 10
const GX0 = 300, GW = 1500, FILA_H = 92, BARRA_H = 60, MAX_FILAS = 5
const EJE_Y = 640

// ── layout adaptativo ────────────────────────────────────────────────────────────

interface Layout {
  /** Puntos de la escena Hoy: diámetro, y posición de cada uno de los `total`. */
  dot: number
  punto: (i: number) => { x: number; y: number }
  /** Columnas de la ola. */
  columnaX: (q: number) => number
  chipW: number
  chipH: number
  chipGap: number
  /** Eje de meses de la escena Fin. */
  mesX: (i: number) => number
  ejeX0: number
  ejeAncho: number
  /** Escalonados, achicados si hay muchas cuentas para que todo entre en su escena. */
  pasoPop: number
  pasoPinta: number
  pasoViaje: number
  pasoCaida: number
}

function layoutDe(data: ResumenData): Layout {
  const total = Math.max(1, data.total)
  const filas = total > 30 ? 2 : 1
  const porFila = Math.ceil(total / filas)
  const dot = Math.min(DOT_MAX, (ANCHO_UTIL - (porFila - 1) * DOT_GAP) / porFila)
  const anchoFila = (n: number) => n * dot + (n - 1) * DOT_GAP

  const punto = (i: number) => {
    const fila = Math.floor(i / porFila)
    const enFila = i % porFila
    const nEnEstaFila = Math.min(porFila, total - fila * porFila)
    const x0 = (W - anchoFila(nEnEstaFila)) / 2
    const yBase = filas === 1 ? DOT_Y : DOT_Y - (dot + DOT_GAP) / 2
    return { x: x0 + enFila * (dot + DOT_GAP), y: yBase + fila * (dot + DOT_GAP) }
  }

  const nQ = Math.max(1, data.trimestres.length)
  const paso = Math.min(373, 1440 / nQ)
  const columnaX = (q: number) => W / 2 + (q - (nQ - 1) / 2) * paso
  const maxChips = data.trimestres.reduce((m, t) => Math.max(m, t.salidas.length), 0)
  const apretado = maxChips > 8

  const nM = Math.max(1, data.meses.length)
  const pasoMes = nM > 1 ? Math.min(200, 1400 / (nM - 1)) : 0
  const ejeAncho = (nM - 1) * pasoMes
  const ejeX0 = (W - ejeAncho) / 2
  const nSal = Math.max(1, data.porMigrar)

  return {
    dot,
    punto,
    columnaX,
    chipW: Math.min(280, paso - 40),
    chipH: apretado ? 44 : 54,
    chipGap: apretado ? 8 : CHIP_GAP,
    mesX: (i: number) => ejeX0 + i * pasoMes,
    ejeX0,
    ejeAncho,
    pasoPop: Math.min(0.06, 1.5 / total),
    pasoPinta: Math.min(0.1, 3 / Math.max(1, data.yaEnAxton)),
    pasoViaje: Math.min(0.13, 3 / nSal),
    pasoCaida: Math.min(0.17, 3 / nSal),
  }
}

/** Cuántas salidas anteriores comparten el trimestre de `j` (su ranura en la columna). */
function ranuraEnColumna(salidas: Salida[], j: number): number {
  let n = 0
  for (let k = 0; k < j; k++) if (salidas[k].trimestre === salidas[j].trimestre) n++
  return n
}

/** Cuántas salidas anteriores comparten el mes de `j` (su altura en la pila del eje). */
function ranuraEnMes(salidas: Salida[], j: number): number {
  let n = 0
  for (let k = 0; k < j; k++) if (salidas[k].mes === salidas[j].mes) n++
  return n
}

// ── escenas ──────────────────────────────────────────────────────────────────────

interface Props { T: number; data: ResumenData; g: ReturnType<typeof armarGuion>; L: Layout }

function Header({ T, g }: { T: number; g: Props['g'] }) {
  // El isotipo es el hilo del video: gigante en la apertura, chiquito arriba a la
  // izquierda durante todo el cuerpo, y de vuelta al centro en el cierre (que es el
  // mismo frame que la apertura, para que el loop cierre).
  const aCabecera = draw(T, CUES.Hoy - 0.7, 0.9)
  const alCentro = draw(T, CUES.Cierre - 0.6, 0.9)
  const p = aCabecera * (1 - alCentro)
  const size = lerp(168, 56, p), x = lerp(W / 2 - 84, 72, p), y = lerp(300, 44, p)
  const op = Math.min(draw(T, CUES.Hoy, 0.5), 1 - draw(T, CUES.Cierre - 0.6, 0.4))
  return (
    <div>
      <img src={logoUrl} alt="" style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', left: 144, top: 48, opacity: op, lineHeight: 1.2 }}>
        <div style={{ font: `700 18px ${F}`, color: INK, letterSpacing: '-0.01em' }}>
          Hidalgo <span style={{ color: GRIS, fontWeight: 400, fontStyle: 'italic' }}>&amp;</span> Asociados
        </div>
        <div style={{ font: `700 13px ${F}`, color: CELD, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{g.header.etiqueta}</div>
      </div>
      <div style={{ position: 'absolute', right: 72, top: 56, opacity: op, font: `400 18px ${F}`, color: GRIS }}>{g.header.plan}</div>
    </div>
  )
}

function Apertura({ T, g }: { T: number; g: Props['g'] }) {
  const out = 1 - draw(T, CUES.Hoy - 0.45, 0.45)
  const t1 = enter(T, 0.5), t2 = enter(T, 1.1)
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: out, textAlign: 'center' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, ...t1, font: `700 64px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>{g.apertura.titulo}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 612, ...t2, font: `400 30px ${F}`, color: GRIS }}>{g.apertura.sub}</div>
    </div>
  )
}

/** Cuántos puntos legacy ya se pintaron de celeste al segundo T (el contador del título). */
function pintados(T: number, data: ResumenData, L: Layout): number {
  let n = 0
  for (let i = 0; i < data.yaEnAxton; i++) if (draw(T, CUES.Hoy + 1.4 + i * L.pasoPinta, 0.35) > 0.5) n++
  return n
}

function Hoy({ T, data, g, L }: Props) {
  const out = 1 - draw(T, CUES.Ola - 0.6, 0.5)
  const h = enter(T, CUES.Hoy)
  const leg = enter(T, CUES.Hoy + 2.9)
  const n = pintados(T, data, L)
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, textAlign: 'center', opacity: h.opacity * out, transform: h.transform }}>
        <div style={{ font: `600 22px ${F}`, color: GRIS, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{g.hoy.etiqueta}</div>
        <div style={{ font: `700 76px ${F}`, color: INK, letterSpacing: '-0.02em', marginTop: 6 }}>
          <span style={{ color: CEL }}>{n}</span> {g.hoy.tituloResto}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center', gap: 56, opacity: leg.opacity * out, transform: leg.transform, font: `400 28px ${F}`, color: INK }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 22, height: 22, borderRadius: 9999, background: CEL }} />{g.hoy.leyendaAxton} · <b>{data.yaEnAxton}</b>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 22, height: 22, borderRadius: 9999, border: `2px solid ${GRIS}` }} />{g.hoy.leyendaMeta4} · <b>{data.porMigrar}</b>
        </div>
      </div>
    </div>
  )
}

/**
 * Los puntos de las cuentas: los `yaEnAxton` primeros se pintan de celeste y después
 * se apagan; los `porMigrar` restantes viajan de la fila a su columna de trimestre y
 * en el camino se convierten en las chips de la ola. Es el mismo objeto todo el tiempo:
 * ahí está la idea de que las cuentas pendientes de hoy son las salidas de la ola.
 */
function Cuentas({ T, data, L }: Props) {
  const nodos: ReactElement[] = []

  for (let i = 0; i < data.yaEnAxton; i++) {
    const p = pop(T, CUES.Hoy + 0.3 + i * L.pasoPop)
    const fill = draw(T, CUES.Hoy + 1.4 + i * L.pasoPinta, 0.35)
    const out = 1 - draw(T, CUES.Ola - 0.4, 0.6)
    const { x, y } = L.punto(i)
    nodos.push(<div key={`l${i}`} style={{
      position: 'absolute', left: x, top: y, width: L.dot, height: L.dot, borderRadius: 9999,
      boxSizing: 'border-box', border: `2px solid ${fill > 0.5 ? CEL : GRIS}`,
      background: fill > 0.5 ? CEL : '#fff',
      opacity: p.opacity * out, transform: `${p.transform} scale(${lerp(1, 0.4, 1 - out)})`,
    }} />)
  }

  const fundido = 1 - draw(T, CUES.Cuello - 0.6, 0.7)
  data.salidas.forEach((s, j) => {
    const i = data.yaEnAxton + j
    const p0 = pop(T, CUES.Hoy + 0.3 + i * L.pasoPop)
    const viaje = draw(T, CUES.Ola + 0.3 + j * L.pasoViaje, 1.0)
    const qi = data.trimestres.findIndex(t => t.label === s.trimestre)
    const k = ranuraEnColumna(data.salidas, j)
    const desde = L.punto(i)
    const x1 = L.columnaX(qi) - L.chipW / 2
    const y1 = BASE_Y - (k + 1) * L.chipH - k * L.chipGap
    const textoOp = clamp((viaje - 0.7) / 0.3, 0, 1)
    nodos.push(
      <div key={`p${j}`} style={{
        position: 'absolute',
        left: lerp(desde.x, x1, viaje), top: lerp(desde.y, y1, viaje),
        width: lerp(L.dot, L.chipW, viaje), height: lerp(L.dot, L.chipH, viaje),
        borderRadius: 9999, boxSizing: 'border-box',
        border: `2px solid ${viaje > 0.5 ? CEL : GRIS}`, background: viaje > 0.5 ? CEL : '#fff',
        opacity: p0.opacity * fundido, transform: p0.transform,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        <span style={{ opacity: textoOp, font: `700 24px ${F}`, color: '#fff' }}>{s.nombre}</span>
        <span style={{ opacity: textoOp, font: `400 22px ${F}`, color: 'rgba(255,255,255,0.85)' }}>· {s.mesCorto}</span>
      </div>,
    )
  })

  return <>{nodos}</>
}

function Ola({ T, data, g, L }: Props) {
  const out = 1 - draw(T, CUES.Cuello - 0.6, 0.7)
  const h = enter(T, CUES.Ola + 0.3)
  const linea = draw(T, CUES.Ola + 0.2, 0.9)
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', ...h, font: `700 56px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>{g.ola.titulo}</div>
      <div style={{ position: 'absolute', left: 240, top: BASE_Y + 12, height: 2, width: 1440 * linea, background: BORDER }} />
      {data.trimestres.map((t, qi) => {
        const primero = data.salidas.findIndex(s => s.trimestre === t.label)
        const lab = enter(T, CUES.Ola + 0.3 + primero * L.pasoViaje + 0.9)
        return (
          <div key={t.label} style={{ position: 'absolute', left: L.columnaX(qi) - 160, width: 320, top: BASE_Y + 36, textAlign: 'center', ...lab }}>
            <div style={{ font: `700 30px ${F}`, color: INK }}>{t.label}</div>
            <div style={{ font: `400 24px ${F}`, color: GRIS }}>{t.sub}</div>
          </div>
        )
      })}
    </div>
  )
}

/** Los lunes de la ventana del gantt. */
function lunesDe(ventana: { desde: string; hasta: string }): string[] {
  const out: string[] = []
  let d = parseISO(ventana.desde)
  const fin = parseISO(ventana.hasta)
  while (d <= fin) { out.push(toISO(d)); d = addDays(d, 7) }
  return out
}

function Cuello({ T, data, g, mostrarAlertas }: Props & { mostrarAlertas: boolean }) {
  const c: CuelloData | null = data.cuello
  const inn = draw(T, CUES.Cuello + 0.2, 0.8)
  const out = 1 - draw(T, CUES.Fin - 0.6, 0.6)
  const h = enter(T, CUES.Cuello + 0.3)
  if (!c) return null

  const dias = Math.round((parseISO(c.ventana.hasta).getTime() - parseISO(c.ventana.desde).getTime()) / 86400000) + 1
  const anchoDia = GW / dias
  const x = (iso: string) => GX0 + (Math.round((parseISO(iso).getTime() - parseISO(c.ventana.desde).getTime()) / 86400000)) * anchoDia
  const recorte = (iso: string, alFinal: boolean) => {
    const v = iso < c.ventana.desde ? c.ventana.desde : iso > c.ventana.hasta ? c.ventana.hasta : iso
    return x(v) + (alFinal ? anchoDia : 0)
  }

  // Con más de cinco cuentas el gantt no entra: se muestran las cinco con más días
  // ocupados en la ventana y el resto se cuenta en el título.
  const todas = c.filas
  const visibles = todas.length <= MAX_FILAS
    ? todas
    : [...todas].sort((a, b) => b.dias - a.dias).slice(0, MAX_FILAS)
      .sort((a, b) => todas.indexOf(a) - todas.indexOf(b))
  const ocultas = todas.length - visibles.length

  const semanas = lunesDe(c.ventana)
  const blackO = draw(T, CUES.Cuello + 0.9, 0.6)
  let nBarra = 0
  const alertas = mostrarAlertas ? data.alertas : []

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: inn * out, transform: `scale(${lerp(0.96, 1, inn)})` }}>
      <div style={{ position: 'absolute', left: 120, top: 150, ...h, font: `700 56px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>
        {g.cuello.titulo}{ocultas > 0 ? ` +${ocultas} cuentas` : ''}
      </div>

      {semanas.map((iso, i) => (
        <div key={iso} style={{ position: 'absolute', left: x(iso), top: 290, opacity: draw(T, CUES.Cuello + 0.5 + i * 0.05, 0.4) }}>
          <div style={{ font: `600 20px ${F}`, color: GRIS, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{diaYMesCorto(iso)}</div>
          <div style={{ position: 'absolute', left: 0, top: 34, width: 1, height: 380, background: BORDER }} />
        </div>
      ))}

      {c.blackout && (
        <div style={{
          position: 'absolute', left: recorte(c.blackout.desde, false), top: 324,
          width: recorte(c.blackout.hasta, true) - recorte(c.blackout.desde, false), height: 380,
          opacity: blackO,
          background: 'repeating-linear-gradient(135deg, rgba(140,131,123,0.10) 0 8px, transparent 8px 16px)',
          borderRight: `2px dashed ${GRIS}`,
        }}>
          <div style={{ position: 'absolute', left: 12, bottom: -34, font: `600 18px ${F}`, color: GRIS, whiteSpace: 'nowrap' }}>
            Blackout de configuración · {diaYMesCorto(c.blackout.desde)} – {diaYMesCorto(c.blackout.hasta)}
          </div>
        </div>
      )}

      {visibles.map((fila, ri) => (
        <div key={fila.cuenta} style={{ position: 'absolute', left: 0, top: 340 + ri * FILA_H, height: BARRA_H }}>
          <div style={{ position: 'absolute', left: 120, top: 12, width: 160, textAlign: 'right', font: `700 28px ${F}`, color: INK, opacity: draw(T, CUES.Cuello + 0.8 + ri * 0.2, 0.4) }}>{fila.cuenta}</div>
          {fila.barras.map(b => {
            const x0 = recorte(b.desde, false), x1 = recorte(b.hasta, true)
            const p = draw(T, CUES.Cuello + 1.0 + (nBarra++) * 0.28, 0.7)
            const col = COLOR_FASE[b.fase] ?? COLOR_FASE.Vacaciones
            return (
              <div key={b.fase} style={{
                position: 'absolute', left: x0, top: 0, width: Math.max(0, (x1 - x0) * p), height: BARRA_H,
                borderRadius: 8, background: col.bg, color: col.fg, font: `600 20px ${F}`,
                display: 'flex', alignItems: 'center', paddingLeft: 14, boxSizing: 'border-box',
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                <span style={{ opacity: x1 - x0 < 130 ? 0 : clamp((p - 0.6) / 0.4, 0, 1) }}>{TIPO_LABEL[b.fase as TipoFase] ?? b.fase}</span>
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ position: 'absolute', left: GX0, top: 748, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14 }}>
        {alertas.map((a, i) => {
          const est = pop(T, CUES.Cuello + 4.6 + i * 1.6)
          const roja = a.severidad === 'rojo'
          return (
            <div key={a.texto} style={{
              ...est, transformOrigin: 'left center', display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 26px', borderRadius: 9999, whiteSpace: 'nowrap',
              background: roja ? 'rgba(232,85,24,0.10)' : 'rgba(245,158,11,0.12)',
              border: `1.5px solid ${roja ? 'rgba(232,85,24,0.45)' : 'rgba(245,158,11,0.5)'}`,
              color: roja ? ERR : '#9A6200', font: `700 24px ${F}`,
            }}>
              <span style={{ width: 14, height: 14, borderRadius: 9999, background: roja ? ERR : WARN }} />{a.texto}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Fin({ T, data, g, L }: Props) {
  const inn = draw(T, CUES.Fin + 0.1, 0.7)
  const out = 1 - draw(T, CUES.Cierre - 0.6, 0.5)
  const h = enter(T, CUES.Fin + 0.2)
  const linea = draw(T, CUES.Fin + 0.4, 1.2)
  const caidas = data.salidas.map((_, i) => draw(T, CUES.Fin + 0.9 + i * L.pasoCaida, 0.5))
  const n = data.yaEnAxton + caidas.filter(v => v >= 0.999).length
  const capsula = pop(T, CUES.Fin + 4.2)
  const nM = data.meses.length

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: inn * out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', ...h, font: `700 56px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>{g.fin.titulo}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 240, textAlign: 'center', ...h, font: `700 120px ${F}`, color: INK, letterSpacing: '-0.03em', lineHeight: 1 }}>
        <span style={{ color: CEL }}>{n}</span><span style={{ color: GRIS, fontWeight: 300 }}> {g.fin.contadorTotal}</span>
        <div style={{ font: `400 26px ${F}`, color: GRIS, marginTop: 8, letterSpacing: 0 }}>{g.fin.pie}</div>
      </div>

      <div style={{ position: 'absolute', left: L.ejeX0, top: EJE_Y, height: 3, width: L.ejeAncho * linea, background: CEL }} />
      {data.meses.map((m, i) => (
        <div key={m.key} style={{ position: 'absolute', left: L.mesX(i), top: EJE_Y - 10, opacity: clamp(linea * 8 - i, 0, 1) }}>
          <div style={{ width: 3, height: 22, background: CEL, transform: 'translateX(-1px)' }} />
          <div style={{ position: 'absolute', top: 34, left: 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap', font: `600 22px ${F}`, color: i === nM - 1 ? INK : GRIS }}>{m.label}</div>
        </div>
      ))}
      {data.salidas.map((s, i) => {
        const p = caidas[i]
        const k = ranuraEnMes(data.salidas, i)
        const mi = data.meses.findIndex(m => m.key === s.mes)
        const y = lerp(EJE_Y - 260, EJE_Y - 34 - k * 34, Easing.easeOutCubic(p))
        return <div key={s.id} style={{ position: 'absolute', left: L.mesX(mi) - 13, top: y, width: 26, height: 26, borderRadius: 9999, background: CEL, opacity: p > 0 ? 1 : 0 }} />
      })}

      <div style={{ position: 'absolute', left: L.mesX(nM - 1), top: EJE_Y + 80, ...capsula, transformOrigin: 'top center' }}>
        <div style={{ transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-block', padding: '10px 26px', borderRadius: 9999, background: CEL, color: '#fff', font: `700 24px ${F}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{g.fin.capsula}</div>
          <div style={{ font: `400 26px ${F}`, color: INK, marginTop: 10 }}>{g.fin.capsulaSub}</div>
        </div>
      </div>
    </div>
  )
}

function Cierre({ T, g }: { T: number; g: Props['g'] }) {
  const t1 = enter(T, CUES.Cierre + 0.4), t2 = enter(T, CUES.Cierre + 1.1)
  const out = 1 - draw(T, CUES.total - 0.7, 0.5)
  return (
    <div style={{ position: 'absolute', inset: 0, textAlign: 'center', opacity: out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, ...t1, font: `700 64px ${F}`, color: INK, letterSpacing: '-0.01em' }}>{g.cierre.linea1}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 604, ...t2, font: `600 44px ${F}`, color: CEL }}>{g.cierre.linea2}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 720, ...t2, font: `300 26px ${F}`, color: GRIS }}>{g.cierre.wordmark}</div>
    </div>
  )
}

// ── la pieza completa ────────────────────────────────────────────────────────────

function Pieza({ T, data, g, L, mostrarAlertas, subtitulos }: Props & { mostrarAlertas: boolean; subtitulos: boolean }) {
  // Deriva de cámara: un respiro de ±1,2 % para que ningún frame quede del todo quieto.
  const drift = 1 + 0.012 * Math.sin(T * 0.35)
  const sub = subtitulos ? subtituloEn(g.subtitulos, T) : null
  const opSub = sub ? clamp((T - sub.at) / 0.18, 0, 1) : 0

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff', overflow: 'hidden', fontFamily: F }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${drift})`, transformOrigin: '50% 50%' }}>
        <Apertura T={T} g={g} />
        <Hoy T={T} data={data} g={g} L={L} />
        <Ola T={T} data={data} g={g} L={L} />
        <Cuentas T={T} data={data} g={g} L={L} />
        <Cuello T={T} data={data} g={g} L={L} mostrarAlertas={mostrarAlertas} />
        <Fin T={T} data={data} g={g} L={L} />
        <Cierre T={T} g={g} />
        <Header T={T} g={g} />
      </div>
      {sub && (
        <div style={{ position: 'absolute', left: 80, right: 80, bottom: '5%', textAlign: 'center', opacity: opSub, font: `600 34px ${F}`, color: INK }}>
          {sub.texto}
        </div>
      )}
    </div>
  )
}

// ── la vista (reloj, controles y exportación) ────────────────────────────────────

const PREFS_KEY = 'simulador-resumen-animado'

function leerPrefs(): { mostrarAlertas: boolean; subtitulos: boolean } {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return { mostrarAlertas: p.mostrarAlertas !== false, subtitulos: p.subtitulos !== false }
    }
  } catch { /* localStorage puede no estar disponible: se usan los defaults */ }
  return { mostrarAlertas: true, subtitulos: true }
}

export function ResumenAnimado() {
  const personas = useSimuladorStore(s => s.personas)
  const proyectos = useSimuladorStore(s => s.proyectos)
  const asignaciones = useSimuladorStore(s => s.asignaciones)
  const config = useSimuladorStore(s => s.config)
  const nombrePlan = useUIStore(s => s.nombrePlan)

  const [prefs, setPrefs] = useState(leerPrefs)
  // Si la URL trae `#t=31`, el video abre PAUSADO en ese segundo: es el link que se
  // pega en una reunión para clavar una escena sin buscarla con el scrubber.
  const [T, setT] = useState(() => segundoDelHash(location.hash) ?? 0)
  const [reproduciendo, setReproduciendo] = useState(() => segundoDelHash(location.hash) === null)
  const [loop, setLoop] = useState(true)
  const [grabando, setGrabando] = useState(false)
  const [escala, setEscala] = useState(0.5)
  const [linkCopiado, setLinkCopiado] = useState(false)
  const cajaRef = useRef<HTMLDivElement>(null)

  const data = useMemo(
    () => derivarResumen(personas, proyectos, asignaciones, config, new Date()),
    [personas, proyectos, asignaciones, config],
  )
  const g = useMemo(
    () => armarGuion(data, prefs.mostrarAlertas, nombrePlan ?? 'actual'),
    [data, prefs.mostrarAlertas, nombrePlan],
  )
  const L = useMemo(() => layoutDe(data), [data])

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* no pasa nada */ }
  }, [prefs])

  // Con el video pausado, la URL de la barra queda apuntando a ese segundo, así se puede
  // copiar y pegar directo. Mientras corre no se toca: sería escribir la URL 60 veces
  // por segundo. `replaceState` no agrega entradas al historial (el botón Atrás sigue
  // sirviendo para salir de la app, no para deshacer el scrubber).
  useEffect(() => {
    if (reproduciendo || grabando) return
    try { history.replaceState(null, '', hashDeSegundo(T)) } catch { /* no pasa nada */ }
  }, [T, reproduciendo, grabando])

  // El lienzo es de 1920×1080 fijo: se escala para que entre en el espacio disponible.
  useLayoutEffect(() => {
    const el = cajaRef.current
    if (!el) return
    const medir = () => {
      const r = el.getBoundingClientRect()
      setEscala(Math.max(0.1, Math.min(r.width / W, r.height / H)))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // El reloj. Avanza en tiempo real; al llegar al final, vuelve a cero o frena.
  useEffect(() => {
    if (!reproduciendo) return
    let anterior = performance.now()
    let raf = 0
    const tick = (ahora: number) => {
      const dt = (ahora - anterior) / 1000
      anterior = ahora
      setT(prev => {
        const siguiente = prev + dt
        if (siguiente < CUES.total) return siguiente
        if (loop) return siguiente - CUES.total
        setReproduciendo(false)
        return CUES.total
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reproduciendo, loop])

  /** Copia al portapapeles el link de esta escena (la URL de la app con `#t=`). */
  async function copiarLink() {
    setReproduciendo(false)
    const url = `${location.origin}${location.pathname}${location.search}${hashDeSegundo(T)}`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopiado(true)
      setTimeout(() => setLinkCopiado(false), 2000)
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS): al menos queda en la barra del navegador.
      try { history.replaceState(null, '', hashDeSegundo(T)) } catch { /* no pasa nada */ }
    }
  }

  /**
   * Exportar: el navegador graba la pestaña (le vas a tener que dar permiso y elegir
   * "esta pestaña") mientras el video corre una vuelta completa, y al terminar baja un
   * .webm. Es la ruta sin dependencias nuevas; para MP4, convertirlo después.
   */
  async function grabar() {
    const md = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (c: unknown) => Promise<MediaStream>
    }
    if (!md?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      alert('Este navegador no puede grabar la pestaña. Probá con Chrome o Edge.')
      return
    }
    let stream: MediaStream
    try {
      stream = await md.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
    } catch { return }   // el usuario canceló el diálogo

    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const partes: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) partes.push(e.data) }
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      setGrabando(false)
      const url = URL.createObjectURL(new Blob(partes, { type: 'video/webm' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `resumen-ejecutivo-${data.hoy}.webm`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }

    setGrabando(true)
    setLoop(false)
    setT(0)
    setReproduciendo(true)
    rec.start()
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop() }, (CUES.total + 0.4) * 1000)
  }

  const escenaActual = [...CUES_ORDENADOS].reverse().find(e => T >= e.at)?.nombre ?? 'Apertura'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {!grabando && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px', background: 'var(--white)', borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={() => setReproduciendo(r => !r)} style={btn(true)}>
            {reproduciendo ? '⏸ Pausa' : '▶ Reproducir'}
          </button>
          <button onClick={() => { setT(0); setReproduciendo(true) }} style={btn(false)}>↺ Desde el inicio</button>
          <input
            type="range" min={0} max={CUES.total} step={1 / 30} value={T}
            onChange={e => { setReproduciendo(false); setT(Number(e.target.value)) }}
            style={{ flex: 1, minWidth: 220, accentColor: 'var(--celeste)' }}
          />
          <span style={{ font: '600 13px var(--font)', color: 'var(--t2)', minWidth: 130 }}>
            {T.toFixed(1)}s / {CUES.total}s · {escenaActual}
          </span>
          <label style={check}><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> Loop</label>
          <label style={check}>
            <input type="checkbox" checked={prefs.mostrarAlertas} onChange={e => setPrefs(p => ({ ...p, mostrarAlertas: e.target.checked }))} /> Alertas
          </label>
          <label style={check}>
            <input type="checkbox" checked={prefs.subtitulos} onChange={e => setPrefs(p => ({ ...p, subtitulos: e.target.checked }))} /> Subtítulos
          </label>
          <button onClick={copiarLink} style={btn(false)} title="Copia el link con este segundo (#t=), para abrir el video clavado en esta escena">
            {linkCopiado ? '✓ Link copiado' : '🔗 Copiar escena'}
          </button>
          <button onClick={grabar} style={btn(false)} title="Graba la pestaña una vuelta completa y baja un .webm">⏺ Grabar video</button>
        </div>
      )}

      <div ref={cajaRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: grabando ? '#fff' : 'var(--lienzo)', padding: grabando ? 0 : 16, overflow: 'hidden' }}>
        <div style={{ width: W * escala, height: H * escala, position: 'relative', boxShadow: grabando ? 'none' : '0 10px 40px rgba(0,0,0,0.12)' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: W, height: H, transform: `scale(${escala})`, transformOrigin: '0 0' }}>
            <Pieza T={T} data={data} g={g} L={L} mostrarAlertas={prefs.mostrarAlertas} subtitulos={prefs.subtitulos} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Los cues como lista, para saber en qué escena está el reloj. */
const CUES_ORDENADOS = (['Apertura', 'Hoy', 'Ola', 'Cuello', 'Fin', 'Cierre'] as const)
  .map(nombre => ({ nombre, at: CUES[nombre] }))

function btn(primario: boolean): CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 9999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    border: primario ? 'none' : '1px solid var(--line)',
    background: primario ? 'var(--celeste)' : 'var(--white)',
    color: primario ? '#fff' : 'var(--t2)',
  }
}

const check: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--t2)', cursor: 'pointer',
}
