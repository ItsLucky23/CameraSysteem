/* eslint-disable */
function MobileFrame({ children, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 360, height: 740,
        background: '#1A1A1A',
        borderRadius: 42,
        padding: 9,
        boxShadow: '0 24px 50px -18px rgba(0,0,0,0.22), inset 0 0 0 2px rgba(255,255,255,0.04)',
      }}>
        <div style={{
          width: '100%', height: '100%',
          background: 'var(--color-background)',
          borderRadius: 34,
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 40,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0 22px', fontSize: 12.5, fontWeight: 600, color: 'var(--color-title)',
            zIndex: 10,
          }}>
            <span>9:41</span>
            <span style={{ width: 92, height: 24, background: '#1A1A1A', borderRadius: 14 }}/>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <Icon name="signal_cellular_alt" size={13}/>
              <Icon name="wifi" size={13}/>
              <Icon name="battery_full" size={15}/>
            </div>
          </div>
          <div style={{ paddingTop: 40, height: '100%', overflow: 'hidden' }}>{children}</div>
        </div>
      </div>
      {label && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', fontWeight: 500, fontFamily: 'var(--font-sans)' }}>
          {label}
        </div>
      )}
    </div>
  );
}

function TabBar({ active = 'dashboard' }) {
  const tabs = [
    { i: 'dashboard', l: 'Home',     k: 'dashboard' },
    { i: 'videocam',  l: 'Cameras',  k: 'cameras' },
    { i: 'movie',     l: 'Recordings', k: 'rec' },
    { i: 'settings',  l: 'Settings', k: 'settings' },
  ];
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-around', padding: '8px 12px 22px',
      borderTop: '1px solid var(--color-container1-border)', background: 'var(--color-container1)',
    }}>
      {tabs.map(t => (
        <div key={t.k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, color: t.k === active ? 'var(--color-primary)' : 'var(--color-muted)' }}>
          <Icon name={t.i} size={20}/>
          <span style={{ fontSize: 9.5, fontWeight: t.k === active ? 600 : 500 }}>{t.l}</span>
        </div>
      ))}
    </div>
  );
}

function MAvatar({ init, size = 32, active }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size/3,
      background: active ? 'var(--color-primary)' : 'var(--color-primary-soft)',
      color: active ? '#fff' : 'var(--color-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, flexShrink: 0,
    }}>{init}</div>
  );
}

function PhoneShell({ children, tab }) {
  return (
    <div className="app-surface" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>{children}</div>
      <TabBar active={tab}/>
    </div>
  );
}

