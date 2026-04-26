/* eslint-disable */
function AdminArtboard() {
  const cams = window.cameraSeed;
  return (
    <div className="app-surface" style={{ display: 'flex', height: '100%', minHeight: 900 }}>
      <SideRail active="admin"/>
      <main style={{ flex: 1, overflowY: 'auto' }} className="thin-scroll">
        <PageTopBar
          eyebrow="System administration"
          title="Camera infrastructure"
          subtitle="Register cameras, monitor health, and allocate storage across the fleet."
          actions={
            <>
              <button className="btn"><Icon name="download" size={16}/>Export</button>
              <button className="btn btn-primary"><Icon name="add_a_photo" size={16}/>Add camera</button>
            </>
          }
        />

        {/* Health row */}
        <section style={{ padding: '0 36px 18px' }}>
          <div className="surface" style={{ padding: 24, display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 28 }}>
            <div>
              <div className="label">Storage</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
                <span className="font-display" style={{ fontSize: 38, color: 'var(--color-title)' }}>23.4 TB</span>
                <span style={{ fontSize: 14, color: 'var(--color-muted)' }}>of 100 TB</span>
              </div>
              <div style={{ marginTop: 14, height: 6, borderRadius: 999, background: 'var(--color-container2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '23%', background: 'var(--color-primary)', borderRadius: 999 }}/>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5, color: 'var(--color-muted)' }}>
                <span>23% utilized</span>
                <span>76.6 TB remaining</span>
              </div>
            </div>
            <HealthStat label="Cameras online" value={cams.filter(c => c.status === 'online').length} sub="of 8 total" tone="correct"/>
            <HealthStat label="Nodes offline" value={cams.filter(c => c.status === 'offline').length} sub="needs attention" tone="wrong"/>
          </div>
        </section>

        {/* Filters */}
        <section style={{ padding: '12px 36px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="font-display" style={{ margin: 0, fontSize: 22 }}>Active camera nodes</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--color-container2)', borderRadius: 10 }}>
              {['All', 'Online', 'Offline'].map((v, i) => (
                <button key={v} style={{
                  padding: '6px 14px', fontSize: 12, fontWeight: 600,
                  background: i === 0 ? 'var(--color-container1)' : 'transparent',
                  color: i === 0 ? 'var(--color-title)' : 'var(--color-common)',
                  border: i === 0 ? '1px solid var(--color-container1-border)' : '1px solid transparent',
                  borderRadius: 7, cursor: 'pointer',
                }}>{v}</button>
              ))}
            </div>
            <button className="btn"><Icon name="refresh" size={15}/>Refresh</button>
          </div>
        </section>

        {/* Table */}
        <section style={{ padding: '12px 36px 40px' }}>
          <div className="surface" style={{ overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.7fr 0.8fr 0.7fr 60px', padding: '12px 20px', borderBottom: '1px solid var(--color-container1-border)' }}>
              {['Camera', 'Address', 'Quality', 'FPS', 'Status', ''].map(h => (
                <div key={h} className="label">{h}</div>
              ))}
            </div>
            {cams.slice(0, 6).map((c, i) => (
              <div key={c.id} style={{
                display: 'grid', gridTemplateColumns: '1.6fr 1fr 0.7fr 0.8fr 0.7fr 60px',
                alignItems: 'center', padding: '12px 20px',
                borderBottom: i < 5 ? '1px solid var(--color-container1-border)' : 'none',
                background: c.status === 'offline' ? 'var(--color-wrong-soft)' : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 56, height: 36, borderRadius: 6, overflow: 'hidden', background: 'var(--color-container2)', flexShrink: 0 }}>
                    <img src={c.src} alt="" style={{
                      width: '100%', height: '100%', objectFit: 'cover',
                      filter: c.status === 'offline' ? 'grayscale(1) opacity(0.55)' : 'none',
                    }}/>
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-title)' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{c.slug}</div>
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--color-common)' }}>192.168.1.{40 + i}</div>
                <div style={{ fontSize: 12, color: 'var(--color-common)' }}>{['HIGH', 'MEDIUM', 'HIGH', 'LOW', 'MEDIUM', 'HIGH'][i]}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: c.fps > 0 ? 'var(--color-title)' : 'var(--color-muted)' }}>{c.fps > 0 ? `${c.fps}` : '—'}</div>
                <div>
                  <span className={`chip ${c.status === 'online' ? 'chip-correct' : c.status === 'idle' ? 'chip-warning' : 'chip-wrong'}`}>
                    <StatusDot status={c.status === 'idle' ? 'idle' : c.status} pulse={c.status === 'online'}/>
                    {c.status === 'online' ? 'Online' : c.status === 'idle' ? 'Idle' : 'Offline'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" style={{ padding: 6 }}><Icon name="edit" size={16}/></button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function HealthStat({ label, value, sub, tone }) {
  const color = tone === 'correct' ? 'var(--color-correct)' : tone === 'wrong' ? 'var(--color-wrong)' : 'var(--color-title)';
  return (
    <div style={{ borderLeft: '1px solid var(--color-container1-border)', paddingLeft: 28 }}>
      <div className="label">{label}</div>
      <div className="font-display" style={{ fontSize: 38, color, marginTop: 8 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function AccessArtboard() {
  const users = window.userSeed;
  const cams = window.cameraSeed;
  const selected = users[1];
  const perms = {
    '1': { p: true, c: true },  '2': { p: true, c: false },
    '3': { p: true, c: true },  '4': { p: false, c: false },
    '5': { p: true, c: false }, '6': { p: false, c: false },
    '7': { p: false, c: false }, '8': { p: false, c: false },
  };

  return (
    <div className="app-surface" style={{ display: 'flex', height: '100%', minHeight: 900 }}>
      <SideRail active="access"/>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <PageTopBar
          eyebrow="Permissions"
          title="Access matrix"
          subtitle="Assign per-user preview and control rights to each camera."
          actions={
            <>
              <button className="btn"><Icon name="filter_list" size={16}/>Filter</button>
              <button className="btn btn-primary"><Icon name="person_add" size={16}/>Invite user</button>
            </>
          }
        />
        <div style={{ flex: 1, padding: '0 36px 40px', display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, minHeight: 0 }}>
          {/* User list */}
          <div className="surface" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-container1-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--color-container2)', borderRadius: 8 }}>
                <Icon name="search" size={15} color="var(--color-muted)"/>
                <input placeholder="Search users…" style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, flex: 1, fontFamily: 'inherit' }}/>
              </div>
            </div>
            <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
              {users.map(u => {
                const active = u.id === selected.id;
                return (
                  <div key={u.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 12px', borderRadius: 10,
                    background: active ? 'var(--color-container2)' : 'transparent',
                    cursor: 'pointer', marginBottom: 2,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 12,
                      background: active ? 'var(--color-primary)' : 'var(--color-primary-soft)',
                      color: active ? '#fff' : 'var(--color-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, flexShrink: 0,
                    }}>{u.init}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)' }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{u.email}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      {u.role === 'admin' ? (
                        <span className="chip chip-primary" style={{ padding: '2px 6px', fontSize: 9.5 }}>Admin</span>
                      ) : (
                        <span style={{ fontSize: 10, color: 'var(--color-muted)', fontWeight: 600 }}>{u.cams}/8 cams</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Permissions */}
          <div className="surface" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-container1-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 14,
                  background: 'var(--color-primary-soft)', color: 'var(--color-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                }}>{selected.init}</div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-title)', letterSpacing: '-0.005em' }}>{selected.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>{selected.email} · Operator</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost">Reset</button>
                <button className="btn btn-primary">Save permissions</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px', padding: '12px 24px', borderBottom: '1px solid var(--color-container1-border)' }}>
              <div className="label">Camera</div>
              <div className="label" style={{ textAlign: 'center' }}>Preview</div>
              <div className="label" style={{ textAlign: 'center' }}>Control</div>
            </div>

            <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto' }}>
              {cams.map((c, i) => {
                const p = perms[c.id] || { p: false, c: false };
                return (
                  <div key={c.id} style={{
                    display: 'grid', gridTemplateColumns: '1fr 110px 110px',
                    alignItems: 'center', padding: '14px 24px',
                    borderBottom: i < cams.length - 1 ? '1px solid var(--color-container1-border)' : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 44, height: 28, borderRadius: 5, overflow: 'hidden', background: 'var(--color-container2)' }}>
                        <img src={c.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{c.slug} · {c.loc}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Toggle on={p.p}/>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Toggle on={p.c}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Toggle({ on }) {
  return (
    <span style={{
      width: 36, height: 20, borderRadius: 999,
      background: on ? 'var(--color-primary)' : 'var(--color-container2-border)',
      position: 'relative', display: 'inline-block', cursor: 'pointer',
      transition: 'background 120ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)', transition: 'left 120ms',
      }}/>
    </span>
  );
}

window.AdminArtboard = AdminArtboard;
window.AccessArtboard = AccessArtboard;
