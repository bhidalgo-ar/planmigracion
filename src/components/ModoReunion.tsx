import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { capitulosReunion, estacionesDelPrograma, hoyProximo, mesCorto, mesesEntre, porMigrar, sumarMes, titularSalidas } from '../vistasPrograma'
import { cargaPorMes, personasDeImplementacion, picoDe, ultimaSalida } from '../escenario'
import { cuentasEnAxton } from '../capacidad'
import { nombreMes } from '../rules'
import { toISO } from '../utils/dates'

/**
 * Vista Reunión (C, 23/10/2026): el plan contado en cuatro preguntas, para proyectar. Cada
 * capítulo tiene una respuesta grande y un solo dibujo; las flechas del teclado o los botones
 * de abajo pasan de uno a otro. Todo sale del plan cargado: si en la reunión se mueve una
 * cuenta, los capítulos ya cuentan el plan nuevo.
 */
export function ModoReunion() {
  const { personas, proyectos, asignaciones, config, violaciones } = useSimuladorStore()
  const { setVista } = useUIStore()
  const hoyISO = toISO(new Date())
  const plan = useMemo(() => ({ personas, proyectos, asignaciones, config }), [personas, proyectos, asignaciones, config])
  const caps = useMemo(() => capitulosReunion(plan, violaciones, hoyISO), [plan, violaciones, hoyISO])
  const [cap, setCap] = useState(1)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setCap(c => Math.min(4, c + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setCap(c => Math.max(1, c - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--white)', display: 'flex', flexDirection: 'column' }}>
      <nav aria-label="Capítulos" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, padding: '18px 40px 0' }}>
        {caps.map(c => {
          const activo = c.num === cap
          return (
            <button key={c.num} type="button" onClick={() => setCap(c.num)} aria-current={activo ? 'step' : undefined}
              style={{ textAlign: 'left', padding: '14px 16px 16px', borderRadius: 14, cursor: 'pointer', font: 'inherit', background: activo ? 'var(--ink)' : 'var(--paper)', border: `2px solid ${activo ? 'var(--ink)' : 'var(--line-soft)'}` }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: activo ? 'var(--celeste)' : 'var(--celeste-deeper)' }}>{c.num}</span>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: activo ? 'var(--white)' : 'var(--t2)', marginTop: 2 }}>{c.pregunta}</span>
              <span style={{ display: 'block', fontSize: 20, fontWeight: 800, color: activo ? 'var(--white)' : 'var(--ink)', marginTop: 6, lineHeight: 1.2 }}>{c.respuesta}</span>
            </button>
          )
        })}
      </nav>

      <main style={{ flex: 1, padding: '40px 40px 20px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        {cap === 1 && <DondeEstamos />}
        {cap === 2 && <QueSale />}
        {cap === 3 && <DaElEquipo />}
        {cap === 4 && <QueDecidimos />}
      </main>

      <footer style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '16px 40px 24px', borderTop: '1px solid var(--line-soft)' }}>
        <button type="button" disabled={cap === 1} onClick={() => setCap(c => c - 1)} style={{ ...boton, opacity: cap === 1 ? 0.4 : 1 }}>← {cap > 1 ? caps[cap - 2].pregunta : 'Anterior'}</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t2)' }}>{cap} de 4</span>
        <button type="button" disabled={cap === 4} onClick={() => setCap(c => c + 1)} style={{ ...boton, background: 'var(--ink)', color: 'var(--white)', border: 'none', opacity: cap === 4 ? 0.4 : 1 }}>{cap < 4 ? caps[cap].pregunta : 'Siguiente'} →</button>
        <button type="button" onClick={() => setVista('timeline')} style={{ ...boton, marginLeft: 'auto' }}>Modo trabajo</button>
      </footer>
    </div>
  )

  // ── capítulos ─────────────────────────────────────────────────────────────────
  function DondeEstamos() {
    const mesHoy = hoyISO.slice(0, 7)
    const enAxton = cuentasEnAxton(mesHoy, config)
    const { porMigrar: pm, quedan } = porMigrar(config, hoyISO)
    const ahora = hoyProximo(plan, violaciones, hoyISO).ahora
    const cuadros = [...Array(enAxton).fill('axton'), ...Array(pm).fill('migra'), ...Array(quedan).fill('queda')] as string[]
    return (
      <>
        <h1 style={h1}>{enAxton} de {enAxton + pm + quedan} cuentas ya liquidan en Axton</h1>
        <p style={bajada}>Faltan {pm} por migrar{quedan ? `; ${quedan} se quedan en Meta 4` : ''}.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 24, maxWidth: 1100 }} aria-hidden="true">
          {cuadros.map((c, i) => <span key={i} style={{ width: 34, height: 34, borderRadius: 8, background: c === 'axton' ? 'var(--viz-axton)' : 'transparent', border: c === 'migra' ? '3px solid var(--celeste)' : c === 'queda' ? '3px dashed var(--gris)' : 'none', boxSizing: 'border-box' }} />)}
        </div>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 14, color: 'var(--t2)', marginTop: 6 }}>
          <span><Cuadro c="var(--viz-axton)" /> en Axton</span><span><Cuadro borde="3px solid var(--celeste)" /> por migrar</span>{quedan > 0 && <span><Cuadro borde="3px dashed var(--gris)" /> se quedan en Meta 4</span>}
        </div>
        {ahora.length > 0 && (
          <div style={{ marginTop: 26 }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--celeste-deeper)' }}>En curso ahora</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
              {ahora.map(a => (
                <div key={a.nombre} style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--paper)', border: '1px solid var(--line-soft)', minWidth: 200 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{a.nombre}</div>
                  <div style={{ fontSize: 14, color: 'var(--t1)', marginTop: 2 }}>{a.texto}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    )
  }

  function QueSale() {
    const est = estacionesDelPrograma(plan, hoyISO)
    const sin = est.filter(e => !e.cuentas.length).map(e => nombreMes(e.mes).toLowerCase())
    if (!est.length) return <h1 style={h1}>No quedan salidas en el plan</h1>
    return (
      <>
        <h1 style={h1}>{titularSalidas(plan, hoyISO)}</h1>
        <p style={bajada}>De {est[0].enAxton} cuentas en Axton hoy a {est[est.length - 1].enAxton}.{sin.length ? ` ${(t => t.charAt(0).toUpperCase() + t.slice(1))(sin.join(' y '))} no tiene${sin.length !== 1 ? 'n' : ''} salidas.` : ''}</p>
        <div style={{ overflowX: 'auto', marginTop: 34 }}>
          <div style={{ minWidth: Math.max(900, est.length * 84), position: 'relative', paddingTop: 6 }}>
            <div aria-hidden="true" style={{ position: 'absolute', left: `${50 / est.length}%`, right: `${50 / est.length}%`, top: 77, height: 6, borderRadius: 3, background: 'var(--line)' }} />
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${est.length}, minmax(0, 1fr))`, position: 'relative' }}>
              {est.map(e => (
                <div key={e.mes} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
                  <span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)' }} title="Cuentas en Axton al cierre del mes">{e.enAxton}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, color: e.esHoy ? 'var(--celeste-deeper)' : 'var(--ink)' }}>{mesCorto(e.mes)}</span>
                  <span style={{ width: 30, height: 30, boxSizing: 'border-box', borderRadius: '50%', margin: '4px 0', background: e.esHoy ? 'var(--celeste)' : 'var(--white)', border: `4px solid ${e.esHoy ? 'var(--celeste-deeper)' : e.cuentas.length ? 'var(--ink)' : 'var(--line)'}` }} />
                  {e.cuentas.map(c => <span key={c} style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.15 }}>{c}</span>)}
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t2)' }}>{e.esHoy ? 'hoy' : !e.cuentas.length ? 'sin salida' : e.ultima ? 'última' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--t2)' }}>El número de arriba son las cuentas en Axton al cierre de cada mes.</p>
      </>
    )
  }

  function DaElEquipo() {
    const carga = cargaPorMes(plan)
    const ps = personasDeImplementacion(plan)
    const mesHoy = hoyISO.slice(0, 7)
    const ult = ultimaSalida(plan) ?? mesHoy
    const meses = mesesEntre(mesHoy, sumarMes(ult > mesHoy ? ult : mesHoy, 1))
    const picos = ps.map(p => ({ p, k: picoDe(Object.fromEntries(Object.entries(carga[p.id] ?? {}).filter(([m]) => m >= mesHoy))) }))
    const max = picos.reduce<{ alias: string; pct: number; mes: string } | null>((a, x) => (x.k && (!a || x.k.pct > a.pct) ? { alias: x.p.alias, pct: x.k.pct, mes: x.k.mes } : a), null)
    return (
      <>
        <h1 style={h1}>{!max ? 'Sin carga planificada' : max.pct <= 100 ? `Nadie pasa del ${max.pct} % de su capacidad en un mes` : `${max.alias} llega al ${max.pct} % en ${nombreMes(max.mes).toLowerCase()}`}</h1>
        <p style={bajada}>Horas planificadas contra la capacidad de cada persona, mes a mes{max ? `. El pico es de ${max.alias}, en ${nombreMes(max.mes).toLowerCase()}` : ''}.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 24, overflowX: 'auto' }}>
          {ps.map(p => (
            <div key={p.id} style={{ minWidth: Math.max(800, meses.length * 52) }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', marginBottom: 6 }}>{p.alias}</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${meses.length}, minmax(0, 1fr))`, gap: 6, alignItems: 'end', height: 90, borderBottom: '1px solid var(--line)' }}>
                {meses.map(m => {
                  const v = carga[p.id]?.[m] ?? 0
                  return <div key={m} title={`${nombreMes(m)}: ${v} %`} style={{ height: `${Math.min(100, v)}%`, background: v > 100 ? 'var(--error)' : v >= 85 ? 'var(--warn)' : 'var(--viz-cierre)', borderRadius: '4px 4px 0 0' }} />
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${meses.length}, minmax(0, 1fr))`, gap: 6, marginTop: 4 }}>
                {meses.map(m => <span key={m} className="num" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--t2)', textAlign: 'center', lineHeight: 1.25 }}>{mesCorto(m)}<span style={{ display: 'block', color: 'var(--ink)' }}>{carga[p.id]?.[m] ?? 0}</span></span>)}
              </div>
            </div>
          ))}
        </div>
      </>
    )
  }

  function QueDecidimos() {
    const rojos = violaciones.filter(v => v.severidad === 'rojo')
    const avisos = violaciones.filter(v => v.severidad === 'ambar')
    return (
      <>
        <h1 style={h1}>{rojos.length ? `${rojos.length} ${rojos.length === 1 ? 'cosa' : 'cosas'} para decidir` : 'Nada en rojo'}</h1>
        <p style={bajada}>{rojos.length ? 'Son las reglas del plan que hoy no se cumplen. Cada una dice qué cuenta, qué fase y cuándo.' : avisos.length ? `El plan cumple todas las reglas. Hay ${avisos.length} aviso${avisos.length !== 1 ? 's' : ''} de semanas cargadas para mirar.` : 'El plan cumple todas las reglas y no hay semanas sobrecargadas.'}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20, maxWidth: 1100 }}>
          {rojos.map((v, i) => <div key={`r${i}`} style={{ padding: '14px 18px', borderRadius: 12, background: 'var(--error-bg)', border: '1px solid var(--error-bd)', color: 'var(--error-tx)', fontSize: 17, fontWeight: 600 }}>{v.mensaje}</div>)}
          {avisos.slice(0, 6).map((v, i) => <div key={`a${i}`} style={{ padding: '12px 18px', borderRadius: 12, background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', color: 'var(--warn-tx)', fontSize: 15, fontWeight: 600 }}>{v.mensaje}</div>)}
          {avisos.length > 6 && <div style={{ fontSize: 14, color: 'var(--t2)' }}>… y {avisos.length - 6} avisos más.</div>}
        </div>
      </>
    )
  }
}

function Cuadro({ c, borde }: { c?: string; borde?: string }) {
  return <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 4, verticalAlign: '-2px', marginRight: 6, background: c ?? 'transparent', border: borde ?? 'none', boxSizing: 'border-box' }} />
}

const h1: CSSProperties = { margin: 0, fontSize: 52, lineHeight: 1.05, fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--ink)' }
const bajada: CSSProperties = { margin: 0, fontSize: 19, color: 'var(--t2)', maxWidth: 1100, lineHeight: 1.4 }
const boton: CSSProperties = { font: 'inherit', padding: '11px 18px', borderRadius: 9999, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--t1)', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }
