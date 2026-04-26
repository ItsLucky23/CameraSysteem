/* eslint-disable */
function SettingsArtboard() {
  return (
    <div className="app-surface" style={{ display: 'flex', height: '100%', minHeight: 900 }}>
      <SideRail active="settings"/>
      <main style={{ flex: 1, overflowY: 'auto' }} className="thin-scroll">
        <PageTopBar
          eyebrow="Account"
          title="Settings"
          subtitle="Personalize your workspace, language, and appearance."
        />

        <div style={{ padding: '0 36px 40px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 32 }}>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'sticky', top: 0 }}>
            {[
              { k: 'Profile', a: true },
              { k: 'Appearance', a: false },
              { k: 'Language' },
              { k: 'Notifications' },
              { k: 'Sessions' },
              { k: 'Security' },
            ].map(s => (
              <button key={s.k} style={{
                textAlign: 'left', padding: '8px 12px', borderRadius: 8,
                background: s.a ? 'var(--color-container2)' : 'transparent',
                border: 'none', cursor: 'pointer',
                color: s.a ? 'var(--color-title)' : 'var(--color-common)',
                fontWeight: s.a ? 600 : 500, fontSize: 13.5,
              }}>{s.k}</button>
            ))}
          </nav>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Profile */}
            <section className="surface" style={{ padding: 28 }}>
              <SectionHead title="Profile" sub="How you appear across the workspace."/>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
                <div style={{
                  width: 80, height: 80, borderRadius: 20,
                  background: 'linear-gradient(135deg, #E8A87C 0%, #2D5BFF 100%)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)',
                }}>EM</div>
                <div>
                  <button className="btn">Change avatar</button>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 6 }}>JPG, GIF or PNG · 4MB max.</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Labeled label="Name" value="Eli Marek"/>
                <Labeled label="Email" value="eli@aperture.io" readOnly/>
              </div>
            </section>

            {/* Appearance */}
            <section className="surface" style={{ padding: 28 }}>
              <SectionHead title="Appearance" sub="Light feels great in daylight; dark for the night shift."/>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { k: 'light', label: 'Light', bg: '#FAFAF8', fg: '#1A1A1A', accent: '#2D5BFF', a: true },
                  { k: 'dark', label: 'Dark · Aperture', bg: '#1B1426', fg: '#F4EEFF', accent: '#8B5DFF' },
                ].map(t => (
                  <div key={t.k} style={{
                    border: t.a ? '2px solid var(--color-primary)' : '1px solid var(--color-container1-border)',
                    borderRadius: 14, padding: 4, cursor: 'pointer',
                  }}>
                    <div style={{
                      background: t.bg, borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div>
                        <div style={{ width: 70, height: 7, background: t.fg, opacity: 0.85, borderRadius: 4 }}/>
                        <div style={{ width: 110, height: 5, background: t.fg, opacity: 0.4, borderRadius: 4, marginTop: 6 }}/>
                      </div>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: t.accent }}/>
                    </div>
                    <div style={{ padding: '10px 12px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)' }}>{t.label}</span>
                      {t.a && <span className="chip chip-primary">Active</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Language */}
            <section className="surface" style={{ padding: 28 }}>
              <SectionHead title="Language" sub="Used for the interface and notifications."/>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { k: 'EN', n: 'English', a: true },
                  { k: 'NL', n: 'Nederlands' },
                  { k: 'DE', n: 'Deutsch' },
                  { k: 'FR', n: 'Français' },
                ].map(l => (
                  <button key={l.k} style={{
                    padding: '14px 12px', borderRadius: 12,
                    background: l.a ? 'var(--color-primary-soft)' : 'var(--color-container2)',
                    border: l.a ? '1px solid var(--color-primary)' : '1px solid transparent',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                  }}>
                    <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: l.a ? 'var(--color-primary)' : 'var(--color-title)' }}>{l.k}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{l.n}</span>
                  </button>
                ))}
              </div>
            </section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn">Cancel</button>
              <button className="btn btn-primary">Save changes</button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function SectionHead({ title, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 className="font-display" style={{ margin: 0, fontSize: 22, color: 'var(--color-title)' }}>{title}</h3>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function Labeled({ label, value, readOnly }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-common)', display: 'block', marginBottom: 6 }}>{label}</label>
      <input value={value} readOnly={readOnly} onChange={() => {}} style={{
        width: '100%', height: 40, padding: '0 12px',
        border: '1px solid var(--color-container1-border)',
        background: readOnly ? 'var(--color-container2)' : 'var(--color-container1)',
        borderRadius: 8, fontSize: 13.5,
        color: 'var(--color-title)', fontFamily: 'inherit',
        outline: 'none',
      }}/>
    </div>
  );
}

window.SettingsArtboard = SettingsArtboard;
