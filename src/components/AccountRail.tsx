import { useMemo, type CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { tierDe, TIER_LABEL } from '../insightsEquipo'
import { useUIStore } from '../uiStore'
import { formatFechaCorta } from '../utils/dates'

export function AccountRail() {
  const { proyectos, asignaciones, violaciones, clienteSeleccionado, seleccionarCliente, removeProyecto, config } = useSimuladorStore()
  const { abrirModal, sortCuentas, toggleSortCuentas } = useUIStore()

  function handleRemove(id: string, nombre: string) {
    const fases = asignaciones.filter(a => a.proyecto_id === id).length
    const detalle = fases ? ` y sus ${fases} fase${fases !== 1 ? 's' : ''}` : ''
    if (confirm(`¿Eliminar la cuenta "${nombre}"${detalle}? Esta acción no se puede deshacer.`)) removeProyecto(id)
  }

  // violaciones por asignación → color por cuenta
  const colorPorProyecto = useMemo(() => {
    const sevPorAsig = new Map<string, 'rojo' | 'ambar'>()
    for (const v of violaciones) {
      if (v.severidad === 'info') continue
      const prev = sevPorAsig.get(v.asignacion_id)
      if (v.severidad === 'rojo' || prev !== 'rojo') sevPorAsig.set(v.asignacion_id, v.severidad)
    }
    const m = new Map<string, 'verde' | 'ambar' | 'rojo'>()
    for (const p of proyectos) {
      const sevs = asignaciones.filter(a => a.proyecto_id === p.id).map(a => sevPorAsig.get(a.id))
      m.set(p.id, sevs.includes('rojo') ? 'rojo' : sevs.includes('ambar') ? 'ambar' : 'verde')
    }
    return m
  }, [proyectos, asignaciones, violaciones])

  const cuentas = useMemo(() => {
    return proyectos
      .map(p => {
        const fases = asignaciones.filter(a => a.proyecto_id === p.id && !a.es_bloqueo)
        const primeraFase = fases.reduce<string | null>((min, a) => (!min || a.inicio < min ? a.inicio : min), null)
        return { proyecto: p, primeraFase }
      })
      .sort((a, b) => {
        if (sortCuentas === 'nombre') {
          return a.proyecto.nombre.localeCompare(b.proyecto.nombre, 'es')
        }
        // 'fecha'
        if (!a.primeraFase && !b.primeraFase) return 0
        if (!a.primeraFase) return 1
        if (!b.primeraFase) return -1
        return a.primeraFase < b.primeraFase ? -1 : 1
      })
  }, [proyectos, asignaciones, sortCuentas])

  return (
    <div style={{ width: 218, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Cabecera con acciones */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', background: 'var(--white)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--t2)' }}>{cuentas.length} cuentas</span>
          <button onClick={toggleSortCuentas} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--t3)', padding: '0 2px' }}
            title={sortCuentas === 'fecha' ? 'Ordenado por fecha de inicio (clic para A-Z)' : 'Ordenado A-Z (clic para fecha)'}>
            {sortCuentas === 'fecha' ? '📅 Fecha' : 'A-Z'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => abrirModal('equipo')} style={railBtn} title="Gestionar equipo">👥 Equipo</button>
          <button onClick={() => abrirModal('cuenta')} style={{ ...railBtn, background: 'var(--celeste)', color: '#fff', border: 'none' }} title="Agregar cuenta">+ Cuenta</button>
        </div>
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {cuentas.map(({ proyecto, primeraFase }) => {
          const color = colorPorProyecto.get(proyecto.id) ?? 'verde'
          const activo = proyecto.id === clienteSeleccionado
          return (
            <div
              key={proyecto.id}
              className="cuenta-fila"
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 12px',
                background: activo ? 'var(--celeste-dim)' : 'transparent',
                borderLeft: activo ? '3px solid var(--celeste)' : '3px solid transparent',
                transition: 'background 0.12s',
              }}
            >
              <button
                onClick={() => seleccionarCliente(proyecto.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1, minWidth: 0, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', padding: 0 }}
              >
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                  background: color === 'verde' ? 'var(--ok)' : color === 'ambar' ? 'var(--warn)' : 'var(--error)' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: activo ? 700 : 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {proyecto.nombre}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>
                    {primeraFase ? `desde ${formatFechaCorta(primeraFase)}` : 'sin planificar'}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {proyecto.especial && <span style={badge('var(--tasa)')}>TASA</span>}
                  {(() => { const t = tierDe(proyecto.id, config); return t ? <span style={badge(t === 'grande' ? 'var(--fase-relev)' : t === 'chica' ? 'var(--ok)' : 'var(--celeste-dark)')} title={`Tier ${TIER_LABEL[t]}`}>{t === 'std' ? 'std' : t === 'chica' ? 'chica' : 'grande'}</span> : null })()}
                  {proyecto.quick_win && <span style={badge('var(--ok)')}>QW</span>}
                  {proyecto.entidades > 1 && <span style={badge('var(--celeste)')}>×{proyecto.entidades}</span>}
                </span>
              </button>
              <button
                onClick={() => handleRemove(proyecto.id, proyecto.nombre)}
                className="cuenta-borrar"
                title="Eliminar cuenta"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 17, lineHeight: 1, flexShrink: 0, padding: '0 2px' }}
              >×</button>
            </div>
          )
        })}
      </div>

      {/* Nota de privacidad (regla dura) */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)', fontSize: 9.5, color: 'var(--t3)', lineHeight: 1.4 }}>
        Solo alias y nombres comerciales. Sin datos personales.
      </div>
    </div>
  )
}

const railBtn: CSSProperties = {
  flex: 1, padding: '6px 8px', border: '1.5px solid var(--line)', borderRadius: 9999,
  background: 'var(--white)', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--t1)',
}

function badge(bg: string): CSSProperties {
  return { fontSize: 9.5, background: bg, color: '#fff', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }
}
