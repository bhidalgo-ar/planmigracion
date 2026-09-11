import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSimuladorStore } from '../store'
import { ticketsMeta4Piso } from '../capacidad'
import { nombreMes } from '../rules'
import {
  bloquear, desbloquear, estaDesbloqueado, filasReparto, lecturaTransicion, soporteMesAMes, verificarContrasena,
  FRENTES, FRENTE_LABEL, type Frente, type MesSoporte,
} from '../confidencial'
import { Card, Leyenda, Vacio } from './Insights'

const COLOR_FRENTE: Record<Frente, string> = {
  meta4_soporte: 'var(--gris)',
  axton_soporte: 'var(--viz-axton)',
  migracion: 'var(--viz-config)',
  toyota: 'var(--viz-relev)',
  otros: 'var(--t3)',
}

/** 'Sep 26' a partir de '2026-09'. */
function mesCorto(mes: string): string {
  const n = nombreMes(mes)
  return `${n.slice(0, 3)} ${mes.slice(2, 4)}`
}

/**
 * Pestaña "Disponibilidad del equipo". Solo se monta si el plan trae `equipo_confidencial`
 * (App.tsx). Si la sesión no está desbloqueada muestra el formulario de contraseña; el
 * desbloqueo vive en sessionStorage y se pierde al cerrar la pestaña del navegador.
 */
export function Confidencial() {
  const { personas, asignaciones, config } = useSimuladorStore()
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

  return <VistaConfidencial personas={personas} asignaciones={asignaciones} config={config} onCerrar={cerrar} />
}

type Estado = ReturnType<typeof useSimuladorStore.getState>

