// Resumen ejecutivo animado — programa Meta4 → Axton (plan v3, 10/09/2026)
const { CompositionStage, useComposition, Captions, Easing, clamp, useTweaks, TweaksPanel, TweakSection, TweakToggle } = window;

const W = 1920, H = 1080;
const F = "'Source Sans 3','Source Sans Pro',Arial,Helvetica,sans-serif";
const CEL = '#00ACD4', CELD = '#007896', CELL = '#B3E6F2', GRIS = '#8C837B', INK = '#000000', BORDER = '#E7E6E6', ERR = '#E85518', WARN = '#F59E0B';

const SALIDAS = [
  { n: 'POF', m: 'sep', q: 0, mi: 0 }, { n: 'Finadiet', m: 'oct', q: 1, mi: 1 }, { n: 'TIM', m: 'oct', q: 1, mi: 1 },
  { n: 'Piano', m: 'nov', q: 1, mi: 2 }, { n: 'DLA', m: 'nov', q: 1, mi: 2 }, { n: 'GSMA', m: 'dic', q: 1, mi: 3 }, { n: 'Bonafide', m: 'dic', q: 1, mi: 3 },
  { n: 'Copetro', m: 'ene', q: 2, mi: 4 }, { n: 'Campari', m: 'ene', q: 2, mi: 4 }, { n: 'Lowsedo', m: 'feb', q: 2, mi: 5 }, { n: 'Marval', m: 'feb', q: 2, mi: 5 },
  { n: 'Sportline', m: 'mar', q: 2, mi: 6 }, { n: 'Aysa', m: 'mar', q: 2, mi: 6 }, { n: 'Ford', m: 'mar', q: 2, mi: 6 }, { n: 'Carrier', m: 'abr', q: 3, mi: 7 },
];
const QS = [{ l: 'Q3 2026', s: 'septiembre' }, { l: 'Q4 2026', s: 'oct – dic' }, { l: 'Q1 2027', s: 'ene – mar' }, { l: 'Q2 2027', s: 'abril' }];
const QX = [400, 773, 1146, 1519];
const CHIP_W = 280, CHIP_H = 54, CHIP_GAP = 10, BASE_Y = 800;
const MESES = ['sep 26', 'oct 26', 'nov 26', 'dic 26', 'ene 27', 'feb 27', 'mar 27', 'abr 27'];
const DOT = 56, DOT_GAP = 14, DOT_X0 = (W - (25 * DOT + 24 * DOT_GAP)) / 2, DOT_Y = 532;

// Exactly three motion helpers.
const MOTION = {
  enter: (T, s, d = 0.7) => { const e = Easing.easeOutCubic(clamp((T - s) / d, 0, 1)); return { opacity: e, transform: `translateY(${(1 - e) * 24}px)` }; },
  draw: (T, s, d = 0.8) => Easing.easeInOutCubic(clamp((T - s) / d, 0, 1)),
  pop: (T, s, d = 0.6) => { const p = clamp((T - s) / d, 0, 1); return { opacity: Math.min(1, p * 3), transform: `scale(${0.6 + 0.4 * Easing.easeOutBack(p)})` }; },
};
const lerp = (a, b, p) => a + (b - a) * p;

// Slot index of a salida inside its quarter column.
const slotIn = (i) => SALIDAS.slice(0, i).filter(s => s.q === SALIDAS[i].q).length;
const stackIn = (i) => SALIDAS.slice(0, i).filter(s => s.mi === SALIDAS[i].mi).length;

function Header({ T, C }) {
  // Logo: centered hero in Apertura → small top-left through the body → back to center in Cierre.
  const toHead = MOTION.draw(T, C.Hoy - 0.7, 0.9);
  const toCenter = MOTION.draw(T, C.Cierre - 0.6, 0.9);
  const p = toHead * (1 - toCenter);
  const size = lerp(168, 56, p), x = lerp(W / 2 - 84, 72, p), y = lerp(300, 44, p);
  const labelO = Math.min(MOTION.draw(T, C.Hoy, 0.5), 1 - MOTION.draw(T, C.Cierre - 0.6, 0.4));
  return (
    <div>
      <img src="assets/logo-ha.png" alt="" style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: '50%' }} />
      <div style={{ position: 'absolute', left: 144, top: 48, opacity: labelO, lineHeight: 1.2 }}>
        <div style={{ font: `700 18px ${F}`, color: INK, letterSpacing: '-0.01em' }}>Hidalgo <span style={{ color: GRIS, fontWeight: 400, fontStyle: 'italic' }}>&amp;</span> Asociados</div>
        <div style={{ font: `700 13px ${F}`, color: CELD, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Simulador de Migración · Resumen ejecutivo</div>
      </div>
      <div style={{ position: 'absolute', right: 72, top: 56, opacity: labelO, font: `400 18px ${F}`, color: GRIS }}>Plan v3 · 10 de septiembre de 2026</div>
    </div>
  );
}

