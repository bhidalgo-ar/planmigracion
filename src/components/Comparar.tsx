import { useMemo, type CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { compararPlanes } from '../escenario'
import { mesCorto } from '../vistasPrograma'
import { nombreMes } from '../rules'

function fechaLarga(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'
}

/**
 * Vista Comparar (E, 23/10/2026): el escenario contra el plan del que partió. Cuándo termina,
 * cuántos conflictos tiene, qué cuentas cambiaron de mes y cómo queda cada persona mes a mes.
 * Sin escenario no hay nada que comparar: la vista explica cómo empezar uno.
 */
export function Comparar() {
  const { personas, proyectos, asignaciones, config, escenarioBase, iniciarEscenario, descartarEscenario, aplicarEscenario } = useSimuladorStore()
  const { setVista, setPanelEscenario } = useUIStore()
  const c = useMemo(
    () => (escenarioBase ? compararPlanes(escenarioBase, { personas, proyectos, asignaciones, config }) : null),
    [escenarioBase, personas, proyectos, asignaciones, config],
  )

  if (!c) {
    return (
      <div style={{ height: '100%', overflowY: 'auto', background: 'var(--lienzo)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 560, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>No hay un escenario abierto</h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--t2)', lineHeight: 1.5 }}>Un escenario guarda una copia del plan y te deja probar cambios: mover cuentas, subir el tope de cuentas abiertas, darle más horas a alguien o dejarlo llegar al 120 %. Acá ves qué cambió contra el plan de partida, y al final lo aplicás o lo descartás.</p>
          <div>
            <button type="button" onClick={() => { iniciarEscenario(); setPanelEscenario(true); setVista('timeline') }} style={{ ...boton, background: 'var(--ink)', color: 'var(--white)', border: 'none' }}>Probar un escenario</button>
          </div>
        </div>
      </div>
    )
  }

  const mejoraFin = c.fin.antes && c.fin.despues ? (c.fin.despues < c.fin.antes ? 'ok' : c.fin.despues > c.fin.antes ? 'peor' : 'igual') : 'igual'
  const colorFin = mejoraFin === 'ok' ? 'var(--ok-tx)' : mejoraFin === 'peor' ? 'var(--error-tx)' : 'var(--ink)'
  const titular = c.movidas.length === 0 && c.palancas.length === 0
    ? 'Todavía no cambiaste nada.'
    : `${mejoraFin === 'ok' ? 'El programa termina antes' : mejoraFin === 'peor' ? 'El programa termina después' : 'El fin del programa no cambia'}${c.rojos.despues > c.rojos.antes ? ', con más conflictos' : c.rojos.despues < c.rojos.antes ? ', con menos conflictos' : ''}.`
  const kpis: Array<{ t: string; a: string; d: string; color: string; nota?: string }> = [
    { t: 'Última salida', a: c.ultimaSalida.antes ? nombreMes(c.ultimaSalida.antes) : '—', d: c.ultimaSalida.despues ? nombreMes(c.ultimaSalida.despues) : '—', color: colorFin },
    { t: 'Fin del programa', a: fechaLarga(c.fin.antes), d: fechaLarga(c.fin.despues), color: colorFin, nota: 'Último día con una tarea, primera liquidación incluida' },
    { t: 'Conflictos en rojo', a: String(c.rojos.antes), d: String(c.rojos.despues), color: c.rojos.despues > c.rojos.antes ? 'var(--error-tx)' : c.rojos.despues < c.rojos.antes ? 'var(--ok-tx)' : 'var(--ink)', nota: `Avisos ${c.ambares.antes} → ${c.ambares.despues}` },
    { t: 'Cuentas abiertas a la vez, máximo', a: String(c.paralelo.antes), d: String(c.paralelo.despues), color: c.paralelo.despues > c.paralelo.tope ? 'var(--error-tx)' : 'var(--ink)', nota: `Tope ${c.paralelo.tope}` },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--lienzo)' }}>
      <section style={{ padding: '22px 28px 6px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '14px 28px' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div style={eyebrow}>Escenario contra el plan de partida</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 28, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-0.015em', color: 'var(--ink)' }}>{titular}</h1>
          {c.palancas.length > 0 && <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--t2)' }}>Palancas: {c.palancas.join(' · ')}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { setPanelEscenario(true); setVista('timeline') }} style={boton}>Seguir probando</button>
          <button type="button" onClick={() => { if (confirm('¿Descartar el escenario? El plan vuelve a como estaba antes de empezarlo.')) { descartarEscenario(); setPanelEscenario(false) } }} style={boton}>Descartar</button>
          <button type="button" onClick={() => { aplicarEscenario(); setPanelEscenario(false) }} style={{ ...boton, background: 'var(--ink)', color: 'var(--white)', border: 'none' }}>Aplicar al plan</button>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, padding: '18px 28px' }}>
        {kpis.map(k => (
          <div key={k.t} style={tarjeta}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t2)' }}>{k.t}</div>
            <div className="num" style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--t2)', textDecoration: k.a !== k.d ? 'line-through' : 'none' }}>{k.a}</span>
              {k.a !== k.d && <><span style={{ fontSize: 16, color: 'var(--t2)' }}>→</span><span style={{ fontSize: 24, fontWeight: 800, color: k.color }}>{k.d}</span></>}
            </div>
            {k.nota && <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4 }}>{k.nota}</div>}
          </div>
        ))}
      </div>

      <section style={{ ...tarjeta, margin: '0 28px 18px', overflowX: 'auto' }}>
        <h2 style={h2}>Salidas por mes {c.movidas.length > 0 && <span style={{ fontWeight: 600, color: 'var(--t2)' }}>· {c.movidas.length} cuenta{c.movidas.length !== 1 ? 's' : ''} cambia{c.movidas.length !== 1 ? 'n' : ''} de mes</span>}</h2>
        <div style={{ minWidth: 110 + c.meses.length * 72, marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: `110px repeat(${c.meses.length}, minmax(0, 1fr))`, gap: 4, alignItems: 'stretch' }}>
            <span />
            {c.meses.map(m => <span key={m} style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--t2)', textAlign: 'center' }}>{mesCorto(m)}</span>)}
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--t2)', alignSelf: 'center' }}>Plan de partida</span>
            {c.meses.map(m => <Celda key={m} nombres={c.salidas.antes[m] ?? []} resaltar={new Set(c.movidas.filter(x => x.antes === m).map(x => x.nombre))} tono="sale" />)}
            <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', alignSelf: 'center' }}>Escenario</span>
            {c.meses.map(m => <Celda key={m} nombres={c.salidas.despues[m] ?? []} resaltar={new Set(c.movidas.filter(x => x.despues === m).map(x => x.nombre))} tono="entra" />)}
          </div>
        </div>
      </section>

      <section style={{ ...tarjeta, margin: '0 28px 28px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '8px 20px', marginBottom: 14 }}>
          <h2 style={h2}>El equipo mes a mes, % de su capacidad</h2>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)' }}><span style={{ width: 14, height: 10, borderRadius: 2, background: 'var(--viz-meta4)' }} />plan de partida</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--t2)' }}><span style={{ width: 14, height: 10, borderRadius: 2, background: 'var(--celeste-dark)' }} />escenario</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {c.equipo.map(p => {
            const cambios = p.meses.filter(m => m.antes !== m.despues)
            return (
              <div key={p.id} style={{ overflowX: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>{p.alias}</span>
                  <span className="num" style={{ fontSize: 12.5, color: 'var(--t1)' }}>
                    pico {p.pico.antes ? `${p.pico.antes.pct} % (${mesCorto(p.pico.antes.mes)})` : '—'} → <b style={{ color: (p.pico.despues?.pct ?? 0) > 100 ? 'var(--error-tx)' : 'var(--ink)' }}>{p.pico.despues ? `${p.pico.despues.pct} % (${mesCorto(p.pico.despues.mes)})` : '—'}</b>
                    {cambios.length === 0 ? ' · sin cambios' : ''}
                  </span>
                </div>
                <div style={{ minWidth: p.meses.length * 40 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p.meses.length}, minmax(0, 1fr))`, gap: 6, alignItems: 'end', height: 100, marginTop: 10, borderBottom: '1px solid var(--line)' }}>
                    {p.meses.map(m => (
                      <div key={m.mes} title={`${nombreMes(m.mes)}: ${m.antes ?? 0} % → ${m.despues ?? 0} %`} style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: '100%' }}>
                        <span style={{ flex: 1, height: `${Math.min(100, m.antes ?? 0)}%`, background: 'var(--viz-meta4)', borderRadius: '3px 3px 0 0' }} />
                        <span style={{ flex: 1, height: `${Math.min(100, m.despues ?? 0)}%`, background: (m.despues ?? 0) > 100 ? 'var(--error)' : 'var(--celeste-dark)', borderRadius: '3px 3px 0 0' }} />
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p.meses.length}, minmax(0, 1fr))`, gap: 6, marginTop: 5 }}>
                    {p.meses.map(m => <span key={m.mes} className="num" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t2)', textAlign: 'center', lineHeight: 1.25 }}>{mesCorto(m.mes)}<span style={{ display: 'block', color: m.antes !== m.despues ? 'var(--ink)' : 'var(--t2)' }}>{m.antes === m.despues ? (m.antes ?? 0) : `${m.antes ?? 0}→${m.despues ?? 0}`}</span></span>)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Celda({ nombres, resaltar, tono }: { nombres: string[]; resaltar: Set<string>; tono: 'sale' | 'entra' }) {
  const hay = nombres.some(n => resaltar.has(n))
  const estilo: CSSProperties = hay
    ? tono === 'sale' ? { background: 'var(--error-bg)', color: 'var(--error-tx)', border: '1.5px solid var(--error-bd)' } : { background: 'var(--celeste-dim)', color: 'var(--celeste-deeper)', border: '1.5px solid var(--celeste)' }
    : nombres.length ? { background: 'var(--white)', color: 'var(--ink)', border: '1.5px solid var(--line)' } : { background: 'var(--paper)', color: 'var(--t3)', border: '1.5px solid var(--line-soft)' }
  return (
    <span style={{ minHeight: 40, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700, lineHeight: 1.2, textAlign: 'center', padding: 3, ...estilo }}>
      {nombres.length ? nombres.map(n => <span key={n} style={{ textDecoration: tono === 'sale' && resaltar.has(n) ? 'line-through' : 'none' }}>{n}</span>) : '—'}
    </span>
  )
}

const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--celeste-deeper)' }
const h2: CSSProperties = { margin: 0, fontSize: 13.5, fontWeight: 800, color: 'var(--ink)' }
const tarjeta: CSSProperties = { background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px 18px' }
const boton: CSSProperties = { font: 'inherit', padding: '11px 18px', borderRadius: 9999, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--t1)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }
