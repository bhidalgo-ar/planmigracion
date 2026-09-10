import { useMemo, useState, type CSSProperties } from 'react'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import type { RolPersona, TipoFase } from '../types'
import { formatFechaCorta } from '../utils/dates'
import { describirTraspaso, type ReporteTraspaso, type Traspaso } from '../planificador'
import { ORDEN_FASES, TIPO_LABEL } from '../theme/fases'

const ROLES: { value: RolPersona | ''; label: string }[] = [
  { value: '', label: 'Sin clasificar' },
  { value: 'relevamiento', label: 'Relev.' },
  { value: 'configuracion', label: 'Config.' },
  { value: 'pruebas', label: 'Pruebas' },
]
const ROL_LABEL: Record<string, string> = { relevamiento: 'Relevamiento', configuracion: 'Configuración', pruebas: 'Pruebas' }

export function ModalEquipo() {
  const { personas, asignaciones, config, proyectos, addPersona, removePersona, renamePersona, addVacaciones, removeAsignacion, traspasarFases } = useSimuladorStore()
  const cerrarModal = useUIStore(s => s.cerrarModal)
  // Traspaso en bloque: de quién, a quién, qué tipo de fase y desde qué mes.
  const [tr, setTr] = useState<{ origen: string; destino: string; tipo: TipoFase | ''; desdeMes: string }>({ origen: '', destino: '', tipo: '', desdeMes: '' })
  const [ultimoTraspaso, setUltimoTraspaso] = useState<ReporteTraspaso | null>(null)
  const traspaso: Traspaso | null = tr.origen && tr.destino && tr.origen !== tr.destino
    ? { origen: tr.origen, destino: tr.destino, tipos: tr.tipo ? [tr.tipo] : null, desdeMes: tr.desdeMes || null }
    : null
  const previewTraspaso = useMemo(
    () => (traspaso ? describirTraspaso(asignaciones, traspaso, personas, config, proyectos) : null),
    [traspaso?.origen, traspaso?.destino, traspaso?.tipos?.[0], traspaso?.desdeMes, asignaciones, personas, config, proyectos],
  )
  function aplicarTraspaso() {
    if (!traspaso) return
    setUltimoTraspaso(traspasarFases(traspaso))
  }
  const aliasDe = (id: string) => personas.find(p => p.id === id)?.alias ?? id
  const [alias, setAlias] = useState('')
  const [rol, setRol] = useState<RolPersona | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editAlias, setEditAlias] = useState('')
  // Formulario de vacaciones abierto (una persona a la vez).
  const [vacForm, setVacForm] = useState<{ personaId: string; desde: string; hasta: string } | null>(null)

  function confirmarVacaciones() {
    if (!vacForm) return
    const r = addVacaciones(vacForm.personaId, vacForm.desde, vacForm.hasta)
    if (!r.ok) { setError(r.motivo ?? 'No se pudieron cargar las vacaciones.'); return }
    setError(null)
    setVacForm(null)
  }

  function handleAdd() {
    const a = alias.trim()
    if (!a) return
    addPersona(a, rol || null)
    setAlias(''); setRol(''); setError(null)
  }

  function handleRemove(id: string, aliasPersona: string) {
    const uso = usoPorPersona(id)
    if (uso > 0) {
      if (!confirm(`${aliasPersona} tiene ${uso} fase${uso !== 1 ? 's' : ''} asignada${uso !== 1 ? 's' : ''}. Se eliminará la persona junto con esas fases. ¿Seguro?`)) return
      removePersona(id, true)
      setError(null)
      return
    }
    const r = removePersona(id)
    if (!r.ok) setError(r.motivo ?? 'No se puede quitar.')
    else setError(null)
  }

  function empezarRename(id: string, aliasActual: string) {
    setEditId(id); setEditAlias(aliasActual)
  }
  function confirmarRename() {
    if (editId) renamePersona(editId, editAlias)
    setEditId(null)
  }

  const usoPorPersona = (id: string) => asignaciones.filter(a => a.persona_id === id).length

  return (
    <Overlay onClose={cerrarModal} titulo="Equipo">
      {/* Alta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>Agregar recurso</span>
        <input value={alias} onChange={e => setAlias(e.target.value)} placeholder="Alias (sin nombres reales)" onKeyDown={e => e.key === 'Enter' && handleAdd()}
          style={inp} maxLength={24} />
        <div style={{ display: 'flex', gap: 6 }}>
          {ROLES.map(r => (
            <button key={r.value} onClick={() => setRol(r.value as RolPersona | '')}
              style={{ ...seg, ...(rol === r.value ? segActive : {}) }}>{r.label}</button>
          ))}
        </div>
        <button onClick={handleAdd} disabled={!alias.trim()} style={{ ...addBtn, opacity: alias.trim() ? 1 : 0.5 }}>+ Agregar al equipo</button>
        <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>Solo alias y rol. Nunca nombres reales, CUIT/CUIL, sueldos ni legajos.</span>
      </div>

      {/* Traspaso en bloque: "tengo que pasarle tareas a otra persona para poder cumplir". Solo cambia quién; fechas y horas quedan igual. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>Pasar fases a otra persona</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <select value={tr.origen} onChange={e => { setTr({ ...tr, origen: e.target.value }); setUltimoTraspaso(null) }} style={inp}>
            <option value="">De…</option>
            {personas.map(p => <option key={p.id} value={p.id}>{p.alias}</option>)}
          </select>
          <select value={tr.destino} onChange={e => { setTr({ ...tr, destino: e.target.value }); setUltimoTraspaso(null) }} style={inp}>
            <option value="">A…</option>
            {personas.map(p => <option key={p.id} value={p.id}>{p.alias}</option>)}
          </select>
          <select value={tr.tipo} onChange={e => { setTr({ ...tr, tipo: e.target.value as TipoFase | '' }); setUltimoTraspaso(null) }} style={inp}>
            <option value="">Todas las fases</option>
            {ORDEN_FASES.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
          </select>
          <input type="month" value={tr.desdeMes} onChange={e => { setTr({ ...tr, desdeMes: e.target.value }); setUltimoTraspaso(null) }} style={inp} title="Desde qué mes (por inicio de la fase). Vacío = todas." />
        </div>
        {previewTraspaso && !ultimoTraspaso && (
          <div className="num" style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.5 }}>
            Mueve <b style={{ color: 'var(--ink)' }}>{previewTraspaso.fases} fase{previewTraspaso.fases !== 1 ? 's' : ''}</b> de {aliasDe(tr.origen)} a {aliasDe(tr.destino)}.
            {previewTraspaso.fases > 0 && (
              <> Conflictos {previewTraspaso.rojosAntes} → <b style={{ color: previewTraspaso.rojosDespues > previewTraspaso.rojosAntes ? 'var(--error-tx)' : 'var(--ink)' }}>{previewTraspaso.rojosDespues}</b> · Avisos {previewTraspaso.ambaresAntes} → {previewTraspaso.ambaresDespues}.</>
            )}
            {previewTraspaso.nuevas.slice(0, 3).map((m, i) => (
              <div key={i} style={{ marginTop: 4, padding: '4px 8px', background: 'var(--error-bg)', borderRadius: 6, color: 'var(--error-tx)', fontSize: 11 }}>{m}</div>
            ))}
            {previewTraspaso.nuevas.length > 3 && <div style={{ fontSize: 10.5, color: 'var(--t3)' }}>… y {previewTraspaso.nuevas.length - 3} más</div>}
          </div>
        )}
        {ultimoTraspaso && (
          <div className="num" style={{ fontSize: 11.5, padding: '6px 9px', background: 'var(--ok-bg)', border: '1px solid var(--ok-bd)', borderRadius: 8, color: 'var(--ok-tx)' }}>
            Listo: {ultimoTraspaso.fases} fase{ultimoTraspaso.fases !== 1 ? 's' : ''} pasaron a {aliasDe(tr.destino)}. Conflictos {ultimoTraspaso.rojosAntes} → {ultimoTraspaso.rojosDespues}. Ctrl+Z lo deshace entero.
          </div>
        )}
        <button onClick={aplicarTraspaso} disabled={!previewTraspaso || previewTraspaso.fases === 0 || !!ultimoTraspaso}
          style={{ ...addBtn, opacity: previewTraspaso && previewTraspaso.fases > 0 && !ultimoTraspaso ? 1 : 0.5 }}>
          Pasar {previewTraspaso?.fases ?? ''} fase{previewTraspaso?.fases !== 1 ? 's' : ''}
        </button>
      </div>

      {error && <div style={{ margin: '12px 0', fontSize: 12, padding: '8px 10px', background: 'var(--error-bg)', color: 'var(--error-tx)', borderRadius: 8, borderLeft: '3px solid var(--error)' }}>{error}</div>}

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, maxHeight: 320, overflowY: 'auto' }}>
        {personas.map(p => {
          const uso = usoPorPersona(p.id)
          const editando = editId === p.id
          const vacs = asignaciones.filter(a => a.persona_id === p.id && a.tipo === 'Vacaciones').sort((a, b) => (a.inicio < b.inicio ? -1 : 1))
          const abriendo = vacForm?.personaId === p.id
          return (
            <div key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--white)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
              {editando ? (
                <input
                  value={editAlias}
                  onChange={e => setEditAlias(e.target.value)}
                  onBlur={confirmarRename}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarRename(); if (e.key === 'Escape') setEditId(null) }}
                  autoFocus maxLength={24}
                  style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: 'var(--ink)', padding: '4px 7px', border: '1.5px solid var(--celeste)', borderRadius: 6, background: 'var(--white)' }}
                />
              ) : (
                <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)', flex: 1 }}>{p.alias}</span>
              )}
              <span style={{ fontSize: 10.5, color: p.rol ? 'var(--celeste-dark)' : 'var(--t3)', fontWeight: 600 }}>{p.rol ? ROL_LABEL[p.rol] : 'sin clasificar'}</span>
              <span style={{ fontSize: 10.5, color: 'var(--t3)' }}>{uso} fase{uso !== 1 ? 's' : ''}</span>
              <button onClick={() => empezarRename(p.id, p.alias)} title="Renombrar"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t2)', fontSize: 13 }}>✏️</button>
              <button onClick={() => handleRemove(p.id, p.alias)} title={uso ? 'Eliminar persona y sus fases' : 'Quitar'}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: 16 }}>×</button>
            </div>
            {/* Vacaciones: bloqueos que restan capacidad y ponen en rojo la fase que las pise. */}
            <div style={{ padding: '0 10px 8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {vacs.map(v => (
                <div key={v.id} className="num" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--t2)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--fase-bloqueo)', flexShrink: 0 }} />
                  <span>Vacaciones {formatFechaCorta(v.inicio)} → {formatFechaCorta(v.fin)} · {v.duracion_dias} hábil{v.duracion_dias !== 1 ? 'es' : ''}</span>
                  <button onClick={() => removeAsignacion(v.id)} title="Quitar estas vacaciones"
                    style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 14 }}>×</button>
                </div>
              ))}
              {abriendo && vacForm ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <input type="date" value={vacForm.desde} onChange={e => setVacForm({ ...vacForm, desde: e.target.value })} style={{ ...inp, padding: '4px 7px', fontSize: 12 }} />
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>→</span>
                  <input type="date" value={vacForm.hasta} min={vacForm.desde || undefined} onChange={e => setVacForm({ ...vacForm, hasta: e.target.value })} style={{ ...inp, padding: '4px 7px', fontSize: 12 }} />
                  <button onClick={confirmarVacaciones} disabled={!vacForm.desde || !vacForm.hasta}
                    style={{ ...addBtn, padding: '5px 12px', fontSize: 11.5, opacity: vacForm.desde && vacForm.hasta ? 1 : 0.5 }}>Cargar</button>
                  <button onClick={() => setVacForm(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 11.5 }}>Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setVacForm({ personaId: p.id, desde: '', hasta: '' })}
                  style={{ alignSelf: 'flex-start', border: '1px dashed var(--line)', background: 'none', cursor: 'pointer', color: 'var(--t2)', fontSize: 11, fontWeight: 600, borderRadius: 9999, padding: '3px 10px' }}>+ Vacaciones</button>
              )}
            </div>
            </div>
          )
        })}
      </div>
    </Overlay>
  )
}

// ---------- shell reutilizable ----------
export function Overlay({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,19,30,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--white)', borderRadius: 16, boxShadow: 'var(--sh)', padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--ink)', flex: 1 }}>{titulo}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inp: CSSProperties = { padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 8, fontSize: 14, background: 'var(--white)', color: 'var(--ink)' }
const seg: CSSProperties = { flex: 1, padding: '6px 4px', border: '1.5px solid var(--line)', borderRadius: 8, background: 'var(--white)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: 'var(--t2)' }
const segActive: CSSProperties = { background: 'var(--celeste)', color: '#fff', borderColor: 'var(--celeste)' }
const addBtn: CSSProperties = { padding: '8px', border: 'none', borderRadius: 9999, background: 'var(--celeste)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }
