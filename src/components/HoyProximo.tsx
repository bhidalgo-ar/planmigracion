import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { useSimuladorStore } from '../store'
import { ETAPAS, hoyProximo, mesCorto } from '../vistasPrograma'
import { ddmm, nombreMes } from '../rules'
import { toISO } from '../utils/dates'

const COLOR_ETAPA: Record<string, string> = {
  Relevamiento: 'var(--fase-relev)', Configuracion: 'var(--fase-config)', Pruebas: 'var(--fase-pruebas)', Cierre: 'var(--fase-cierre)',
}
const COLOR_MOMENTO: Record<string, string> = {
  armando: 'var(--fase-pruebas)', en_vivo: 'var(--fase-cierre)', esperando: 'var(--warn)', fuera: 'var(--gris)', sin_empezar: 'var(--fase-relev)', en_axton: 'var(--viz-axton)',
}

/**
 * Vista Hoy (B, 23/10/2026): el plan ordenado alrededor de hoy, para el seguimiento semanal.
 * Qué se está haciendo, cuánto falta para cada corte, qué viene después y cómo está el equipo
 * las próximas ocho semanas. Contesta "qué pasa" sin que nadie tenga que leer un Gantt.
 */
export function HoyProximo() {
  const { personas, proyectos, asignaciones, config, violaciones } = useSimuladorStore()
  const hoyISO = toISO(new Date())
  const d = useMemo(() => hoyProximo({ personas, proyectos, asignaciones, config }, violaciones, hoyISO), [personas, proyectos, asignaciones, config, violaciones, hoyISO])

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--lienzo)' }}>
      <section style={{ padding: '26px 32px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-0.015em', color: 'var(--ink)', maxWidth: 980 }}>{d.titular}</h1>
        <p style={{ margin: 0, fontSize: 15.5, color: 'var(--t2)', maxWidth: 980, lineHeight: 1.45 }}>{d.bajada}</p>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, padding: '0 32px 32px', alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 760px', minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, alignItems: 'start' }}>
          <Columna titulo="Ahora" bajada="Lo que se está haciendo y lo que arranca en las próximas dos semanas.">
            {d.ahora.length === 0 && <Vacio>Nada en curso.</Vacio>}
            {d.ahora.map(a => (
              <article key={a.nombre} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--paper)', border: '1px solid var(--line-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLOR_MOMENTO[a.momento], flexShrink: 0 }} />
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>{a.nombre}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--t1)', textAlign: 'right' }}>{a.etiqueta}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--t1)', marginTop: 6, lineHeight: 1.4 }}>{a.texto}</div>
                {a.sigue && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4 }}>{a.sigue}</div>}
              </article>
            ))}
          </Columna>

          <Columna titulo="Próximas salidas" bajada="Cuánto falta para cada corte de novedades.">
            {d.proximas.length === 0 && <Vacio>No quedan salidas.</Vacio>}
            {d.proximas.map(p => (
              <article key={p.mes} style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', textTransform: 'capitalize' }}>{nombreMes(p.mes)}</span>
                  {p.habiles != null && <span className="num" style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>{p.habiles}</span>}
                </div>
                <div style={{ display: 'flex', fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
                  <span>{p.corte ? `corte ${ddmm(p.corte)}` : '[FALTA: corte de novedades]'}</span>
                  {p.habiles != null && <span style={{ marginLeft: 'auto' }}>días hábiles al corte</span>}
                </div>
                {p.cuentas.map(c => (
                  <div key={c.id} style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{c.nombre}<span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{c.tier || 'sin tier'}</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 3, margin: '6px 0 4px' }}>
                      {ETAPAS.map(e => {
                        const s = c.etapas[e]
                        return <span key={e} title={e} style={{ height: 6, borderRadius: 3, background: s === 'hecha' ? COLOR_ETAPA[e] : s === 'en_curso' ? `linear-gradient(90deg, ${COLOR_ETAPA[e]} 50%, var(--line) 50%)` : 'var(--line)', opacity: s === 'no_tiene' ? 0.35 : 1 }} />
                      })}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t1)', lineHeight: 1.4 }}>{c.texto}{c.sigue ? ` · ${c.sigue.toLowerCase()}` : ''}</div>
                  </div>
                ))}
              </article>
            ))}
          </Columna>

          <Columna titulo="Después" bajada={d.mesesSinSalida.length ? `${(t => t.charAt(0).toUpperCase() + t.slice(1))(d.mesesSinSalida.map(m => nombreMes(m).toLowerCase()).join(' y '))} sin salidas.` : 'Lo que viene después de las próximas salidas.'}>
            {d.despues.length === 0 && <Vacio>Nada más.</Vacio>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {d.despues.map(x => (
                <div key={x.nombre} style={{ display: 'grid', gridTemplateColumns: '58px 1fr auto', gap: 10, alignItems: 'baseline', padding: '9px 0', borderTop: '1px solid var(--line-soft)' }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--t2)' }}>{mesCorto(x.mes)}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{x.nombre} <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{x.tier}</span></span>
                  <span className="num" style={{ fontSize: 12, color: 'var(--t2)' }}>{x.arranca ? `arranca ${ddmm(x.arranca)}` : ''}</span>
                </div>
              ))}
            </div>
          </Columna>
        </div>

        <aside style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Columna titulo="El equipo, próximas 8 semanas" bajada="% de la capacidad de cada semana.">
            <div style={{ display: 'grid', gridTemplateColumns: `58px repeat(${d.semanas.length}, minmax(0, 1fr))`, gap: 3, alignItems: 'center' }}>
              <span />
              {d.semanas.map(s => <span key={s} className="num" title={`Semana del ${ddmm(s)}`} style={{ fontSize: 10, fontWeight: 700, color: 'var(--t2)', textAlign: 'center', lineHeight: 1.1 }}>{s.slice(8)}<span style={{ display: 'block', fontWeight: 600 }}>/{s.slice(5, 7)}</span></span>)}
              {d.equipo.map(p => [
                <span key={`${p.alias}-n`} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t1)' }}>{p.alias}</span>,
                ...p.pcts.map((v, i) => {
                  const fondo = v == null ? 'var(--line-soft)' : v > 100 ? 'var(--error-bg)' : v >= 85 ? 'var(--warn-bg)' : v >= 60 ? 'rgba(0,172,212,0.26)' : v >= 30 ? 'rgba(0,172,212,0.13)' : 'var(--line-soft)'
                  const texto = v == null ? 'var(--t3)' : v > 100 ? 'var(--error-tx)' : v >= 85 ? 'var(--warn-tx)' : 'var(--ink)'
                  return <span key={`${p.alias}-${i}`} className="num" style={{ height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 800, background: fondo, color: texto }}>{v ?? '—'}</span>
                }),
              ])}
            </div>
            {d.picoSemanal && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--t1)', lineHeight: 1.45 }}>{d.picoSemanal}</p>}
          </Columna>

          <Columna titulo="Vacaciones que vienen">
            {d.vacaciones.length === 0 && <Vacio>No hay vacaciones cargadas.</Vacio>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
              {d.vacaciones.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 10 }}><span style={{ width: 4, borderRadius: 2, background: 'var(--vacaciones)' }} /><span className="num"><b>{v.alias}</b> {ddmm(v.inicio)} → {ddmm(v.fin)}</span></div>
              ))}
            </div>
          </Columna>

          <section style={{ background: 'var(--white)', border: `2px solid ${d.decidir.rojos.length ? 'var(--error)' : 'var(--celeste)'}`, borderRadius: 14, padding: 18, color: 'var(--ink)' }}>
            <h2 style={{ ...h2, margin: '0 0 8px' }}>Para decidir hoy</h2>
            {d.decidir.rojos.length === 0
              ? <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>Nada en rojo.{d.decidir.mesesEnTope.length ? ` ${(t => t.charAt(0).toUpperCase() + t.slice(1))(d.decidir.mesesEnTope.map(m => nombreMes(m).split(' ')[0].toLowerCase()).join(' y '))} ${d.decidir.mesesEnTope.length !== 1 ? 'van' : 'va'} con el equipo en el tope de cuentas abiertas a la vez.` : ''}</p>
              : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: 6 }}>{d.decidir.rojos.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          </section>
        </aside>
      </div>
    </div>
  )
}

function Columna({ titulo, bajada, children }: { titulo: string; bajada?: string; children: ReactNode }) {
  return (
    <section style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h2 style={h2}>{titulo}</h2>
        {bajada && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--t2)' }}>{bajada}</p>}
      </div>
      {children}
    </section>
  )
}

function Vacio({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, color: 'var(--t2)' }}>{children}</div>
}

const h2: CSSProperties = { margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--celeste-deeper)' }