function Apertura({ T, C }) {
  const out = 1 - MOTION.draw(T, C.Hoy - 0.45, 0.45);
  const t1 = MOTION.enter(T, 0.5), t2 = MOTION.enter(T, 1.1);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: out, textAlign: 'center' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, ...t1, font: `700 64px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>Programa de migración Meta4 → Axton</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 612, ...t2, font: `400 30px ${F}`, color: GRIS }}>Resumen ejecutivo · 10 de septiembre de 2026</div>
    </div>
  );
}

function Hoy({ T, C }) {
  const out = 1 - MOTION.draw(T, C.Ola - 0.6, 0.5);
  const h = MOTION.enter(T, C.Hoy);
  const filled = Array.from({ length: 10 }, (_, i) => MOTION.draw(T, C.Hoy + 1.4 + i * 0.1, 0.35)).reduce((a, b) => a + (b > 0.5 ? 1 : 0), 0);
  const leg = MOTION.enter(T, C.Hoy + 2.9);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, textAlign: 'center', opacity: h.opacity * out, transform: h.transform }}>
        <div style={{ font: `600 22px ${F}`, color: GRIS, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Hoy</div>
        <div style={{ font: `700 76px ${F}`, color: INK, letterSpacing: '-0.02em', marginTop: 6 }}>
          <span style={{ color: CEL }}>{filled}</span> de 25 cuentas ya operan en Axton
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, display: 'flex', justifyContent: 'center', gap: 56, opacity: leg.opacity * out, transform: leg.transform, font: `400 28px ${F}`, color: INK }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 22, height: 22, borderRadius: 9999, background: CEL }}></span>En Axton · <b>10</b></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ width: 22, height: 22, borderRadius: 9999, border: `2px solid ${GRIS}` }}></span>En Meta4, por migrar · <b>15</b></div>
      </div>
    </div>
  );
}

// The 25 account marks: 10 legacy dots + 15 pending dots that become the wave chips.
function Cuentas({ T, C }) {
  const nodes = [];
  for (let i = 0; i < 10; i++) {
    const pop = MOTION.pop(T, C.Hoy + 0.3 + i * 0.06);
    const fill = MOTION.draw(T, C.Hoy + 1.4 + i * 0.1, 0.35);
    const out = 1 - MOTION.draw(T, C.Ola - 0.4, 0.6);
    nodes.push(<div key={'l' + i} style={{ position: 'absolute', left: DOT_X0 + i * (DOT + DOT_GAP), top: DOT_Y, width: DOT, height: DOT, borderRadius: 9999, boxSizing: 'border-box', border: `2px solid ${fill > 0.5 ? CEL : GRIS}`, background: fill > 0.5 ? CEL : '#fff', opacity: pop.opacity * out, transform: pop.transform + ` scale(${lerp(1, 0.4, 1 - out)})` }} />);
  }
  for (let j = 0; j < 15; j++) {
    const i = 10 + j;
    const pop = MOTION.pop(T, C.Hoy + 0.3 + i * 0.06);
    const p = MOTION.draw(T, C.Ola + 0.3 + j * 0.13, 1.0);
    const s = SALIDAS[j], k = slotIn(j);
    const x0 = DOT_X0 + i * (DOT + DOT_GAP), y0 = DOT_Y;
    const x1 = QX[s.q] - CHIP_W / 2, y1 = BASE_Y - (k + 1) * CHIP_H - k * CHIP_GAP;
    const fadeOut = 1 - MOTION.draw(T, C.Cuello - 0.6, 0.7);
    const textO = clamp((p - 0.7) / 0.3, 0, 1);
    nodes.push(
      <div key={'p' + j} style={{ position: 'absolute', left: lerp(x0, x1, p), top: lerp(y0, y1, p), width: lerp(DOT, CHIP_W, p), height: lerp(DOT, CHIP_H, p), borderRadius: 9999, boxSizing: 'border-box', border: `2px solid ${p > 0.5 ? CEL : GRIS}`, background: p > 0.5 ? CEL : '#fff', opacity: pop.opacity * fadeOut, transform: pop.transform, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <span style={{ opacity: textO, font: `700 24px ${F}`, color: '#fff' }}>{s.n}</span>
        <span style={{ opacity: textO, font: `400 22px ${F}`, color: 'rgba(255,255,255,0.85)' }}>· {s.m}</span>
      </div>
    );
  }
  return <div>{nodes}</div>;
}

function Ola({ T, C }) {
  const out = 1 - MOTION.draw(T, C.Cuello - 0.6, 0.7);
  const h = MOTION.enter(T, C.Ola + 0.3);
  const line = MOTION.draw(T, C.Ola + 0.2, 0.9);
  const counts = [1, 6, 7, 1];
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', ...h, font: `700 56px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>La ola de salidas en vivo, trimestre a trimestre</div>
      <div style={{ position: 'absolute', left: 240, top: BASE_Y + 12, height: 2, width: 1440 * line, background: BORDER }} />
      {QS.map((q, qi) => {
        const firstIdx = SALIDAS.findIndex(s => s.q === qi);
        const lab = MOTION.enter(T, C.Ola + 0.3 + firstIdx * 0.13 + 0.9);
        return (
          <div key={q.l} style={{ position: 'absolute', left: QX[qi] - 160, width: 320, top: BASE_Y + 36, textAlign: 'center', ...lab }}>
            <div style={{ font: `700 30px ${F}`, color: INK }}>{q.l}</div>
            <div style={{ font: `400 24px ${F}`, color: GRIS }}>{q.s} · {counts[qi]} {counts[qi] === 1 ? 'salida' : 'salidas'}</div>
          </div>
        );
      })}
    </div>
  );
}

