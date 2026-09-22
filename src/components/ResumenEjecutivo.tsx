import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { addDays, parseISO } from 'date-fns'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { getMondayOfWeek, toISO } from '../utils/dates'
import { cargaSemanal } from '../capacidad'
import { ddmm, margenesPorCuenta, nombreMes } from '../rules'
import { derivarResumen } from '../resumen/derivarResumen'

import type { TipoRegla, Violacion } from '../types'

/**
 * PDF para dirección (Manuel Rossi), armado con Willy el 22/09/2026: página 1 memo de
 * una carilla, página 2 una tarjeta por decisión, página 3 capacidad del equipo (planilla
 * semanal + ranking de semanas). Todo lo que es "qué pasa" sale del plan (mismos
 * `rules.ts`/`capacidad.ts` que el resto de la app); las opciones y la recomendación de
 * cada decisión las escribe Willy a mano antes de imprimir — la app no las inventa.
 */

const REGLA_NOMBRE: Record<TipoRegla, string> = {
  dependencia: 'Pruebas antes de cerrar la configuración',
  margen: 'Poco margen hasta el corte de novedades',
  blackout: 'Configuración dentro del blackout',
  tope_salidas: 'Salidas en vivo por mes',
  carga_mes: 'Personas por encima de su capacidad mensual',
  carga_semana: 'Semanas con carga concentrada (aviso)',
  vacaciones: 'Fases sobre las vacaciones de quien las hace',
}
/** Motivos que ya tienen su propia tarjeta de decisión: el resto va al apéndice. */
const RESTO_REGLAS: TipoRegla[] = ['vacaciones', 'dependencia', 'blackout', 'tope_salidas', 'carga_semana']
const TOL_SEMANAL_DEFAULT = 1.15

function mondaysInRange(desdeISO: string, hastaISO: string): string[] {
  const out: string[] = []
  let d = getMondayOfWeek(parseISO(desdeISO))
  const fin = parseISO(hastaISO)
  for (let i = 0; i < 20 && d <= fin; i++) { out.push(toISO(d)); d = addDays(d, 7) }
  return out
}