// ---------- Dashboard ----------
function MobileDashboard() {
  const cams = window.cameraSeed.slice(0, 4);
  return (
    <PhoneShell tab="dashboard">
      <div style={{ padding: '14px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark small/>
        <MAvatar init="EM" size={34}/>
      </div>
      <div style={{ padding: '6px 18px 0' }}>
        <div className="label">Tuesday afternoon</div>
        <h1 className="font-display" style={{ margin: '4px 0 14px', fontSize: 28, color: 'var(--color-title)', lineHeight: 1.05 }}>
          All eyes<br/>on watch.
        </h1>
      </div>
      <div style={{ padding: '0 18px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { l: 'Online', v: '7', tone: 'var(--color-correct)' },
          { l: 'Recording', v: '2', tone: 'var(--color-wrong)' },
          { l: 'Offline', v: '1', tone: 'var(--color-muted)' },
        ].map(s => (
          <div key={s.l} className="surface" style={{ padding: 12 }}>
            <div className="font-display" style={{ fontSize: 26, color: s.tone, lineHeight: 1 }}>{s.v}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '20px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Cameras</h2>
        <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--color-primary)', fontWeight: 600 }}>See all</button>
      </div>
      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 18px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {cams.map(c => (
            <div key={c.id} className="surface" style={{ overflow: 'hidden' }}>
              <CameraThumb src={c.src} status={c.status} height={88} rounded={0}/>
              <div style={{ padding: '8px 10px 10px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-title)' }}>{c.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <StatusDot status={c.status} pulse={c.status === 'online'}/>
                  <span style={{ fontSize: 10, color: 'var(--color-muted)' }}>{c.status === 'offline' ? 'Offline' : `${c.fps}fps`}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PhoneShell>
  );
}

// ---------- Monitor (Live) ----------
function MobileMonitor() {
  const cam = window.cameraSeed[2];
  return (
    <PhoneShell tab="cameras">
      <div style={{ padding: '8px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost" style={{ padding: 6 }}><Icon name="arrow_back" size={20}/></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-title)' }}>{cam.name}</div>
          <div style={{ fontSize: 10.5, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{cam.slug} · LIVE · 30FPS</div>
        </div>
        <button className="btn btn-ghost" style={{ padding: 6 }}><Icon name="more_horiz" size={20}/></button>
      </div>

      <div style={{ position: 'relative', margin: '0 14px', borderRadius: 16, overflow: 'hidden', height: 200, background: '#000' }}>
        <img src={cam.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(220,38,38,0.85)', backdropFilter: 'blur(8px)', padding: '4px 8px', borderRadius: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }}/>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>REC 23:14</span>
        </div>
        <button style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 8, background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff' }}><Icon name="fullscreen" size={15}/></button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0 8px' }}>
        <div style={{ position: 'relative', width: 180, height: 180, borderRadius: '50%', background: 'var(--color-container2)' }}>
          {[
            { d: 'top', icon: 'keyboard_arrow_up', s: { top: 10, left: '50%', transform: 'translateX(-50%)' } },
            { d: 'bot', icon: 'keyboard_arrow_down', s: { bottom: 10, left: '50%', transform: 'translateX(-50%)' } },
            { d: 'lef', icon: 'keyboard_arrow_left', s: { left: 10, top: '50%', transform: 'translateY(-50%)' } },
            { d: 'rig', icon: 'keyboard_arrow_right', s: { right: 10, top: '50%', transform: 'translateY(-50%)' } },
          ].map(b => (
            <button key={b.d} style={{
              position: 'absolute', width: 40, height: 40, borderRadius: '50%',
              background: 'var(--color-container1)', border: '1px solid var(--color-container1-border)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              ...b.s,
            }}><Icon name={b.icon} size={20} color="var(--color-title)"/></button>
          ))}
          <button style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--color-primary)', border: 'none', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name="my_location" size={22} color="#fff"/></button>
        </div>
      </div>

      <div style={{ padding: '0 14px 6px' }}>
        <div className="label" style={{ marginBottom: 8 }}>Quick actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            { i: 'flare', l: 'IR Auto', a: true },
            { i: 'volume_up', l: 'Audio' },
            { i: 'mic_off', l: 'Mic off' },
          ].map(o => (
            <button key={o.l} style={{
              padding: '12px 6px', borderRadius: 12,
              background: o.a ? 'var(--color-primary-soft)' : 'var(--color-container2)',
              border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              color: o.a ? 'var(--color-primary)' : 'var(--color-common)',
            }}>
              <Icon name={o.i} size={20}/>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{o.l}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }}/>
      <div style={{ padding: '8px 14px 12px' }}>
        <button style={{
          width: '100%', height: 48, border: 'none', borderRadius: 12,
          background: 'var(--color-wrong)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: '#fff' }}/>
          Stop recording
        </button>
      </div>
    </PhoneShell>
  );
}

// ---------- Recordings (timeline) ----------
function MobileRecordings() {
  const cam = window.cameraSeed[5];
  const recordings = [
    { id: 'r1', t: '14:22', dur: '00:23:14', size: '412 MB', cam: 'Conf Room', live: true },
    { id: 'r2', t: '11:08', dur: '00:14:02', size: '241 MB', cam: 'Front Entrance' },
    { id: 'r3', t: '09:41', dur: '00:08:55', size: '128 MB', cam: 'Server Room' },
    { id: 'r4', t: '07:30', dur: '01:12:38', size: '1.6 GB', cam: 'Loading Bay' },
  ];
  return (
    <PhoneShell tab="rec">
      <div style={{ padding: '14px 18px 8px' }}>
        <div className="label">Today</div>
        <h1 className="font-display" style={{ margin: '4px 0 0', fontSize: 28, color: 'var(--color-title)', lineHeight: 1.05 }}>Recordings</h1>
      </div>

      {/* Day selector */}
      <div style={{ padding: '12px 18px 4px' }}>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }} className="thin-scroll">
          {[
            { d: 'Mon', n: '20' },
            { d: 'Tue', n: '21', a: true },
            { d: 'Wed', n: '22' },
            { d: 'Thu', n: '23' },
            { d: 'Fri', n: '24' },
            { d: 'Sat', n: '25' },
            { d: 'Sun', n: '26' },
          ].map(d => (
            <button key={d.n} style={{
              flexShrink: 0, padding: '8px 12px', borderRadius: 12,
              background: d.a ? 'var(--color-primary)' : 'var(--color-container2)',
              border: 'none', color: d.a ? '#fff' : 'var(--color-title)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 48,
            }}>
              <span style={{ fontSize: 9.5, fontWeight: 600, opacity: d.a ? 0.9 : 0.6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.d}</span>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{d.n}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Timeline visualization */}
      <div style={{ padding: '12px 18px 8px' }}>
        <div className="surface" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
          </div>
          <div style={{ position: 'relative', height: 28, background: 'var(--color-container2)', borderRadius: 6, overflow: 'hidden' }}>
            {[
              { l: '5%', w: '12%', tone: 'var(--color-primary)' },
              { l: '32%', w: '8%', tone: 'var(--color-correct)' },
              { l: '46%', w: '18%', tone: 'var(--color-primary)' },
              { l: '70%', w: '4%', tone: 'var(--color-wrong)' },
              { l: '78%', w: '15%', tone: 'var(--color-correct)' },
            ].map((b, i) => (
              <div key={i} style={{ position: 'absolute', top: 4, bottom: 4, left: b.l, width: b.w, background: b.tone, borderRadius: 3, opacity: 0.85 }}/>
            ))}
            <div style={{ position: 'absolute', top: -2, bottom: -2, left: '60%', width: 2, background: 'var(--color-title)' }}/>
          </div>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
            <span style={{ color: 'var(--color-muted)' }}>4 clips · 2.3 GB</span>
            <span style={{ color: 'var(--color-title)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>14:22</span>
          </div>
        </div>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 18px 16px' }}>
        {recordings.map((r, i) => (
          <div key={r.id} className="surface" style={{
            padding: 12, display: 'flex', alignItems: 'center', gap: 12,
            marginBottom: 8,
            borderColor: r.live ? 'var(--color-wrong)' : 'var(--color-container1-border)',
            borderWidth: r.live ? 1.5 : 1,
          }}>
            <div style={{ width: 56, height: 40, borderRadius: 6, overflow: 'hidden', background: 'var(--color-container2)', flexShrink: 0, position: 'relative' }}>
              <img src={window.cameraSeed[i % 4].src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
              {r.live && <span style={{ position: 'absolute', top: 3, left: 3, width: 5, height: 5, borderRadius: '50%', background: 'var(--color-wrong)', boxShadow: '0 0 0 3px rgba(220,38,38,0.25)' }}/>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)' }}>{r.cam}</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{r.t} · {r.dur} · {r.size}</div>
            </div>
            <Icon name="play_arrow" size={22} color="var(--color-primary)"/>
          </div>
        ))}
      </div>
    </PhoneShell>
  );
}

// ---------- Sign In ----------
function MobileLogin() {
  return (
    <div className="app-surface" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '36px 0 28px' }}>
        <BrandMark size={40}/>
      </div>
      <div className="label" style={{ textAlign: 'center' }}>Welcome to Aperture</div>
      <h1 className="font-display" style={{ fontSize: 30, textAlign: 'center', margin: '6px 0 28px', lineHeight: 1.05 }}>Sign in to your watch.</h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Email" placeholder="eli@aperture.io"/>
        <Field label="Password" placeholder="••••••••" type="password"/>
        <button className="btn btn-primary" style={{ height: 48, justifyContent: 'center', fontSize: 14, fontWeight: 600, marginTop: 8 }}>
          Sign in
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0', color: 'var(--color-muted)', fontSize: 11 }}>
        <span style={{ flex: 1, height: 1, background: 'var(--color-container1-border)' }}/>
        <span>or continue with</span>
        <span style={{ flex: 1, height: 1, background: 'var(--color-container1-border)' }}/>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button className="btn" style={{ justifyContent: 'center', height: 44 }}><span style={{ fontWeight: 700 }}>G</span> Google</button>
        <button className="btn" style={{ justifyContent: 'center', height: 44 }}><span style={{ fontWeight: 700, fontSize: 14 }}></span> Apple</button>
      </div>

      <div style={{ flex: 1 }}/>
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-muted)', padding: '14px 0 22px' }}>
        New here? <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Create an account</span>
      </div>
    </div>
  );
}

// ---------- Admin: Camera list ----------
function MobileAdminList() {
  const cams = window.cameraSeed.slice(0, 5);
  return (
    <PhoneShell tab="settings">
      <div style={{ padding: '14px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="label">Administration</div>
          <h1 className="font-display" style={{ margin: '4px 0 0', fontSize: 26, color: 'var(--color-title)', lineHeight: 1.05 }}>Cameras</h1>
        </div>
        <button style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--color-primary)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="add" size={22} color="#fff"/>
        </button>
      </div>

      {/* Storage callout */}
      <div style={{ padding: '12px 18px 4px' }}>
        <div className="surface" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="label">Storage</span>
            <span style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>23.4 / 100 TB</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: 'var(--color-container2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '23%', background: 'var(--color-primary)', borderRadius: 999 }}/>
          </div>
        </div>
      </div>

      <div style={{ padding: '10px 18px 6px', display: 'flex', gap: 6, overflowX: 'auto' }} className="thin-scroll">
        {['All · 8', 'Online · 6', 'Offline · 1', 'Idle · 1'].map((f, i) => (
          <button key={f} style={{
            flexShrink: 0, padding: '6px 12px', borderRadius: 999,
            background: i === 0 ? 'var(--color-title)' : 'var(--color-container2)',
            border: 'none', color: i === 0 ? '#fff' : 'var(--color-common)',
            fontSize: 11.5, fontWeight: 600,
          }}>{f}</button>
        ))}
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 18px 16px' }}>
        {cams.map(c => (
          <div key={c.id} className="surface" style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: 10,
            marginBottom: 8,
            background: c.status === 'offline' ? 'var(--color-wrong-soft)' : 'var(--color-container1)',
            borderColor: c.status === 'offline' ? 'rgba(220,38,38,0.18)' : 'var(--color-container1-border)',
          }}>
            <div style={{ width: 56, height: 44, borderRadius: 8, overflow: 'hidden', background: 'var(--color-container2)', flexShrink: 0 }}>
              <img src={c.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: c.status === 'offline' ? 'grayscale(1) opacity(0.55)' : 'none' }}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)' }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{c.slug} · {c.loc}</div>
            </div>
            <span className={`chip ${c.status === 'online' ? 'chip-correct' : c.status === 'idle' ? 'chip-warning' : 'chip-wrong'}`} style={{ fontSize: 9 }}>
              <StatusDot status={c.status === 'idle' ? 'idle' : c.status} pulse={c.status === 'online'}/>
              {c.status === 'online' ? 'Live' : c.status === 'idle' ? 'Idle' : 'Off'}
            </span>
          </div>
        ))}
      </div>
    </PhoneShell>
  );
}

// ---------- Admin: Camera detail / edit ----------
function MobileAdminDetail() {
  const c = window.cameraSeed[0];
  return (
    <div className="app-surface" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost" style={{ padding: 6 }}><Icon name="arrow_back" size={20}/></button>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--color-title)' }}>Edit camera</div>
        <button style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 13, fontWeight: 600 }}>Save</button>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 20px' }}>
        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', height: 160, background: '#000', marginBottom: 16 }}>
          <img src={c.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
          <button style={{ position: 'absolute', bottom: 10, right: 10, padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', fontSize: 11, fontWeight: 600 }}>Replace</button>
        </div>

        <SectionLabel>Identity</SectionLabel>
        <Field label="Name" value={c.name}/>
        <Field label="Slug" value={c.slug} readOnly/>
        <Field label="Location" value={c.loc}/>

        <SectionLabel>Connection</SectionLabel>
        <Field label="IP address" value="192.168.1.40"/>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Port" value="554"/>
          <Field label="FPS" value="24"/>
        </div>

        <SectionLabel>Quality</SectionLabel>
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--color-container2)', borderRadius: 10, marginBottom: 16 }}>
          {[{ k: 'Low' }, { k: 'Medium' }, { k: 'High', a: true }].map(o => (
            <button key={o.k} style={{
              flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600,
              background: o.a ? 'var(--color-container1)' : 'transparent',
              color: o.a ? 'var(--color-title)' : 'var(--color-common)',
              border: o.a ? '1px solid var(--color-container1-border)' : '1px solid transparent',
              borderRadius: 7, cursor: 'pointer',
            }}>{o.k}</button>
          ))}
        </div>

        <button style={{
          width: '100%', height: 46, border: '1px solid rgba(220,38,38,0.25)', borderRadius: 12,
          background: 'var(--color-wrong-soft)', color: 'var(--color-wrong)',
          fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginTop: 10,
        }}>Remove camera</button>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div className="label" style={{ marginTop: 18, marginBottom: 8 }}>{children}</div>;
}

// ---------- Access: User list ----------
function MobileAccessList() {
  const users = window.userSeed;
  return (
    <PhoneShell tab="settings">
      <div style={{ padding: '14px 18px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="label">Permissions</div>
          <h1 className="font-display" style={{ margin: '4px 0 0', fontSize: 26, color: 'var(--color-title)', lineHeight: 1.05 }}>Access</h1>
        </div>
        <button style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--color-primary)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="person_add" size={20} color="#fff"/>
        </button>
      </div>

      <div style={{ padding: '12px 18px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--color-container2)', borderRadius: 10 }}>
          <Icon name="search" size={16} color="var(--color-muted)"/>
          <input placeholder="Search users…" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, fontFamily: 'inherit' }}/>
        </div>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 16px' }}>
        {users.map(u => (
          <div key={u.id} className="surface" style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 12px',
            marginBottom: 8,
          }}>
            <MAvatar init={u.init} size={38}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-title)' }}>{u.name}</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{u.email}</div>
            </div>
            {u.role === 'admin' ? (
              <span className="chip chip-primary" style={{ fontSize: 9 }}>Admin</span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--color-muted)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{u.cams}/8</span>
            )}
            <Icon name="chevron_right" size={18} color="var(--color-muted)"/>
          </div>
        ))}
      </div>
    </PhoneShell>
  );
}

// ---------- Access: Per-user permission matrix ----------
function MobileAccessMatrix() {
  const u = window.userSeed[1];
  const cams = window.cameraSeed;
  const perms = { '1': { p: true, c: true }, '2': { p: true, c: false }, '3': { p: true, c: true }, '4': { p: false, c: false }, '5': { p: true, c: false }, '6': { p: false, c: false }, '7': { p: false, c: false }, '8': { p: false, c: false } };

  return (
    <div className="app-surface" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost" style={{ padding: 6 }}><Icon name="arrow_back" size={20}/></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-title)' }}>{u.name}</div>
          <div style={{ fontSize: 10.5, color: 'var(--color-muted)' }}>{u.email}</div>
        </div>
        <button style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 13, fontWeight: 600 }}>Save</button>
      </div>

      {/* User card */}
      <div style={{ padding: '4px 18px 12px' }}>
        <div className="surface" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <MAvatar init={u.init} size={48}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-title)' }}>{u.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>Operator · 5 of 8 cameras</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 18px 8px', display: 'grid', gridTemplateColumns: '1fr 56px 56px', alignItems: 'center' }}>
        <div className="label">Camera</div>
        <div className="label" style={{ textAlign: 'center', fontSize: 9.5 }}>View</div>
        <div className="label" style={{ textAlign: 'center', fontSize: 9.5 }}>Ctrl</div>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 18px 16px' }}>
        <div className="surface" style={{ padding: 0, overflow: 'hidden' }}>
          {cams.map((c, i) => {
            const p = perms[c.id] || { p: false, c: false };
            return (
              <div key={c.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 56px 56px',
                alignItems: 'center', padding: '10px 12px',
                borderBottom: i < cams.length - 1 ? '1px solid var(--color-container1-border)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ width: 40, height: 26, borderRadius: 5, overflow: 'hidden', background: 'var(--color-container2)', flexShrink: 0 }}>
                    <img src={c.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 9.5, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{c.slug}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}><MToggle on={p.p}/></div>
                <div style={{ display: 'flex', justifyContent: 'center' }}><MToggle on={p.c}/></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MToggle({ on }) {
  return (
    <span style={{
      width: 32, height: 18, borderRadius: 999,
      background: on ? 'var(--color-primary)' : 'var(--color-container2-border)',
      position: 'relative', display: 'inline-block',
      transition: 'background 120ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      }}/>
    </span>
  );
}

// ---------- Settings: Index ----------
function MobileSettings() {
  const sections = [
    { i: 'person', l: 'Profile', sub: 'Eli Marek · eli@aperture.io' },
    { i: 'palette', l: 'Appearance', sub: 'Light · Aperture' },
    { i: 'language', l: 'Language', sub: 'English' },
    { i: 'notifications', l: 'Notifications', sub: 'Mobile + email · 4 active' },
    { i: 'devices', l: 'Sessions', sub: '2 devices' },
    { i: 'lock', l: 'Security', sub: 'Two-factor on' },
  ];
  return (
    <PhoneShell tab="settings">
      <div style={{ padding: '14px 18px 6px' }}>
        <div className="label">Account</div>
        <h1 className="font-display" style={{ margin: '4px 0 14px', fontSize: 28, color: 'var(--color-title)', lineHeight: 1.05 }}>Settings</h1>
      </div>

      {/* Profile card */}
      <div style={{ padding: '0 18px 12px' }}>
        <div className="surface" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #E8A87C 0%, #2D5BFF 100%)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-display)',
          }}>EM</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--color-title)' }}>Eli Marek</div>
            <div style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>eli@aperture.io</div>
            <span className="chip chip-primary" style={{ marginTop: 4, fontSize: 9 }}>Admin</span>
          </div>
        </div>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 18px 16px' }}>
        <div className="surface" style={{ overflow: 'hidden' }}>
          {sections.map((s, i) => (
            <div key={s.l} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px',
              borderBottom: i < sections.length - 1 ? '1px solid var(--color-container1-border)' : 'none',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'var(--color-container2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-common)', flexShrink: 0,
              }}><Icon name={s.i} size={19}/></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)' }}>{s.l}</div>
                <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 1 }}>{s.sub}</div>
              </div>
              <Icon name="chevron_right" size={18} color="var(--color-muted)"/>
            </div>
          ))}
        </div>

        <button style={{
          width: '100%', height: 44, marginTop: 12,
          border: 'none', borderRadius: 12,
          background: 'var(--color-container2)',
          color: 'var(--color-wrong)', fontSize: 13.5, fontWeight: 600,
        }}>Sign out</button>
      </div>
    </PhoneShell>
  );
}