// Enero 2027 gantt. Days from 2026-12-21 (x=300) to 2027-02-06 (x=1800).
const D0 = Date.UTC(2026, 11, 21), DAY = 86400000;
const dx = (y, m, d) => 300 + ((Date.UTC(y, m - 1, d) - D0) / DAY) * (1500 / 47);
const ROWS = [
  { n: 'Copetro', bars: [{ f: 'Pruebas', a: [2027, 1, 4], b: [2027, 1, 13] }] },
  { n: 'Campari', bars: [{ f: 'Pruebas', a: [2027, 1, 4], b: [2027, 1, 13] }] },
  { n: 'Marval', bars: [{ f: 'Configuración', a: [2027, 1, 11], b: [2027, 1, 19] }, { f: 'Pruebas', a: [2027, 1, 25], b: [2027, 2, 5] }] },
  { n: 'Lowsedo', bars: [{ f: 'Relevamiento', a: [2027, 1, 11], b: [2027, 1, 13] }, { f: 'Configuración', a: [2027, 1, 18], b: [2027, 1, 26] }, { f: 'Pruebas', a: [2027, 2, 1], b: [2027, 2, 6] }] },
];
const FASE = { Relevamiento: { bg: CELL, fg: CELD }, 'Configuración': { bg: CEL, fg: '#fff' }, Pruebas: { bg: CELD, fg: '#fff' } };

