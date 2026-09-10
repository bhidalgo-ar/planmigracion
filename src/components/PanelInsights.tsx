import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import { resumenPlan } from '../insights'
import { formatFecha } from '../utils/dates'
import { TIPO_LABEL } from '../theme/fases'

/**
 * Franja inferior del timeline: lectura rápida del plan tal como está cargado.
 * Responde dos preguntas concretas: ¿cuándo termina el proceso con esta
 * configuración? y ¿qué falta cargar para que esa fecha sea creíble?
 */
export function PanelInsights() {
  const { proyectos, asignaciones, personas, violaciones, seleccionarCliente } = useSimuladorStore()
  const { insightsAbierto, toggleInsights } = useUIStore()

  const r = useMemo(
    () => resumenPlan(proyectos, asignaciones, personas, violaciones),
    [proyectos, asignaciones, personas, violaciones],
  )

  const faltaAlgo = r.sinPlanificar.length > 0 || r.incompletas.length > 0

  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid var(--line)', background: 'var(--white)' }}>
      {/* Cabecera / toggle */}
      <button
        onClick={toggleInsights}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px',
          border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left',
        }}
        title={insightsAbierto ? 'Ocultar insights' : 'Mostrar insights'}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Insights del plan
        </span>
        {!insightsAbierto && (
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>
            {r.finPlan ? `Fin estimado ${formatFecha(r.finPlan)}` : 'Plan vacío'}
            {faltaAlgo && ` · ${r.sinPlanificar.length + r.incompletas.length} cuenta(s) con tareas sin asignar`}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>
          {insightsAbierto ? '▾ ocultar' : '▴ mostrar'}
        </span>
      </button>

      {insightsAbierto && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(238px, 1fr))',
          gap: 12, padding: '0 16px 14px', alignItems: 'stretch',
        }}>
          {/* Fin del proceso */}
          <Tile titulo="Fin del proceso" tono={r.finPlan ? 'neutro' : 'vacio'}>
            {r.finPlan ? (
              <>
                <Dato>{formatFecha(r.finPlan)}</Dato>
                <Nota>
                  {r.mesesHastaFin != null && r.mesesHastaFin >= 0
                    ? `en ~${r.mesesHastaFin} mes${r.mesesHastaFin !== 1 ? 'es' : ''} (${r.semanasHastaFin} semanas)`
                    : 'la última fase ya quedó en el pasado'}
                  {r.cuentaCierre ? ` · cierra ${r.cuentaCierre}` : ''}
                </Nota>
                {r.sinPlanificar.length > 0 && (
                  <Nota tono="warn">
                    ⚠ No incluye {r.sinPlanificar.length} cuenta{r.sinPlanificar.length !== 1 ? 's' : ''} sin planificar: la fecha real es posterior.
                  </Nota>
                )}
              </>
            ) : (
              <Nota>Todavía no hay fases planificadas. Asigná tareas y acá aparece la fecha de cierre.</Nota>
            )}
          </Tile>

          {/* Cuentas sin ninguna tarea */}
          <Tile
            titulo={`Cuentas sin tareas (${r.sinPlanificar.length})`}
            tono={r.sinPlanificar.length ? 'error' : 'ok'}
          >
            {r.sinPlanificar.length === 0 ? (
              <Nota tono="ok">✓ Todas las cuentas tienen al menos una fase asignada.</Nota>
            ) : (
              <Chips>
                {r.sinPlanificar.map(c => (
                  <Chip key={c.id} onClick={() => seleccionarCliente(c.id)} tono="error" title="Abrir la cuenta para asignar sus fases">
                    {c.nombre}
                  </Chip>
                ))}
              </Chips>
            )}
          </Tile>

          {/* Cuentas a las que les falta una fase */}
          <Tile
            titulo={`Fases faltantes (${r.incompletas.length})`}
            tono={r.incompletas.length ? 'warn' : r.cuentasPlanificadas === 0 ? 'vacio' : 'ok'}
          >
            {r.cuentasPlanificadas === 0 ? (
              <Nota>Todavía no hay ninguna cuenta planificada.</Nota>
            ) : r.incompletas.length === 0 ? (
              <Nota tono="ok">✓ Las {r.cuentasPlanificadas} cuentas planificadas tienen Relevamiento, Configuración y Pruebas.</Nota>
            ) : (
              <Chips>
                {r.incompletas.map(c => (
                  <Chip key={c.id} onClick={() => seleccionarCliente(c.id)} tono="warn"
                    title={`Falta: ${c.faltan.map(f => TIPO_LABEL[f]).join(', ')}`}>
                    {c.nombre} <span style={{ opacity: 0.75 }}>· falta {c.faltan.map(f => TIPO_LABEL[f]).join(' + ')}</span>
                  </Chip>
                ))}
              </Chips>
            )}
          </Tile>

          {/* Estado de capacidad */}
          <Tile titulo="Capacidad y conflictos" tono={r.conflictos ? 'error' : r.avisos ? 'warn' : 'ok'}>
            <Dato tono={r.conflictos ? 'error' : r.avisos ? 'warn' : 'ok'}>
              {r.conflictos === 0 && r.avisos === 0
                ? 'Sin conflictos'
                : `${r.conflictos} conflicto${r.conflictos !== 1 ? 's' : ''} · ${r.avisos} aviso${r.avisos !== 1 ? 's' : ''}`}
            </Dato>
            <Nota>
              {r.cuello
                ? `Cuello de botella: ${r.cuello.alias} con ${r.cuello.meses} mes${r.cuello.meses !== 1 ? 'es' : ''} por encima de su capacidad.`
                : `${r.cuentasPlanificadas}/${r.totalCuentas} cuentas planificadas · ${r.enCurso} fase${r.enCurso !== 1 ? 's' : ''} en curso hoy.`}
            </Nota>
            {r.personasSinCarga.length > 0 && (
              <Nota>
                Sin carga: {r.personasSinCarga.map(p => p.alias).join(', ')}.
              </Nota>
            )}
          </Tile>
        </div>
      )}
    </div>
  )
}