function VistaConfidencial({ personas, asignaciones, config, onCerrar }: {
  personas: Estado['personas']; asignaciones: Estado['asignaciones']; config: Estado['config']; onCerrar: () => void
}) {
  const filas = useMemo(() => filasReparto(config, personas), [config, personas])
  const lectura = useMemo(() => lecturaTransicion(config, personas), [config, personas])
  const soporte = useMemo(() => soporteMesAMes(config, personas, asignaciones), [config, personas, asignaciones])
  const meses = filas[0]?.meses.map(m => m.mes) ?? []
  const desde = lectura?.desde ?? null
  const idxTransicion = desde ? meses.indexOf(desde) : -1
  const H = 72
  const hayTickets = soporte.some(s => s.ticketsMeta4 !== null)
  const susi = config.capacidad?.susi_soporte_meta4
  const noMigran = Object.keys(config.soporte_tickets?.meta4_no_migra ?? {})
  const piso = ticketsMeta4Piso(config)

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
        <Card titulo="Cómo se reparte el día de cada persona, mes a mes"
          subtitulo="Cada barra es un mes: lo gris es soporte Meta 4, lo verde soporte Axton, lo celeste lo que queda para migración. La línea punteada es la transición de Susana. Susi y Moni se calculan (tickets y cuentas en Axton); el resto es lo cargado en el bloque, y lo que no está dice [FALTA].">
          <Leyenda series={FRENTES.map(f => ({ key: f, label: FRENTE_LABEL[f], color: COLOR_FRENTE[f] }))} />
          {filas.length === 0 ? <Vacio>El bloque confidencial no trae dedicaciones por mes.</Vacio> : (
            <div style={{ display: 'grid', gridTemplateColumns: `92px repeat(${meses.length}, minmax(0, 1fr))`, columnGap: 4, rowGap: 12, alignItems: 'end', position: 'relative' }}>
              <span />
              {meses.map(m => (
                <span key={m} className="num" style={{ fontSize: 10, fontWeight: 700, color: m === desde ? 'var(--error-tx)' : 'var(--t3)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {mesCorto(m)}
                </span>
              ))}
              {filas.map(f => (
                <Fila key={f.personaId} f={f} H={H} idxTransicion={idxTransicion} />
              ))}
            </div>
          )}
        </Card>

        <Card titulo="Qué libera Meta 4 y qué carga Axton"
          subtitulo="Los tickets por mes son la vara: cada cuenta que sale se lleva sus tickets de Meta 4 y los trae a Axton. Susi gana día para migración a medida que Meta 4 se vacía; Moni lo pierde a medida que Axton se llena. Cuentas: las del programa (con POF y Finadiet) en Meta 4; las que ya tienen tickets Axton hoy más las que entran.">
          {!hayTickets ? (
            <div style={{ fontSize: 12, color: 'var(--warn-tx)', lineHeight: 1.5 }}>
              <strong>[FALTA]</strong> la ticketera en el plan (<code style={{ fontSize: 11 }}>config.soporte_tickets</code>): tickets del año por cuenta y herramienta, leídos de la Ticketera Soporte de monday. Sin eso no se estima nada.
            </div>
          ) : soporte.length === 0 ? <Vacio>Sin meses de programa.</Vacio> : (
            <div style={{ display: 'flex', gap: 28, marginTop: 6 }}>
              <PanelSoporte
                titulo="Soporte Meta 4 que se libera → Susi"
                sub={susi
                  ? `Desde ${mesCorto(susi.desde)} Susi toma todo el soporte Meta 4: los ~${Math.round(susi.base_tickets_mes)} tickets por mes de hoy son el 100 % de su día. Cada ticket que se va le libera día para configurar.${noMigran.length ? ` ${noMigran.join(' y ')} no migran: esos ~${Math.round(piso ?? 0)} tickets por mes se quedan con ella para siempre y son su techo.` : ''}`
                  : 'La disponibilidad de Susi sigue la perilla por año del plan: no hay bloque susi_soporte_meta4.'}
                meses={soporte} tickets={s => s.ticketsMeta4} cuentas={s => s.cuentasMeta4} disp={s => s.dispSusi}
                colorBarra="var(--gris)" colorLinea="var(--celeste-dark)" etiquetaLinea="Susi para migración" />
              <PanelSoporte
                titulo="Soporte Axton que crece → Moni"
                sub={config.capacidad?.moni_soporte_axton
                  ? `Moni arranca con ${Math.round(config.capacidad.moni_soporte_axton.base * 100)} % del día para migración y pierde ${Math.round(config.capacidad.moni_soporte_axton.caida_por_cuenta * 100)} puntos por cada cuenta que entra a Axton sobre ${config.capacidad.moni_soporte_axton.cuentas_base}, con piso ${Math.round(config.capacidad.moni_soporte_axton.piso * 100)} %. Los tickets muestran qué hay detrás de cada cuenta.`
                  : 'La disponibilidad de Moni sigue la perilla por año del plan.'}
                meses={soporte} tickets={s => s.ticketsAxton} cuentas={s => s.cuentasAxton} disp={s => s.dispMoni}
                colorBarra="var(--viz-axton)" colorLinea="var(--error-tx)" etiquetaLinea="Moni para migración" />
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

function Fila({ f, H, idxTransicion }: { f: ReturnType<typeof filasReparto>[number]; H: number; idxTransicion: number }) {
  // Arriba de cada barra va el número de migración; se reserva ese alto para que no pise la barra.
  const ALTO_BARRA = H - 16
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignSelf: 'center' }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)' }}>{f.alias}</span>
        <span className="num" style={{ fontSize: 10, color: 'var(--t3)' }}>{f.horasDia} h/día{f.calculada ? ' · calculada' : ''}</span>
      </div>
      {f.meses.map((m, i) => {
        const total = FRENTES.reduce((s, k) => s + (m.frentes[k] ?? 0), 0)
        const migracion = m.frentes.migracion
        return (
          <div key={m.mes} style={{ position: 'relative', height: H, borderLeft: i === idxTransicion ? '2px dashed var(--error)' : undefined, marginLeft: i === idxTransicion ? -1 : 0 }}
            title={m.vacio ? `${f.alias} · ${nombreMes(m.mes)}: sin datos` : FRENTES.filter(k => m.frentes[k] != null).map(k => `${FRENTE_LABEL[k]} ${Math.round((m.frentes[k] ?? 0) * 100)} %`).join(' · ') + (m.faltas.length ? ` · [FALTA] ${m.faltas.join(', ')}` : '')}>
            {m.vacio ? (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <span style={{ fontSize: 9, color: 'var(--t3)', paddingBottom: 2 }}>—</span>
              </div>
            ) : (
              <div style={{ position: 'absolute', left: '12%', right: '12%', bottom: 0, height: Math.round(Math.min(1, total) * ALTO_BARRA), display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden', background: total === 0 ? 'transparent' : undefined }}>
                {FRENTES.map(k => (m.frentes[k] ?? 0) > 0 && (
                  <div key={k} style={{ flex: (m.frentes[k] ?? 0) / Math.max(total, 0.0001), background: COLOR_FRENTE[k] }} />
                ))}
              </div>
            )}
            {m.conFaltas && (
              <span title={`[FALTA] ${m.faltas.join(', ')}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center', fontSize: 9, fontWeight: 800, color: 'var(--warn-tx)' }}>[FALTA]</span>
            )}
            {!m.vacio && total > 0 && !m.conFaltas && (
              <span className="num" style={{ position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center', fontSize: 9.5, fontWeight: migracion != null ? 700 : 400, color: migracion != null ? 'var(--celeste-deeper)' : 'var(--t3)' }}>
                {Math.round((migracion ?? total) * 100)} %
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Un panel de "qué libera / qué carga": barras de tickets por mes con las cuentas debajo, y
 * la disponibilidad para migración como línea con puntos encima.
 */
function PanelSoporte({ titulo, sub, meses, tickets, cuentas, disp, colorBarra, colorLinea, etiquetaLinea }: {
  titulo: string; sub: string; meses: MesSoporte[]
  tickets: (s: MesSoporte) => number | null; cuentas: (s: MesSoporte) => number; disp: (s: MesSoporte) => number
  colorBarra: string; colorLinea: string; etiquetaLinea: string
}) {
  const HP = 140, TOP = 22, PIE = 40
  const n = meses.length
  const maxTk = Math.max(1, ...meses.map(s => tickets(s) ?? 0))
  const puntos = meses.map((s, i) => ({ x: ((i + 0.5) / n) * 100, y: 100 - disp(s) * 100, d: disp(s) }))
  const poly = puntos.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{titulo}</div>
      <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 8 }}>{sub}</div>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
          {meses.map(s => {
            const tk = tickets(s)
            const hb = tk === null ? 0 : Math.round((tk / maxTk) * HP)
            return (
              <div key={s.mes} style={{ flex: 1, minWidth: 0, position: 'relative', height: TOP + HP + PIE }}>
                <div style={{ position: 'absolute', left: '20%', right: '20%', bottom: PIE, height: hb, background: colorBarra, borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
                <div className="num" style={{ position: 'absolute', left: 0, right: 0, bottom: PIE + hb + 3, textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--t2)' }}>{tk === null ? '[FALTA]' : Math.round(tk)}</div>
                <div className="num" style={{ position: 'absolute', left: 0, right: 0, bottom: 20, textAlign: 'center', fontSize: 10.5, fontWeight: 800, color: 'var(--ink)' }}>{cuentas(s)} ctas</div>
                <div className="num" style={{ position: 'absolute', left: 0, right: 0, bottom: 2, textAlign: 'center', fontSize: 10, color: 'var(--t3)' }}>{mesCorto(s.mes)}</div>
              </div>
            )
          })}
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: TOP, height: HP, width: '100%', overflow: 'visible', pointerEvents: 'none' }}>
          <polyline points={poly} fill="none" stroke={colorLinea} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {puntos.map((p, i) => {
          const top = TOP + Math.round((1 - p.d) * HP)
          return (
            <div key={meses[i].mes} style={{ position: 'absolute', left: `${p.x}%`, top: 0, pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', left: -4, top: top - 4, width: 8, height: 8, borderRadius: '50%', background: colorLinea, border: '1.5px solid var(--white)', boxShadow: `0 0 0 1px ${colorLinea}` }} />
              <div className="num" style={{ position: 'absolute', left: -16, width: 32, top: top - 20, textAlign: 'center', fontSize: 10, fontWeight: 800, color: colorLinea }}>{Math.round(p.d * 100)}</div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11, color: 'var(--t2)' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: colorBarra, marginRight: 5, verticalAlign: -1 }} />Tickets por mes (barra)</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: colorLinea, marginRight: 5, verticalAlign: -1 }} />{etiquetaLinea} (línea, % del día)</span>
      </div>
    </div>
  )
}