function Cuello({ T, C, showRisks }) {
  const inn = MOTION.draw(T, C.Cuello + 0.2, 0.8);
  const out = 1 - MOTION.draw(T, C.Fin - 0.6, 0.6);
  const h = MOTION.enter(T, C.Cuello + 0.3);
  const weeks = [[2026, 12, 21], [2026, 12, 28], [2027, 1, 4], [2027, 1, 11], [2027, 1, 18], [2027, 1, 25], [2027, 2, 1]];
  const wl = ['21 dic', '28 dic', '4 ene', '11 ene', '18 ene', '25 ene', '1 feb'];
  const blackO = MOTION.draw(T, C.Cuello + 0.9, 0.6);
  let bi = 0;
  const r1 = MOTION.pop(T, C.Cuello + 4.6), r2 = MOTION.pop(T, C.Cuello + 6.2);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: inn * out, transform: `scale(${lerp(0.96, 1, inn)})` }}>
      <div style={{ position: 'absolute', left: 120, top: 150, ...h, font: `700 56px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>Enero 2027: cuatro cuentas al mismo tiempo</div>
      {weeks.map((w, i) => (
        <div key={i} style={{ position: 'absolute', left: dx(...w), top: 290, opacity: MOTION.draw(T, C.Cuello + 0.5 + i * 0.05, 0.4) }}>
          <div style={{ font: `600 20px ${F}`, color: GRIS, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>{wl[i]}</div>
          <div style={{ position: 'absolute', left: 0, top: 34, width: 1, height: 380, background: BORDER }} />
        </div>
      ))}
      <div style={{ position: 'absolute', left: dx(2026, 12, 21), top: 324, width: dx(2027, 1, 9) - dx(2026, 12, 21), height: 380, opacity: blackO, background: 'repeating-linear-gradient(135deg, rgba(140,131,123,0.10) 0 8px, transparent 8px 16px)', borderRight: `2px dashed ${GRIS}` }}>
        <div style={{ position: 'absolute', left: 12, bottom: -34, font: `600 18px ${F}`, color: GRIS, whiteSpace: 'nowrap' }}>Blackout de configuración · 21/12 – 08/01</div>
      </div>
      {ROWS.map((r, ri) => (
        <div key={r.n} style={{ position: 'absolute', left: 0, top: 340 + ri * 92, height: 60 }}>
          <div style={{ position: 'absolute', left: 120, top: 12, width: 160, textAlign: 'right', font: `700 28px ${F}`, color: INK, opacity: MOTION.draw(T, C.Cuello + 0.8 + ri * 0.2, 0.4) }}>{r.n}</div>
          {r.bars.map((b, k) => {
            const x0 = dx(...b.a), x1 = dx(...b.b) + 1500 / 47;
            const p = MOTION.draw(T, C.Cuello + 1.0 + (bi++) * 0.28, 0.7);
            return <div key={k} style={{ position: 'absolute', left: x0, top: 0, width: (x1 - x0) * p, height: 60, borderRadius: 8, background: FASE[b.f].bg, color: FASE[b.f].fg, font: `600 20px ${F}`, display: 'flex', alignItems: 'center', paddingLeft: 14, boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap' }}><span style={{ opacity: (x1 - x0) < 130 ? 0 : clamp((p - 0.6) / 0.4, 0, 1) }}>{b.f}</span></div>;
          })}
        </div>
      ))}
      <div style={{ position: 'absolute', left: 300, top: 748, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 14, opacity: showRisks ? 1 : 0 }}>
        <div style={{ ...r1, transformOrigin: 'left center', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 26px', borderRadius: 9999, whiteSpace: 'nowrap', background: 'rgba(232,85,24,0.10)', border: `1.5px solid rgba(232,85,24,0.45)`, color: ERR, font: `700 24px ${F}` }}>
          <span style={{ width: 14, height: 14, borderRadius: 9999, background: ERR }}></span>Carga del equipo en enero por encima de la capacidad
        </div>
        <div style={{ ...r2, transformOrigin: 'left center', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 26px', borderRadius: 9999, whiteSpace: 'nowrap', background: 'rgba(245,158,11,0.12)', border: `1.5px solid rgba(245,158,11,0.5)`, color: '#9A6200', font: `700 24px ${F}` }}>
          <span style={{ width: 14, height: 14, borderRadius: 9999, background: WARN }}></span>Marzo 2027: tres salidas en vivo, el tope del mes
        </div>
      </div>
    </div>
  );
}

function Fin({ T, C }) {
  const inn = MOTION.draw(T, C.Fin + 0.1, 0.7);
  const out = 1 - MOTION.draw(T, C.Cierre - 0.6, 0.5);
  const h = MOTION.enter(T, C.Fin + 0.2);
  const X0 = 260, STEP = 200, TY = 640;
  const line = MOTION.draw(T, C.Fin + 0.4, 1.2);
  const landed = SALIDAS.map((_, i) => MOTION.draw(T, C.Fin + 0.9 + i * 0.17, 0.5));
  const n = 10 + landed.filter(v => v >= 0.999).length;
  const fin = MOTION.pop(T, C.Fin + 4.2);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: inn * out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center', ...h, font: `700 56px ${F}`, color: CEL, letterSpacing: '-0.01em' }}>Cuándo termina</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 240, textAlign: 'center', ...h, font: `700 120px ${F}`, color: INK, letterSpacing: '-0.03em', lineHeight: 1 }}>
        <span style={{ color: CEL }}>{n}</span><span style={{ color: GRIS, fontWeight: 300 }}> / 25</span>
        <div style={{ font: `400 26px ${F}`, color: GRIS, marginTop: 8, letterSpacing: 0 }}>cuentas en Axton</div>
      </div>
      <div style={{ position: 'absolute', left: X0, top: TY, height: 3, width: (7 * STEP) * line, background: CEL }} />
      {MESES.map((m, i) => (
        <div key={m} style={{ position: 'absolute', left: X0 + i * STEP, top: TY - 10, opacity: clamp(line * 8 - i, 0, 1) }}>
          <div style={{ width: 3, height: 22, background: CEL, transform: 'translateX(-1px)' }} />
          <div style={{ position: 'absolute', top: 34, left: 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap', font: `600 22px ${F}`, color: i === 7 ? INK : GRIS }}>{m}</div>
        </div>
      ))}
      {SALIDAS.map((s, i) => {
        const p = landed[i], k = stackIn(i);
        const y = lerp(TY - 260, TY - 34 - k * 34, Easing.easeOutCubic(p));
        return <div key={s.n} style={{ position: 'absolute', left: X0 + s.mi * STEP - 13, top: y, width: 26, height: 26, borderRadius: 9999, background: CEL, opacity: p > 0 ? 1 : 0 }} />;
      })}
      <div style={{ position: 'absolute', left: X0 + 7 * STEP, top: TY + 80, ...fin, transformOrigin: 'top center' }}>
        <div style={{ transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' }}>
          <div style={{ display: 'inline-block', padding: '10px 26px', borderRadius: 9999, background: CEL, color: '#fff', font: `700 24px ${F}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Abril 2027</div>
          <div style={{ font: `400 26px ${F}`, color: INK, marginTop: 10 }}>Carrier, la última salida en vivo</div>
        </div>
      </div>
    </div>
  );
}