// ── piezas ──────────────────────────────────────────────────────────────────

type Tono = 'neutro' | 'ok' | 'warn' | 'error' | 'vacio'

const BORDE: Record<Tono, string> = {
  neutro: 'var(--line)', ok: 'var(--ok-bd)', warn: 'var(--warn-bd)', error: 'var(--error-bd)', vacio: 'var(--line)',
}
const TEXTO: Record<Tono, string> = {
  neutro: 'var(--ink)', ok: 'var(--ok-tx)', warn: 'var(--warn-tx)', error: 'var(--error-tx)', vacio: 'var(--t3)',
}

function Tile({ titulo, tono = 'neutro', children }: { titulo: string; tono?: Tono; children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--paper)', border: `1.5px solid ${BORDE[tono]}`, borderRadius: 12,
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0,
    }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {titulo}
      </span>
      {children}
    </div>
  )
}

function Dato({ children, tono = 'neutro' }: { children: ReactNode; tono?: Tono }) {
  return (
    <span className="num" style={{ fontSize: 17, fontWeight: 800, color: TEXTO[tono], lineHeight: 1.2 }}>
      {children}
    </span>
  )
}

function Nota({ children, tono = 'neutro' }: { children: ReactNode; tono?: Tono }) {
  return (
    <span style={{ fontSize: 11, lineHeight: 1.45, color: tono === 'neutro' ? 'var(--t2)' : TEXTO[tono] }}>
      {children}
    </span>
  )
}

function Chips({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 74, overflowY: 'auto' }}>
      {children}
    </div>
  )
}

function Chip({ children, onClick, tono, title }: { children: ReactNode; onClick: () => void; tono: Tono; title?: string }) {
  const style: CSSProperties = {
    border: `1px solid ${BORDE[tono]}`, color: TEXTO[tono], background: 'var(--white)',
    borderRadius: 9999, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  }
  return <button onClick={onClick} title={title} style={style}>{children}</button>
}
