import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { aplicarOrdenYFiltro, useUIStore } from '../uiStore'

/**
 * Menú "Personas": elige qué filas se ven en el timeline y en qué orden.
 * El orden y el filtro son de la vista: no tocan el plan ni las asignaciones.
 */
export function MenuPersonas() {
  const personas = useSimuladorStore(s => s.personas)
  const {
    ordenPersonas, personasOcultas,
    setOrdenPersonas, moverPersona, togglePersonaOculta, mostrarTodasLasPersonas, resetOrdenPersonas,
  } = useUIStore()

  const [abierto, setAbierto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [abierto])

  // Lista del menú: mismo orden que el timeline, pero incluyendo las ocultas
  // (con el check apagado) para poder volver a mostrarlas.
  const lista = aplicarOrdenYFiltro(personas, ordenPersonas, [])
  const visibles = lista.filter(p => !personasOcultas.includes(p.id))
  const idsVisibles = visibles.map(p => p.id)
  const filtrando = personasOcultas.length > 0

  function ordenarAlfabetico() {
    setOrdenPersonas(
      personas.slice().sort((a, b) => a.alias.localeCompare(b.alias, 'es')).map(p => p.id),
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setAbierto(v => !v)}
        style={{ ...pillBtn, ...(abierto || filtrando ? activePill : {}) }}
        title="Elegir qué personas se ven en el timeline y en qué orden">
        👥 Personas {filtrando ? `${visibles.length}/${personas.length}` : ''}
      </button>

      {abierto && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100, width: 270,
          background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--sh)',
          padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={ordenarAlfabetico} style={miniBtn} title="Ordenar las filas de A a Z por alias">A-Z</button>
            <button onClick={resetOrdenPersonas} style={miniBtn} title="Volver al orden original del equipo">Orden original</button>
            <button onClick={mostrarTodasLasPersonas} disabled={!filtrando}
              style={{ ...miniBtn, opacity: filtrando ? 1 : 0.45, cursor: filtrando ? 'pointer' : 'default' }}
              title="Mostrar todas las personas">Ver todas</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 300, overflowY: 'auto' }}>
            {lista.map(p => {
              const oculta = personasOcultas.includes(p.id)
              const iVis = idsVisibles.indexOf(p.id)
              const ultimaVisible = !oculta && visibles.length === 1
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 4px 6px',
                  borderRadius: 8, opacity: oculta ? 0.5 : 1,
                }}>
                  <input type="checkbox" checked={!oculta} disabled={ultimaVisible}
                    onChange={() => togglePersonaOculta(p.id)}
                    title={ultimaVisible ? 'Tiene que quedar al menos una persona visible' : oculta ? 'Mostrar en el timeline' : 'Ocultar del timeline'}
                    style={{ cursor: ultimaVisible ? 'default' : 'pointer', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.alias}
                  </span>
                  <button onClick={() => moverPersona(idsVisibles, p.id, -1)}
                    disabled={oculta || iVis <= 0}
                    style={{ ...flechaBtn, opacity: (oculta || iVis <= 0) ? 0.3 : 1 }}
                    title="Subir una fila">↑</button>
                  <button onClick={() => moverPersona(idsVisibles, p.id, 1)}
                    disabled={oculta || iVis < 0 || iVis >= idsVisibles.length - 1}
                    style={{ ...flechaBtn, opacity: (oculta || iVis < 0 || iVis >= idsVisibles.length - 1) ? 0.3 : 1 }}
                    title="Bajar una fila">↓</button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

const pillBtn: CSSProperties = {
  padding: '4px 11px', borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--line)', borderRadius: 9999, background: 'var(--white)',
  cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--t2)',
}
const activePill: CSSProperties = { background: 'var(--celeste)', color: '#fff', borderColor: 'var(--celeste)' }
const miniBtn: CSSProperties = {
  flex: 1, padding: '4px 6px', border: '1.5px solid var(--line)', borderRadius: 8, background: 'var(--white)',
  cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap',
}
const flechaBtn: CSSProperties = {
  width: 22, height: 22, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--white)',
  cursor: 'pointer', fontSize: 11, fontWeight: 700, color: 'var(--t2)', lineHeight: 1, padding: 0, flexShrink: 0,
}