export function ResumenEjecutivo() {
  const { proyectos, asignaciones, personas, violaciones, config } = useSimuladorStore()
  const setResumen = useUIStore(s => s.setResumen)
  const [copiado, setCopiado] = useState(false)
  const copiadoTimer = useRef<number>()
  useEffect(() => () => { if (copiadoTimer.current) clearTimeout(copiadoTimer.current) }, [])

  const hoy = useMemo(() => new Date(), [])
  const hoyTxt = format(hoy, "d 'de' MMMM yyyy", { locale: es })

  const resumen = useMemo(
    () => derivarResumen(personas, proyectos, asignaciones, config, hoy),
    [personas, proyectos, asignaciones, config, hoy],
  )

  const d = useMemo(() => {
    const rojos = violaciones.filter(v => v.severidad === 'rojo')
    const avisos = violaciones.filter(v => v.severidad === 'ambar')

    const margenes = margenesPorCuenta(asignaciones, config, proyectos)
    const margenPorProyecto = new Map(margenes.map(m => [m.proyectoId, m]))
    const minimoMargen = config.capacidad?.margen_minimo_habiles ?? 2

    // Decisión 1: los meses en rojo por carga, el más grave primero (proporción horas/capacidad).
    const exceso = (v: Violacion) => (v.horas && v.capacidad ? v.horas / v.capacidad : 0)
    const decisionesCarga = rojos
      .filter(v => v.tipo === 'carga_mes')
      .sort((a, b) => exceso(b) - exceso(a))
      .slice(0, 2)

    // Decisión 2: las cuentas con menos margen al corte, la más ajustada primero (hábiles reales de margenesPorCuenta).
    const decisionesMargen = rojos
      .filter(v => v.tipo === 'margen')
      .sort((a, b) => {
        const ha = margenPorProyecto.get(a.proyecto_id ?? '')?.habiles ?? 999
        const hb = margenPorProyecto.get(b.proyecto_id ?? '')?.habiles ?? 999
        return ha - hb
      })

    // Apéndice: todo lo demás que el motor de reglas marcó, agrupado por tipo.
    const porRegla = Object.fromEntries(RESTO_REGLAS.map(k => [k, [] as string[]])) as Record<TipoRegla, string[]>
    for (const v of violaciones) if (RESTO_REGLAS.includes(v.tipo)) porRegla[v.tipo].push(v.mensaje)

    // Barras E: planilla semanal alrededor del mes crítico (mismo `cuello` que el video del Resumen).
    const semanal = cargaSemanal(personas, asignaciones, config)
    const ventana = resumen.cuello?.ventana ?? null
    const semanas = ventana ? mondaysInRange(ventana.desde, ventana.hasta) : []
    const porPersonaSemana = new Map<string, Map<string, { horas: number; capacidad: number }>>()
    for (const c of semanal) {
      if (!semanas.includes(c.semana)) continue
      if (!porPersonaSemana.has(c.personaId)) porPersonaSemana.set(c.personaId, new Map())
      porPersonaSemana.get(c.personaId)!.set(c.semana, { horas: c.horas, capacidad: c.capacidad })
    }
    const filasPlanilla = personas
      .map(p => {
        const porSemana = porPersonaSemana.get(p.id)
        const totalHoras = porSemana ? [...porSemana.values()].reduce((s, x) => s + x.horas, 0) : 0
        const totalCap = porSemana ? [...porSemana.values()].reduce((s, x) => s + x.capacidad, 0) : 0
        return { persona: p, porSemana, totalHoras, totalCap }
      })
      .filter(f => f.totalHoras > 0.05)

    // Carga B: ranking de las semanas más cargadas de todo el programa, no solo la ventana.
    const tol = config.capacidad?.aviso_semanal_tolerancia ?? TOL_SEMANAL_DEFAULT
    const idANombre = new Map(asignaciones.map(a => [a.id, proyectos.find(p => p.id === a.proyecto_id)?.nombre ?? a.proyecto_id ?? '']))
    const ranking = semanal
      .filter(c => c.capacidad > 0 && c.horas > c.capacidad * tol)
      .map(c => {
        const alias = personas.find(p => p.id === c.personaId)?.alias ?? c.personaId
        const cuentas = [...new Set(Object.keys(c.porBarra).map(id => idANombre.get(id)).filter(Boolean))] as string[]
        return { alias, semana: c.semana, horas: c.horas, capacidad: c.capacidad, pct: Math.round((c.horas / c.capacidad) * 100), cuentas }
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8)

    return {
      rojos: rojos.length, avisos: avisos.length, decisionesCarga, decisionesMargen, porRegla,
      minimoMargen, margenPorProyecto, semanas, filasPlanilla, ranking, tolPct: Math.round(tol * 100),
    }
  }, [proyectos, asignaciones, personas, violaciones, config, resumen])

  const [decisionTexto, setDecisionTexto] = useState<Record<string, string>>({})
  function campoDecision(id: string, valor: string) {
    setDecisionTexto(prev => ({ ...prev, [id]: valor }))
  }

  function textoPlano(): string {
    const L: string[] = []
    L.push('SIMULADOR DE MIGRACIÓN Meta4 → Axton — Resumen para dirección')
    L.push(`Hidalgo & Asociados · ${hoyTxt}`, '')
    L.push(`En Axton: ${resumen.yaEnAxton} de ${resumen.total}  |  Por migrar: ${resumen.porMigrar}  |  Fin del programa: ${resumen.fin.label} (${resumen.fin.cuenta})  |  Conflictos: ${d.rojos}  |  Avisos: ${d.avisos}`)
    L.push('', 'DECISIONES PENDIENTES')
    if (!d.decisionesCarga.length && !d.decisionesMargen.length) L.push('· Sin decisiones de capacidad o calendario abiertas en este plan.')
    for (const v of d.decisionesCarga) L.push(`· Capacidad — ${v.mensaje}`)
    for (const v of d.decisionesMargen) L.push(`· Calendario — ${v.mensaje}`)
    L.push('', 'CALENDARIO DE SALIDAS')
    for (const m of resumen.meses) {
      L.push(`· ${m.label}: ${m.salidas.length ? m.salidas.map(s => s.nombre).join(', ') : '—'}`)
    }
    return L.join('\n')
  }

  async function copiar() {
    const txt = textoPlano()
    try {
      await navigator.clipboard.writeText(txt)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = txt; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(ta)
    }
    setCopiado(true)
    if (copiadoTimer.current) clearTimeout(copiadoTimer.current)
    copiadoTimer.current = window.setTimeout(() => setCopiado(false), 1800)
  }

  return (
    <div className="reporte-overlay" onClick={() => setResumen(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,19,30,0.55)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '24px 16px' }}>
      {/* Chrome (no se imprime) */}
      <div className="reporte-chrome" onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, marginBottom: 14, position: 'sticky', top: 0 }}>
        <button onClick={copiar} style={btn}>{copiado ? '✓ Copiado' : '📋 Copiar para mail'}</button>
        <button onClick={() => window.print()} style={{ ...btn, background: 'var(--celeste)', color: '#fff', border: 'none' }}>🖨 Imprimir / Guardar PDF</button>
        <button onClick={() => setResumen(false)} style={btn}>Cerrar</button>
      </div>

      <div id="reporte-print" onClick={e => e.stopPropagation()}>
        <PaginaMemo resumen={resumen} d={d} hoyTxt={hoyTxt} />
        <PaginaDecisiones resumen={resumen} d={d} hoyTxt={hoyTxt} decisionTexto={decisionTexto} onCampo={campoDecision} />
        <PaginaCapacidad d={d} hoyTxt={hoyTxt} />
      </div>
    </div>
  )
}