// ---------- Settings: Appearance detail ----------
function MobileAppearance() {
  return (
    <div className="app-surface" style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 14px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-ghost" style={{ padding: 6 }}><Icon name="arrow_back" size={20}/></button>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--color-title)' }}>Appearance</div>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 18px 20px' }}>
        <SectionLabel>Theme</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { k: 'light', label: 'Light', bg: '#FAFAF8', fg: '#1A1A1A', accent: '#2D5BFF', a: true },
            { k: 'dark', label: 'Aperture Dark', bg: '#1B1426', fg: '#F4EEFF', accent: '#8B5DFF' },
          ].map(t => (
            <div key={t.k} style={{
              border: t.a ? '2px solid var(--color-primary)' : '1px solid var(--color-container1-border)',
              borderRadius: 14, padding: 4,
            }}>
              <div style={{ background: t.bg, borderRadius: 10, padding: 12, height: 100, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ width: 40, height: 5, background: t.fg, opacity: 0.85, borderRadius: 3 }}/>
                  <div style={{ width: 70, height: 4, background: t.fg, opacity: 0.4, borderRadius: 3, marginTop: 4 }}/>
                </div>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: t.accent }}/>
              </div>
              <div style={{ padding: '8px 6px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-title)' }}>{t.label}</span>
                {t.a && <Icon name="check_circle" size={14} color="var(--color-primary)"/>}
              </div>
            </div>
          ))}
        </div>

        <SectionLabel>Language</SectionLabel>
        <div className="surface" style={{ overflow: 'hidden' }}>
          {[
            { k: 'EN', n: 'English', a: true },
            { k: 'NL', n: 'Nederlands' },
            { k: 'DE', n: 'Deutsch' },
            { k: 'FR', n: 'Français' },
          ].map((l, i) => (
            <div key={l.k} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
              borderBottom: i < 3 ? '1px solid var(--color-container1-border)' : 'none',
            }}>
              <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)', width: 24 }}>{l.k}</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--color-title)', fontWeight: l.a ? 600 : 500 }}>{l.n}</span>
              {l.a && <Icon name="check" size={18} color="var(--color-primary)"/>}
            </div>
          ))}
        </div>

        <SectionLabel>Density</SectionLabel>
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--color-container2)', borderRadius: 10 }}>
          {[{ k: 'Compact' }, { k: 'Comfortable', a: true }, { k: 'Spacious' }].map(o => (
            <button key={o.k} style={{
              flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600,
              background: o.a ? 'var(--color-container1)' : 'transparent',
              color: o.a ? 'var(--color-title)' : 'var(--color-common)',
              border: o.a ? '1px solid var(--color-container1-border)' : '1px solid transparent',
              borderRadius: 7, cursor: 'pointer',
            }}>{o.k}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Layouts ----------
function MobilePair({ frames }) {
  return (
    <div style={{ display: 'flex', gap: 28, padding: '36px 28px', background: 'transparent', alignItems: 'flex-start' }}>
      {frames.map((f, i) => (
        <MobileFrame key={i} label={f.label}>{f.children}</MobileFrame>
      ))}
    </div>
  );
}

function MobileTrio() {
  return <MobilePair frames={[
    { label: 'Dashboard',    children: <MobileDashboard/> },
    { label: 'Live monitor', children: <MobileMonitor/> },
    { label: 'Sign in',      children: <MobileLogin/> },
  ]}/>;
}

function MobileMonitorPair() {
  return <MobilePair frames={[
    { label: 'Live monitor + PTZ', children: <MobileMonitor/> },
    { label: 'Recordings timeline', children: <MobileRecordings/> },
  ]}/>;
}

function MobileAdminPair() {
  return <MobilePair frames={[
    { label: 'Camera list',   children: <MobileAdminList/> },
    { label: 'Edit camera',   children: <MobileAdminDetail/> },
  ]}/>;
}

function MobileAccessPair() {
  return <MobilePair frames={[
    { label: 'Users',          children: <MobileAccessList/> },
    { label: 'Permissions',    children: <MobileAccessMatrix/> },
  ]}/>;
}

function MobileSettingsPair() {
  return <MobilePair frames={[
    { label: 'Settings index',  children: <MobileSettings/> },
    { label: 'Appearance',      children: <MobileAppearance/> },
  ]}/>;
}

window.MobileTrio = MobileTrio;
window.MobileMonitorPair = MobileMonitorPair;
window.MobileAdminPair = MobileAdminPair;
window.MobileAccessPair = MobileAccessPair;
window.MobileSettingsPair = MobileSettingsPair;
