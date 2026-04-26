/* eslint-disable */
function MonitorArtboard() {
  const cams = window.cameraSeed;
  const selected = cams[2]; // Server Room

  return (
    <div className="app-surface" style={{ display: 'flex', height: '100%', minHeight: 900 }}>
      <SideRail active="cameras"/>

      {/* Camera list rail */}
      <aside style={{ width: 260, borderRight: '1px solid var(--color-container1-border)', background: 'var(--color-container1)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '22px 18px 12px' }}>
          <div className="label">Live monitor</div>
          <h2 className="font-display" style={{ margin: '6px 0 0', fontSize: 22, color: 'var(--color-title)' }}>Cameras</h2>
        </div>
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', background: 'var(--color-container2)',
            border: '1px solid var(--color-container2-border)', borderRadius: 10,
          }}>
            <Icon name="search" size={16} color="var(--color-muted)"/>
            <input placeholder="Search cameras…" style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontSize: 13, color: 'var(--color-title)', fontFamily: 'inherit',
            }}/>
          </div>
        </div>

        <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 16px' }}>
          {cams.map(c => {
            const active = c.id === selected.id;
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                background: active ? 'var(--color-container2)' : 'transparent',
                marginBottom: 2,
              }}>
                <div style={{ width: 44, height: 32, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--color-container2)' }}>
                  <img src={c.src} alt="" style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                    filter: c.status === 'offline' ? 'grayscale(1) opacity(0.5)' : 'none',
                  }}/>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: active ? 600 : 500, color: 'var(--color-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{c.slug}</div>
                </div>
                <StatusDot status={c.status} pulse={c.status === 'online'}/>
              </div>
            );
          })}
        </div>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <header style={{ padding: '20px 28px', borderBottom: '1px solid var(--color-container1-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 className="font-display" style={{ margin: 0, fontSize: 26, color: 'var(--color-title)' }}>{selected.name}</h1>
              <span className="chip chip-correct"><StatusDot status="online" pulse/>Live</span>
              <span className="chip chip-wrong"><span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-wrong)' }}/>Recording 00:23:14</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
              {selected.slug} · {selected.loc} · 30 FPS · HIGH · 192.168.1.43
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn"><Icon name="fullscreen" size={16}/>Fullscreen</button>
            <button className="btn"><Icon name="photo_camera" size={16}/>Snapshot</button>
            <button className="btn btn-primary"><Icon name="stop" size={16}/>Stop preview</button>
          </div>
        </header>

        {/* Preview + side panel */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, padding: 20, overflow: 'hidden' }}>
          <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', background: '#000', display: 'flex', flexDirection: 'column' }}>
            <img src={selected.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.55) 100%)', pointerEvents: 'none' }}/>
            <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 8 }}>
              <span style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', color: '#fff', padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>HIGH · 30FPS</span>
              <span style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', color: '#fff', padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="thermostat" size={13}/> 41.2°C
              </span>
            </div>
            <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(220, 38, 38, 0.85)', backdropFilter: 'blur(8px)', padding: '5px 10px', borderRadius: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 4px rgba(255,255,255,0.25)' }}/>
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>REC 00:23:14</span>
            </div>
            {/* PTZ pad — bottom left */}
            <div style={{ position: 'absolute', bottom: 18, left: 18 }}>
              <div style={{ position: 'relative', width: 140, height: 140, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.15)' }}>
                {[
                  { d: 'top', icon: 'keyboard_arrow_up', style: { top: 8, left: '50%', transform: 'translateX(-50%)' } },
                  { d: 'bot', icon: 'keyboard_arrow_down', style: { bottom: 8, left: '50%', transform: 'translateX(-50%)' } },
                  { d: 'lef', icon: 'keyboard_arrow_left', style: { left: 8, top: '50%', transform: 'translateY(-50%)' } },
                  { d: 'rig', icon: 'keyboard_arrow_right', style: { right: 8, top: '50%', transform: 'translateY(-50%)' } },
                ].map(b => (
                  <button key={b.d} style={{
                    position: 'absolute', width: 32, height: 32, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    ...b.style,
                  }}><Icon name={b.icon} size={20} color="#fff"/></button>
                ))}
                <button style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'rgba(45,91,255,0.85)', border: '1px solid rgba(255,255,255,0.25)',
                  color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><Icon name="my_location" size={18} color="#fff"/></button>
              </div>
            </div>

            {/* Zoom rail — bottom right */}
            <div style={{ position: 'absolute', bottom: 22, right: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)', borderRadius: 12, padding: '10px 8px', border: '1px solid rgba(255,255,255,0.12)' }}>
              <button style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer' }}>+</button>
              <div style={{ width: 4, height: 100, background: 'rgba(255,255,255,0.15)', borderRadius: 999, position: 'relative' }}>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '42%', background: '#fff', borderRadius: 999 }}/>
                <div style={{ position: 'absolute', bottom: '42%', left: '50%', transform: 'translate(-50%, 50%)', width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 3px rgba(255,255,255,0.2)' }}/>
              </div>
              <button style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer' }}>−</button>
              <div style={{ fontSize: 10, color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>2.4×</div>
            </div>
          </div>

          {/* Side panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }} className="thin-scroll">
            <section className="surface" style={{ padding: 16 }}>
              <div className="label" style={{ marginBottom: 10 }}>Live telemetry</div>
              {[
                { k: 'Pan', v: '+24°' },
                { k: 'Tilt', v: '−12°' },
                { k: 'Zoom', v: '2.4×' },
                { k: 'Frame age', v: '38 ms' },
                { k: 'Last command', v: 'tiltUp · OK' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < 4 ? '1px solid var(--color-container1-border)' : 'none', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--color-muted)' }}>{r.k}</span>
                  <span style={{ color: 'var(--color-title)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{r.v}</span>
                </div>
              ))}
            </section>

            <section className="surface" style={{ padding: 16 }}>
              <div className="label" style={{ marginBottom: 12 }}>Infrared</div>
              <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--color-container2)', borderRadius: 10 }}>
                {[{ k: 'Off', a: false }, { k: 'Auto', a: true }, { k: 'On', a: false }].map(o => (
                  <button key={o.k} style={{
                    flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600,
                    background: o.a ? 'var(--color-container1)' : 'transparent',
                    color: o.a ? 'var(--color-title)' : 'var(--color-common)',
                    border: o.a ? '1px solid var(--color-container1-border)' : '1px solid transparent',
                    borderRadius: 7, cursor: 'pointer',
                  }}>{o.k}</button>
                ))}
              </div>
            </section>

            <section className="surface" style={{ padding: 16 }}>
              <div className="label" style={{ marginBottom: 12 }}>Audio</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--color-title)' }}>
                  <span>System output</span>
                  <span style={{ width: 32, height: 18, borderRadius: 999, background: 'var(--color-primary)', position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: '50%', background: '#fff' }}/>
                  </span>
                </label>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--color-title)' }}>
                  <span>Mic uplink</span>
                  <span style={{ width: 32, height: 18, borderRadius: 999, background: 'var(--color-container2-border)', position: 'relative' }}>
                    <span style={{ position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: '50%', background: '#fff' }}/>
                  </span>
                </label>
              </div>
            </section>

            <section className="surface" style={{ padding: 16 }}>
              <div className="label" style={{ marginBottom: 12 }}>Recording</div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', background: 'var(--color-wrong)', borderColor: 'var(--color-wrong)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#fff' }}/>
                Stop recording
              </button>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--color-muted)', textAlign: 'center' }}>Started 00:23:14 ago · 412 MB</div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

window.MonitorArtboard = MonitorArtboard;