function Cierre({ T, C, total }) {
  const t1 = MOTION.enter(T, C.Cierre + 0.4), t2 = MOTION.enter(T, C.Cierre + 1.1);
  const out = 1 - MOTION.draw(T, total - 0.7, 0.5);
  return (
    <div style={{ position: 'absolute', inset: 0, textAlign: 'center', opacity: out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 520, ...t1, font: `700 64px ${F}`, color: INK, letterSpacing: '-0.01em' }}>15 cuentas en 8 meses.</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 604, ...t2, font: `600 44px ${F}`, color: CEL }}>El programa cierra en abril de 2027.</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 720, ...t2, font: `300 26px ${F}`, color: GRIS }}>Hidalgo &amp; Asociados · Simulador de Migración</div>
    </div>
  );
}

function Piece({ tweaks }) {
  const { T, CUES: C, authoredTotal } = useComposition();
  const drift = 1 + 0.012 * Math.sin(T * 0.35);
  const caps = [
    { at: C.Hoy + 0.6, until: C.Ola - 0.4, text: 'Hoy, 10 de las 25 cuentas ya operan en Axton. Faltan 15.' },
    { at: C.Ola + 0.6, text: 'Las 15 salen en vivo en cuatro trimestres.' },
    { at: C.Ola + 4.5, until: C.Cuello - 0.4, text: 'Q4 2026 concentra seis salidas; Q1 2027, siete.' },
    { at: C.Cuello + 0.8, text: 'Enero 2027 es el mes crítico: Copetro, Campari, Marval y Lowsedo a la vez.' },
    { at: C.Cuello + 4.8, until: C.Fin - 0.4, text: tweaks.showRisks ? 'La carga supera la capacidad del equipo: es la alerta roja del plan.' : 'Cuatro cuentas se solapan en un mes con blackout de configuración.' },
    { at: C.Fin + 0.6, text: 'Con esta ola, Axton pasa de 10 a 25 cuentas.' },
    { at: C.Fin + 4.4, until: C.Cierre - 0.4, text: 'La última salida en vivo es Carrier, en abril de 2027.' },
  ];
  return (
    <div data-screen-label={'t=' + Math.floor(T) + 's'} style={{ position: 'absolute', inset: 0, background: '#fff', overflow: 'hidden', fontFamily: F }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${drift})`, transformOrigin: '50% 50%' }}>
        <Apertura T={T} C={C} />
        <Hoy T={T} C={C} />
        <Ola T={T} C={C} />
        <Cuentas T={T} C={C} />
        <Cuello T={T} C={C} showRisks={tweaks.showRisks} />
        <Fin T={T} C={C} />
        <Cierre T={T} C={C} total={authoredTotal} />
        <Header T={T} C={C} />
      </div>
      {tweaks.captions && <Captions items={caps} style={{ bottom: '5%', font: `600 34px ${F}`, color: INK, textShadow: 'none' }} />}
    </div>
  );
}

function ResumenPiece() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CompositionStage width={W} height={H} bg="#ffffff" scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
        <Piece tweaks={t} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Contenido" />
        <TweakToggle label="Mostrar alertas de riesgo" value={t.showRisks} onChange={(v) => setTweak('showRisks', v)} />
        <TweakToggle label="Subtítulos" value={t.captions} onChange={(v) => setTweak('captions', v)} />
        <TweakSection label="Editor" />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </div>
  );
}
window.ResumenPiece = ResumenPiece;
