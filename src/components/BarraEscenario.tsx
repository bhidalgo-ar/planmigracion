import { useMemo } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { describirPalancas } from '../escenario'
import { mesSalidaDe } from '../capacidad'

/**
 * Franja del escenario (23/10/2026): mientras hay un escenario abierto, en todas las vistas se
 * ve que lo que se mira no es el plan sino una prueba, qué se cambió y cómo cerrarla.
 */
export function BarraEscenario() {
  const { personas, proyectos, asignaciones, config, escenarioBase, descartarEscenario, aplicarEscenario } = useSimuladorStore()
  const { vista, setVista, setPanelEscenario } = useUIStore()
  const resumen = useMemo(() => {
    if (!escenarioBase) return ''
    const movidas = proyectos.filter(p => mesSalidaDe(p.id, escenarioBase.config) !== mesSalidaDe(p.id, config)).length
    const partes = describirPalancas(escenarioBase, { personas, proyectos, asignaciones, config })
    if (movidas) partes.unshift(`${movidas} cuenta${movidas !== 1 ? 's' : ''} cambia${movidas !== 1 ? 'n' : ''} de mes`)
    return partes.length ? partes.join(' · ') : 'todavía sin cambios'
  }, [escenarioBase, personas, proyectos, asignaciones, config])
  if (!escenarioBase) return null
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', padding: '6px 14px', background: 'var(--warn-bg)', borderBottom: '1px solid var(--warn-bd)', flexShrink: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--warn-tx)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Escenario</span>
      <span style={{ fontSize: 12.5, color: 'var(--t1)', minWidth: 0 }}>Estás mirando una prueba, no el plan: {resumen}.</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {vista !== 'timeline' && <button type="button" onClick={() => { setPanelEscenario(true); setVista('timeline') }} style={boton}>Palancas</button>}
        {vista !== 'comparar' && <button type="button" onClick={() => setVista('comparar')} style={boton}>Comparar</button>}
        <button type="button" onClick={() => { if (confirm('¿Descartar el escenario? El plan vuelve a como estaba antes de empezarlo.')) { descartarEscenario(); setPanelEscenario(false) } }} style={boton}>Descartar</button>
        <button type="button" onClick={() => { aplicarEscenario(); setPanelEscenario(false) }} style={{ ...boton, background: 'var(--ink)', color: 'var(--white)', borderColor: 'var(--ink)' }}>Aplicar al plan</button>
      </div>
    </div>
  )
}

const boton = { font: 'inherit', padding: '4px 11px', borderRadius: 9999, border: '1px solid var(--warn-bd)', background: 'var(--white)', color: 'var(--t1)', fontSize: 12, fontWeight: 700, cursor: 'pointer' } as const