// ══ Encabezado / pie comunes a las tres hojas ═══════════════════════════════════

function Hoja({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="hoja-print">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '3px solid #00ACD4', paddingBottom: 12, marginBottom: 18 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#00ACD4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>H&amp;A</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10.5, color: '#8C837B', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Hidalgo &amp; Asociados · Migración Meta 4 → Axton</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#15263D' }}>{titulo}</div>
        </div>
      </div>
      {children}
      <div style={{ marginTop: 22, paddingTop: 10, borderTop: '1px solid #E7E6E6', fontSize: 9, color: '#8FA3BA', display: 'flex', justifyContent: 'space-between' }}>
        <span>Hidalgo &amp; Asociados · info_ar@bhidalgo.com.ar · +54 11 2284 2031</span>
        <span>Simulador de Migración · planificación previa, la ejecución sigue en Monday</span>
      </div>
    </div>
  )
}

// ══ Página 1 — Memo de una carilla ══════════════════════════════════════════════

function PaginaMemo({ resumen, d, hoyTxt }: { resumen: ReturnType<typeof derivarResumen>; d: any; hoyTxt: string }) {
  const nMeses = resumen.meses.length
  return (
    <Hoja titulo="Dónde está la migración y qué hay que decidir">
      <p style={{ ...pTxt, fontSize: 11, color: '#8FA3BA' }}>Para Manuel Rossi · preparado por Willy Esposito · {hoyTxt} · una carilla</p>

      <p style={pTxt}>
        Hoy hay <b>{resumen.yaEnAxton} cuentas en Axton</b> de las {resumen.total} que liquida el equipo de payroll.
        Quedan <b>{resumen.porMigrar} por migrar</b>, todas con mes de salida asignado, y la última
        ({resumen.fin.cuenta}) sale en <b>{resumen.fin.label}</b>.
      </p>
      <p style={pTxt}>
        El programa se reparte en {nMeses} {nMeses === 1 ? 'mes' : 'meses'}. Cada salida en vivo queda atada
        al <b>corte de novedades</b> del cliente: la actualización final (el cierre de la cuenta) tiene que
        terminar con margen antes de esa fecha, hoy configurado en {d.minimoMargen} días hábiles como mínimo.
      </p>
      {d.decisionesCarga.length > 0 || d.decisionesMargen.length > 0 ? (
        <p style={pTxt}>
          Sobre ese calendario hay {d.decisionesCarga.length + d.decisionesMargen.length}{' '}
          {d.decisionesCarga.length + d.decisionesMargen.length === 1 ? 'punto abierto' : 'puntos abiertos'} para decidir
          (detalle en la página 2): {d.decisionesCarga.length > 0 ? 'capacidad del equipo en algún mes' : ''}
          {d.decisionesCarga.length > 0 && d.decisionesMargen.length > 0 ? ' y ' : ''}
          {d.decisionesMargen.length > 0 ? 'cuentas que cierran muy cerca de su corte' : ''}.
        </p>
      ) : (
        <p style={pTxt}>No hay meses por encima de la capacidad del equipo ni cuentas por debajo del margen mínimo configurado: el calendario actual no tiene puntos abiertos de capacidad o corte.</p>
      )}

      <h2 style={hSub}>Calendario de salidas</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #E7E6E6', textAlign: 'left' }}>
            <th style={th}>Mes</th><th style={th}>Salen en vivo</th><th style={{ ...th, textAlign: 'right', width: 150 }}>Margen al corte (cierre)</th>
          </tr>
        </thead>
        <tbody>
          {resumen.meses.map(m => (
            <tr key={m.key} style={{ borderBottom: '1px solid #EEF2F7' }}>
              <td style={{ ...td, fontWeight: 700 }}>{m.label}</td>
              <td style={td}>
                {m.salidas.length ? m.salidas.map(s => (
                  <span key={s.id} style={{ ...chip, ...(s.fueraDelPlan ? chipGris : {}) }}>{s.nombre}</span>
                )) : '—'}
              </td>
              <td style={{ ...td, textAlign: 'right' }}>
                {m.salidas.map(s => {
                  const mg = d.margenPorProyecto.get(s.id)?.habiles
                  if (s.fueraDelPlan) return <span key={s.id} style={margenTxt}>ya lista</span>
                  if (mg == null) return null
                  return <span key={s.id} style={mg < d.minimoMargen + 3 ? margenTxtBajo : margenTxt}>{mg} d</span>
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 9, color: '#8FA3BA', marginTop: 6 }}>
        Gris = cuenta ya configurada, sale sin pasar por fases en el simulador. Margen = días hábiles entre la
        actualización final (el cierre) y el corte de novedades del cliente; en negrita cuando queda ajustado.
      </p>
    </Hoja>
  )
}

// ══ Página 2 — Una página por decisión ══════════════════════════════════════════

function PaginaDecisiones({ resumen, d, decisionTexto, onCampo }: {
  resumen: ReturnType<typeof derivarResumen>; d: any; hoyTxt: string
  decisionTexto: Record<string, string>; onCampo: (id: string, v: string) => void
}) {
  const nDecisiones = d.decisionesCarga.length + d.decisionesMargen.length + 1
  const otras = RESTO_REGLAS.filter(k => d.porRegla[k].length > 0)
  return (
    <Hoja titulo="Decisiones pendientes">
      <p style={pTxt}>
        Estado: {resumen.yaEnAxton} de {resumen.total} cuentas en Axton · {resumen.porMigrar} por migrar · fin en {resumen.fin.label}.
        {' '}{nDecisiones} {nDecisiones === 1 ? 'tema' : 'temas'} para revisar. El "qué pasa" de cada uno sale del plan cargado;
        opciones, recomendación y fecha límite las completa Willy antes de la reunión.
      </p>

      {d.decisionesCarga.map((v: Violacion, i: number) => (
        <DecisionCard key={v.asignacion_id + v.mes} n={i + 1} categoria="Capacidad"
          titulo={`${v.mes ? nombreMes(v.mes) : 'Un mes'} no entra con el equipo actual`}
          quePasa={v.mensaje} id={`carga-${v.mes}`} texto={decisionTexto} onCampo={onCampo} />
      ))}
      {d.decisionesMargen.map((v: Violacion) => (
        <DecisionCard key={v.asignacion_id + v.proyecto_id} n={d.decisionesCarga.length + d.decisionesMargen.indexOf(v) + 1} categoria="Calendario"
          titulo="Cierra muy cerca del corte de novedades"
          quePasa={v.mensaje} id={`margen-${v.proyecto_id}`} texto={decisionTexto} onCampo={onCampo} />
      ))}

      <div style={comentario}>
        <div style={{ fontWeight: 700, color: '#00ACD4', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          Para la charla, sin decisión todavía
        </div>
        <p style={{ ...pTxt, margin: 0 }}>
          Hay cuentas de Outsourcing que siguen liquidando en Meta 4 y no forman parte de este programa: mientras
          sigan afuera, Meta 4 no se apaga aunque terminen las que sí están en el plan. Vale como tema de
          conversación inicial, no como decisión de esta reunión.
        </p>
      </div>

      {otras.length > 0 && (
        <>
          <h2 style={hSub}>Otros avisos del motor de reglas</h2>
          {otras.map(k => (
            <div key={k} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#15263D' }}>{REGLA_NOMBRE[k]} <span style={{ color: '#8FA3BA', fontWeight: 400 }}>({d.porRegla[k].length})</span></div>
              <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                {d.porRegla[k].slice(0, 4).map((m: string, i: number) => <li key={i} style={{ fontSize: 9.5, color: '#4A6080', lineHeight: 1.5 }}>{m}</li>)}
                {d.porRegla[k].length > 4 && <li style={{ fontSize: 9.5, color: '#8FA3BA' }}>… y {d.porRegla[k].length - 4} más</li>}
              </ul>
            </div>
          ))}
        </>
      )}
    </Hoja>
  )
}

function DecisionCard({ n, categoria, titulo, quePasa, id, texto, onCampo }: {
  n: number; categoria: string; titulo: string; quePasa: string; id: string
  texto: Record<string, string>; onCampo: (id: string, v: string) => void
}) {
  return (
    <div style={dec}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#00ACD4', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Decisión {n} · {categoria}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#15263D', margin: '2px 0 6px' }}>{titulo}</div>
      <DecRow label="Qué pasa"><span>{quePasa}</span></DecRow>
      <DecRow label="Opciones">
        <textarea className="reporte-campo" value={texto[`${id}-op`] ?? ''} onChange={e => onCampo(`${id}-op`, e.target.value)}
          placeholder="(a) … (b) … — a completar antes de imprimir" style={campo} rows={2} />
      </DecRow>
      <DecRow label="Recomendación">
        <textarea className="reporte-campo" value={texto[`${id}-rec`] ?? ''} onChange={e => onCampo(`${id}-rec`, e.target.value)}
          placeholder="—" style={campo} rows={1} />
      </DecRow>
      <DecRow label="Para cuándo">
        <textarea className="reporte-campo" value={texto[`${id}-fecha`] ?? ''} onChange={e => onCampo(`${id}-fecha`, e.target.value)}
          placeholder="—" style={{ ...campo, height: 20 }} rows={1} />
      </DecRow>
    </div>
  )
}

function DecRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 4, alignItems: 'flex-start' }}>
      <div style={{ width: 84, flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: '#4A6080', textTransform: 'uppercase', letterSpacing: '0.03em', paddingTop: 2 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 10.5, color: '#1E3A5F', lineHeight: 1.45 }}>{children}</div>
    </div>
  )
}

// ══ Página 3 — Capacidad del equipo: planilla semanal + ranking ════════════════

function PaginaCapacidad({ d, hoyTxt }: { d: any; hoyTxt: string }) {
  return (
    <Hoja titulo="Capacidad del equipo">
      <p style={pTxt}>
        Semana a semana, alrededor del mes más cargado del programa: cuánto tiene planificado cada persona
        (celda en negrita cuando supera su capacidad esa semana) y, más abajo, el ranking de las semanas
        más cargadas de todo el plan, con las cuentas que las causan. {hoyTxt}.
      </p>

      <h2 style={hSub}>Planilla semanal (Barras E)</h2>
      {d.filasPlanilla.length && d.semanas.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E7E6E6' }}>
              <th style={{ ...th, textAlign: 'left' }}>Persona</th>
              {d.semanas.map((s: string) => <th key={s} style={{ ...th, textAlign: 'right' }}>{ddmm(s)}</th>)}
              <th style={{ ...th, textAlign: 'right' }}>Total ventana</th>
            </tr>
          </thead>
          <tbody>
            {d.filasPlanilla.map((f: any) => (
              <tr key={f.persona.id} style={{ borderBottom: '1px solid #EEF2F7' }}>
                <td style={{ ...td, fontWeight: 700 }}>{f.persona.alias}</td>
                {d.semanas.map((s: string) => {
                  const c = f.porSemana?.get(s)
                  const sobre = c && c.capacidad > 0 && c.horas > c.capacidad + 0.05
                  return <td key={s} style={{ ...td, textAlign: 'right', fontWeight: sobre ? 800 : 400, textDecoration: sobre ? 'underline' : 'none' }}>{c ? Math.round(c.horas) : '–'}</td>
                })}
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                  {Math.round(f.totalHoras)} h <span style={{ color: '#8FA3BA', fontWeight: 400 }}>/ {Math.round(f.totalCap)} h</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ ...pTxt, color: '#4A6080' }}>Este plan no tiene un mes con carga por encima de la capacidad: no hay una ventana crítica que mostrar.</p>
      )}

      <h2 style={hSub}>Ranking de semanas más cargadas (Carga B)</h2>
      {d.ranking.length ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E7E6E6', textAlign: 'left' }}>
              <th style={th}>#</th><th style={th}>Persona</th><th style={th}>Semana del</th>
              <th style={{ ...th, textAlign: 'right' }}>Horas</th><th style={{ ...th, textAlign: 'right' }}>Capacidad</th>
              <th style={{ ...th, textAlign: 'right' }}>%</th><th style={th}>Cuentas</th>
            </tr>
          </thead>
          <tbody>
            {d.ranking.map((r: any, i: number) => (
              <tr key={r.alias + r.semana} style={{ borderBottom: '1px solid #EEF2F7' }}>
                <td style={td}>{i + 1}</td>
                <td style={{ ...td, fontWeight: 700 }}>{r.alias}</td>
                <td style={td}>{ddmm(r.semana)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{Math.round(r.horas)} h</td>
                <td style={{ ...td, textAlign: 'right' }}>{Math.round(r.capacidad)} h</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{r.pct}%</td>
                <td style={{ ...td, fontSize: 9.5 }}>{r.cuentas.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ ...pTxt, color: '#4A6080' }}>Ninguna semana supera la tolerancia de aviso configurada: no hay semanas para rankear.</p>
      )}
      <p style={{ fontSize: 9, color: '#8FA3BA', marginTop: 6 }}>
        Semanas listadas: por encima del {d.tolPct}% de la capacidad de esa semana, la misma tolerancia de aviso
        de la regla <code>carga_semana</code> y de la banda de carga del Timeline.
      </p>
    </Hoja>
  )
}

// ══ Estilos ══════════════════════════════════════════════════════════════════════

const btn: CSSProperties = { padding: '8px 16px', border: '1.5px solid var(--line)', borderRadius: 9999, background: 'var(--white)', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--t1)' }
const hSub: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: '#15263D', margin: '16px 0 8px' }
const pTxt: CSSProperties = { fontSize: 11, lineHeight: 1.55, color: '#1E3A5F', margin: '0 0 9px' }
const th: CSSProperties = { padding: '5px 8px', fontSize: 9.5, color: '#4A6080', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }
const td: CSSProperties = { padding: '5px 8px', color: '#1E3A5F', verticalAlign: 'top' }
const chip: CSSProperties = { display: 'inline-block', border: '1px solid #00ACD4', color: '#00ACD4', borderRadius: 9999, padding: '1px 9px', fontSize: 9.5, fontWeight: 700, marginRight: 5, marginBottom: 3 }
const chipGris: CSSProperties = { border: '1px solid #BFC5CC', color: '#8FA3BA' }
const margenTxt: CSSProperties = { fontSize: 9.5, color: '#4A6080', marginLeft: 6 }
const margenTxtBajo: CSSProperties = { ...margenTxt, fontWeight: 800, textDecoration: 'underline', color: '#15263D' }
const dec: CSSProperties = { border: '1px solid #E7E6E6', borderRadius: 8, padding: '10px 14px', marginBottom: 10, breakInside: 'avoid' }
const comentario: CSSProperties = { border: '1px dashed #BFC5CC', borderRadius: 8, padding: '10px 14px', marginBottom: 14, breakInside: 'avoid' }
const campo: CSSProperties = { width: '100%', border: '1px solid #E7E6E6', borderRadius: 4, padding: '4px 6px', fontSize: 10.5, fontFamily: 'inherit', color: '#1E3A5F', resize: 'vertical' }
