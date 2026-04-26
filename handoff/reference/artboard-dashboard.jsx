/* eslint-disable */
const { useState: useStateD } = React;

function DashboardArtboard() {
  const cams = window.cameraSeed;
  const online = cams.filter(c => c.status === 'online').length;
  const recording = cams.filter(c => c.mode === 'record').length;
  const offline = cams.filter(c => c.status === 'offline').length;

  return (
    <div className="app-surface" style={{ display: 'flex', height: '100%', minHeight: 900 }}>
      <SideRail active="dashboard"/>
      <main style={{ flex: 1, overflowY: 'auto' }} className="thin-scroll">
        <PageTopBar
          eyebrow="Operational overview"
          title="Good afternoon, Eli."
          subtitle="8 cameras across 4 zones. Two are recording, all primary feeds are online."
          actions={
            <>
              <button className="btn"><Icon name="filter_list" size={16}/>Filter</button>
              <button className="btn"><Icon name="refresh" size={16}/>Refresh</button>
              <button className="btn btn-primary"><Icon name="add" size={16}/>Add camera</button>
            </>
          }
        />

        {/* Hero stat strip — single elegant row */}
        <section style={{ padding: '0 36px 24px' }}>
          <div className="surface" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', overflow: 'hidden' }}>
            {[
              { label: 'Active feeds',    value: cams.length, sub: `${online} online · ${offline} offline`, accent: 'var(--color-title)' },
              { label: 'Currently recording', value: recording, sub: '2.1 GB written today', accent: 'var(--color-wrong)' },
              { label: 'Average uptime',  value: '99.4%', sub: 'last 30 days', accent: 'var(--color-correct)' },
              { label: 'Storage',         value: '78%', sub: '1.2 TB of 1.5 TB', accent: 'var(--color-primary)' },
            ].map((s, i) => (
              <div key={i} style={{
                padding: '24px 28px',
                borderRight: i < 3 ? '1px solid var(--color-container1-border)' : 'none',
              }}>
                <div className="label">{s.label}</div>
                <div className="font-display" style={{ fontSize: 38, lineHeight: 1.05, marginTop: 6, color: s.accent }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Section heading */}
        <section style={{ padding: '12px 36px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <h2 className="font-display" style={{ margin: 0, fontSize: 22, color: 'var(--color-title)' }}>Your cameras</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-muted)' }}>Click any feed to open the live monitor.</p>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--color-container2)', borderRadius: 10 }}>
            {['Grid', 'List', 'Map'].map((v, i) => (
              <button key={v} style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                background: i === 0 ? 'var(--color-container1)' : 'transparent',
                color: i === 0 ? 'var(--color-title)' : 'var(--color-common)',
                border: i === 0 ? '1px solid var(--color-container1-border)' : '1px solid transparent',
                borderRadius: 7, cursor: 'pointer',
              }}>{v}</button>
            ))}
          </div>
        </section>

        {/* Camera grid */}
        <section style={{ padding: '8px 36px 40px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {cams.map(c => (
              <article key={c.id} className="surface" style={{ overflow: 'hidden', cursor: 'pointer', transition: 'transform 120ms' }}>
                <CameraThumb src={c.src} status={c.status} slug={c.slug} height={160} rounded={0}/>
                <div style={{ padding: '14px 16px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-title)', letterSpacing: '-0.005em' }}>{c.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-muted)', marginTop: 2 }}>{c.loc}</div>
                    </div>
                    {c.mode === 'record' && (
                      <span className="chip chip-wrong"><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-wrong)' }}/>REC</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-container1-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--color-common)' }}>
                      <StatusDot status={c.status} pulse={c.status === 'online'}/>
                      <span>{c.status === 'offline' ? 'Offline' : `${c.uptime}`}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                      {c.fps > 0 ? `${c.fps}FPS` : '—'}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

window.DashboardArtboard = DashboardArtboard;
