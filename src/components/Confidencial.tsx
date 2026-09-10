import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSimuladorStore } from '../store'
import { nombreMes } from '../rules'
import {
  bloquear, desbloquear, estaDesbloqueado, filasConfidencial, lecturaTransicion, verificarContrasena,
  FRENTES, FRENTE_LABEL, type Frente,
} from '../confidencial'
import { Card, Leyenda, Vacio } from './Insights'

const COLOR_FRENTE: Record<Frente, string> = {
  meta4_soporte: 'var(--gris)',
  axton_soporte: 'var(--viz-axton)',
  migracion: 'var(--viz-config)',
  toyota: 'var(--viz-relev)',
  otros: 'var(--t3)',
}

/**
 * Pestaña "Disponibilidad del equipo". Solo se monta si el plan trae `equipo_confidencial`
 * (App.tsx). Si la sesión no está desbloqueada muestra el formulario de contraseña; el
 * desbloqueo vive en sessionStorage y se pierde al cerrar la pestaña del navegador.
 */
export function Confidencial() {
  const { personas, config } = useSimuladorStore()
  const [abierto, setAbierto] = useState(estaDesbloqueado())
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verificando, setVerificando] = useState(false)

  // Si otra pestaña del mismo sitio bloquea/desbloquea, esta no se entera: el estado es
  // por pestaña del navegador a propósito.
  useEffect(() => { setAbierto(estaDesbloqueado()) }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setVerificando(true)
    const ok = await verificarContrasena(clave)
    setVerificando(false)
    if (ok) { desbloquear(); setAbierto(true); setClave(''); setError(null) }
    else setError('La contraseña no coincide.')
  }

  function cerrar() {
    bloquear()
    setAbierto(false)
  }

  if (!abierto) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--lienzo)', padding: 24 }}>
        <form onSubmit={onSubmit} style={{ background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 14, padding: 24, boxShadow: 'var(--sh)', width: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 28, textAlign: 'center' }}>🔒</div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--ink)', textAlign: 'center' }}>Disponibilidad del equipo</h3>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, textAlign: 'center' }}>
            Datos confidenciales del equipo de payroll. El desbloqueo dura hasta que recargués o cerrés esta pestaña del navegador.
          </p>
          <input type="password" value={clave} onChange={e => setClave(e.target.value)} placeholder="Contraseña" autoFocus
            style={{ padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${error ? 'var(--error)' : 'var(--line)'}`, fontSize: 14, background: 'var(--paper)', color: 'var(--ink)' }} />
          {error && <span style={{ fontSize: 11.5, color: 'var(--error-tx)' }}>{error}</span>}
          <button type="submit" disabled={verificando || !clave}
            style={{ padding: '9px 14px', borderRadius: 9999, border: 'none', background: 'var(--celeste)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: verificando || !clave ? 0.6 : 1 }}>
            {verificando ? 'Verificando…' : 'Desbloquear'}
          </button>
        </form>
      </div>
    )
  }

  return <VistaConfidencial personas={personas} config={config} onCerrar={cerrar} />
}

function VistaConfidencial({ personas, config, onCerrar }: {
  personas: ReturnType<typeof useSimuladorStore.getState>['personas']
  config: ReturnType<typeof useSimuladorStore.getState>['config']
  onCerrar: () => void
}) {
  const filas = useMemo(() => filasConfidencial(config, personas), [config, personas])
  const lectura = useMemo(() => lecturaTransicion(config, personas), [config, personas])
  const meses = filas[0]?.meses.map(m => m.mes) ?? []
  const desde = lectura?.desde ?? null
  const idxTransicion = desde ? meses.indexOf(desde) : -1
  const H = 64

  return (
    <div style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', background: 'var(--lienzo)' }}>
      {/* Aviso fijo arriba de la vista */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--error)', color: '#fff', padding: '7px 24px', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
        🔒 Datos confidenciales, no compartir pantalla.
        <span style={{ fontWeight: 400, opacity: 0.9 }}>Solo viven en el JSON local; no están en el repo ni en el deploy.</span>
        <button onClick={onCerrar} style={{ marginLeft: 'auto', border: '1px solid rgba(255,255,255,0.6)', background: 'transparent', color: '#fff', borderRadius: 9999, padding: '3px 12px', fontSize: 11.5, cursor: 'pointer', fontWeight: 600 }}>
          Bloquear
        </button>
      </div>

      <div style={{ padding: 24, maxWidth: 1232, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card titulo="Disponibilidad del equipo por frente"
          subtitulo="Cada barra es un mes: la fracción de la jornada que cada persona dedica a cada frente. La línea marca la transición de Susana. Lo que no está cargado dice [FALTA].">
          <Leyenda series={FRENTES.map(f => ({ key: f, label: FRENTE_LABEL[f], color: COLOR_FRENTE[f] }))} />
          {filas.length === 0 ? <Vacio>El bloque confidencial no trae dedicaciones por mes.</Vacio> : (
            <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(${meses.length}, minmax(0, 1fr))`, columnGap: 4, rowGap: 10, alignItems: 'end', position: 'relative' }}>
              <span />
              {meses.map(m => (
                <span key={m} className="num" style={{ fontSize: 10, fontWeight: 700, color: m === desde ? 'var(--error-tx)' : 'var(--t3)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {nombreMes(m).slice(0, 3)} {m.slice(2, 4)}
                </span>
              ))}
              {filas.map(f => (
                <Fila key={f.personaId} f={f} H={H} idxTransicion={idxTransicion} />
              ))}
            </div>
          )}
        </Card>

        <Card titulo="Transición de Susana" subtitulo="Susana absorbe el soporte Meta4 a medida que bajan las cuentas; Leo y Lucas quedan libres.">
          {lectura ? (
            <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.5 }}>
              {lectura.texto.split(/(\[FALTA[^\]]*\])/).map((t, i) => t.startsWith('[FALTA') ? <strong key={i} style={{ color: 'var(--warn-tx)' }}>{t}</strong> : <span key={i}>{t}</span>)}
            </div>
          ) : <Vacio>El bloque no trae `transicion_susana`.</Vacio>}
          {config.equipo_confidencial?.transicion_susana?._nota && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--t2)', fontStyle: 'italic' }}>{config.equipo_confidencial.transicion_susana._nota}</div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Fila({ f, H, idxTransicion }: { f: ReturnType<typeof filasConfidencial>[number]; H: number; idxTransicion: number }) {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignSelf: 'center' }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)' }}>{f.alias}</span>
        <span className="num" style={{ fontSize: 10, color: 'var(--t3)' }}>{f.horasDia} h/día</span>
      </div>
      {f.meses.map((m, i) => {
        const total = FRENTES.reduce((s, k) => s + (m.frentes[k] ?? 0), 0)
        return (
          <div key={m.mes} style={{ position: 'relative', height: H, borderLeft: i === idxTransicion ? '2px dashed var(--error)' : undefined, marginLeft: i === idxTransicion ? -1 : 0 }}
            title={m.vacio ? `${f.alias} · ${nombreMes(m.mes)}: sin datos` : FRENTES.filter(k => m.frentes[k] != null).map(k => `${FRENTE_LABEL[k]} ${Math.round((m.frentes[k] ?? 0) * 100)} %`).join(' · ') + (m.faltas.length ? ` · [FALTA] ${m.faltas.join(', ')}` : '')}>
            {m.vacio ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <span style={{ fontSize: 9, color: 'var(--t3)', paddingBottom: 2 }}>—</span>
              </div>
            ) : (
              <div style={{ position: 'absolute', left: '12%', right: '12%', bottom: 0, height: `${Math.min(1, total) * 100}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden', background: total === 0 ? 'transparent' : undefined }}>
                {FRENTES.map(k => (m.frentes[k] ?? 0) > 0 && (
                  <div key={k} style={{ flex: (m.frentes[k] ?? 0) / Math.max(total, 0.0001), background: COLOR_FRENTE[k] }} />
                ))}
              </div>
            )}
            {m.conFaltas && (
              <span title={`[FALTA] ${m.faltas.join(', ')}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center', fontSize: 9, fontWeight: 800, color: 'var(--warn-tx)' }}>[FALTA]</span>
            )}
            {!m.vacio && total > 0 && !m.conFaltas && (
              <span className="num" style={{ position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: 'var(--t3)' }}>{Math.round(total * 100)} %</span>
            )}
          </div>
        )
      })}
    </>
  )
}
