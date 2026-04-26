/* eslint-disable */
function AuthArtboard() {
  return (
    <div className="app-surface" style={{ display: 'flex', height: '100%', minHeight: 900, background: 'var(--color-background)' }}>
      {/* Brand panel */}
      <aside style={{
        width: '46%',
        background: 'linear-gradient(155deg, #1A1A1A 0%, #2A2538 100%)',
        position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '40px 48px',
      }}>
        {/* Decorative aperture */}
        <svg style={{ position: 'absolute', top: -120, right: -120, opacity: 0.18 }} width={520} height={520} viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="49" stroke="#fff" strokeWidth="0.4"/>
          <circle cx="50" cy="50" r="38" stroke="#fff" strokeWidth="0.4"/>
          {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
            <line key={a} x1="50" y1="50" x2={50 + 49 * Math.cos(a * Math.PI / 180)} y2={50 + 49 * Math.sin(a * Math.PI / 180)} stroke="#fff" strokeWidth="0.3"/>
          ))}
          <circle cx="50" cy="50" r="6" fill="#E8A87C"/>
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#fff', position: 'relative' }}>
          <BrandMark size={32} color="#E8A87C"/>
          <span className="font-display" style={{ fontSize: 24, color: '#fff' }}>Aperture</span>
        </div>
        <div style={{ position: 'relative', color: '#fff', maxWidth: 460 }}>
          <h2 className="font-display" style={{ fontSize: 44, lineHeight: 1.1, margin: 0, color: '#fff' }}>
            Every frame, accounted for.
          </h2>
          <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.7)', marginTop: 16, lineHeight: 1.6 }}>
            Sign in to monitor 8 active feeds, control PTZ, and review recordings across your sites.
          </p>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
          <span style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.3)' }}/>
          <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>v 2.4.1 · ALL SYSTEMS NOMINAL</span>
        </div>
      </aside>

      {/* Form */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '28px 36px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--color-common)' }}>Don't have an account?</span>
          <button className="btn">Create one</button>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 36px 60px' }}>
          <div style={{ width: '100%', maxWidth: 380 }}>
            <div className="label" style={{ marginBottom: 8 }}>Welcome back</div>
            <h1 className="font-display" style={{ fontSize: 36, margin: 0, color: 'var(--color-title)' }}>Sign in</h1>
            <p style={{ fontSize: 14, color: 'var(--color-muted)', marginTop: 8, marginBottom: 32 }}>
              Use your work email or a connected provider.
            </p>

            <form style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Email" placeholder="eli@aperture.io" type="email"/>
              <Field label="Password" placeholder="••••••••••••" type="password" trailingLabel="Forgot?"/>
              <button type="button" className="btn btn-primary" style={{ height: 44, justifyContent: 'center', marginTop: 6, fontWeight: 600, fontSize: 14 }}>
                Sign in <Icon name="arrow_forward" size={16}/>
              </button>
            </form>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0', color: 'var(--color-muted)', fontSize: 12 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--color-container1-border)' }}/>
              <span>or continue with</span>
              <span style={{ flex: 1, height: 1, background: 'var(--color-container1-border)' }}/>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button className="btn" style={{ justifyContent: 'center', height: 42 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>G</span> Google
              </button>
              <button className="btn" style={{ justifyContent: 'center', height: 42 }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}></span> Apple
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, placeholder, type, trailingLabel }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-title)' }}>{label}</label>
        {trailingLabel && <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--color-primary)', cursor: 'pointer', padding: 0 }}>{trailingLabel}</button>}
      </div>
      <input
        type={type || 'text'}
        placeholder={placeholder}
        style={{
          width: '100%', height: 42, padding: '0 14px',
          border: '1px solid var(--color-container1-border)',
          background: 'var(--color-container1)',
          borderRadius: 10, fontSize: 14,
          color: 'var(--color-title)',
          outline: 'none', fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

window.AuthArtboard = AuthArtboard;
