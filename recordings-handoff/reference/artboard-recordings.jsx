/* eslint-disable */
function RecordingsArtboard() {
  const cams = window.cameraSeed;
  const clips = [
    { id: 'r1', cam: cams[5], t: '14:22', dur: '00:23:14', size: '412 MB', by: 'Eli Marek',   active: true,  reason: '—' },
    { id: 'r2', cam: cams[0], t: '11:08', dur: '00:14:02', size: '241 MB', by: 'Tomás Reyes', reason: 'Manual stop' },
    { id: 'r3', cam: cams[2], t: '09:41', dur: '00:08:55', size: '128 MB', by: 'Priya Anand', reason: 'Motion ended' },
    { id: 'r4', cam: cams[1], t: '07:30', dur: '01:12:38', size: '1.6 GB', by: 'Jordan Vance', reason: 'Schedule' },
    { id: 'r5', cam: cams[6], t: '06:14', dur: '00:04:21', size: '64 MB',  by: 'Hana Okafor',  reason: 'Manual stop' },
    { id: 'r6', cam: cams[5], t: '02:08', dur: '00:31:09', size: '548 MB', by: 'Eli Marek',    reason: 'Disk full' },
  ];
  const selected = clips[0];

  return (
    <div className="app-surface" style={{ display: 'flex', height: '100%', minHeight: 900 }}>
      <SideRail active="recordings"/>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <PageTopBar
          eyebrow="Archive"
          title="Recordings"
          subtitle="Scrub the day, replay any clip, and manage the storage that keeps it all."
          actions={
            <>
              <button className="btn"><Icon name="filter_list" size={16}/>Filter</button>
              <button className="btn"><Icon name="download" size={16}/>Export day</button>
            </>
          }
        />

        {/* Storage + day picker */}
        <section style={{ padding: '0 36px 16px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          <div className="surface" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 24 }}>
            <div>
              <div className="label">Storage</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                <span className="font-display" style={{ fontSize: 32, color: 'var(--color-title)' }}>23.4 TB</span>
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>of 100 TB</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--color-container2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '23%', background: 'var(--color-primary)', borderRadius: 999 }}/>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5, color: 'var(--color-muted)' }}>
                <span>2.3 GB written today</span>
                <span>76.6 TB remaining</span>
              </div>
            </div>
          </div>

          <div className="surface" style={{ padding: 14, display: 'flex', gap: 6, overflowX: 'auto' }} className="thin-scroll">
            {[
              { d: 'Mon', n: '20', clips: 4 },
              { d: 'Tue', n: '21', clips: 6, a: true },
              { d: 'Wed', n: '22', clips: 3 },
              { d: 'Thu', n: '23', clips: 0 },
              { d: 'Fri', n: '24', clips: 5 },
              { d: 'Sat', n: '25', clips: 2 },
              { d: 'Sun', n: '26', clips: 1 },
            ].map(d => (
              <button key={d.n} style={{
                flex: 1, minWidth: 56, padding: '8px 6px', borderRadius: 10,
                background: d.a ? 'var(--color-primary)' : 'transparent',
                border: d.a ? 'none' : '1px solid var(--color-container1-border)',
                color: d.a ? '#fff' : 'var(--color-title)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                cursor: 'pointer',
              }}>
                <span style={{ fontSize: 9.5, fontWeight: 600, opacity: d.a ? 0.85 : 0.55, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d.d}</span>
                <span className="font-display" style={{ fontSize: 18 }}>{d.n}</span>
                <span style={{ fontSize: 9.5, opacity: d.a ? 0.85 : 0.5, fontFamily: 'var(--font-mono)' }}>{d.clips} clips</span>
              </button>
            ))}
          </div>
        </section>

        {/* Timeline scrubber */}
        <section style={{ padding: '4px 36px 16px' }}>
          <div className="surface" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div className="label">Tuesday · 24-hour timeline</div>
              <div style={{ fontSize: 12, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>Playhead 14:22 · 2.3 GB</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
              {['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00'].map(h => <span key={h}>{h}</span>)}
            </div>
            {/* per-camera lanes */}
            {cams.slice(0, 4).map((c, ci) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, alignItems: 'center', marginTop: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--color-common)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ position: 'relative', height: 18, background: 'var(--color-container2)', borderRadius: 4, overflow: 'hidden' }}>
                  {[
                    [{ l: '5%',  w: '8%',  t: 'var(--color-primary)' }, { l: '32%', w: '6%',  t: 'var(--color-correct)' }, { l: '60%', w: '12%', t: 'var(--color-primary)' }],
                    [{ l: '12%', w: '4%',  t: 'var(--color-correct)' }, { l: '46%', w: '18%', t: 'var(--color-primary)' }],
                    [{ l: '8%',  w: '3%',  t: 'var(--color-correct)' }, { l: '70%', w: '4%',  t: 'var(--color-wrong)' },   { l: '78%', w: '15%', t: 'var(--color-correct)' }],
                    [{ l: '20%', w: '20%', t: 'var(--color-primary)' }],
                  ][ci].map((b, i) => (
                    <div key={i} style={{ position: 'absolute', top: 3, bottom: 3, left: b.l, width: b.w, background: b.t, borderRadius: 2, opacity: 0.85 }}/>
                  ))}
                </div>
              </div>
            ))}
            {/* playhead */}
            <div style={{ position: 'relative', height: 0 }}>
              <div style={{ position: 'absolute', left: 'calc(140px + 12px + 60%)', top: -118, height: 118, width: 2, background: 'var(--color-title)' }}/>
            </div>
          </div>
        </section>

        {/* Clip list + preview */}
        <section style={{ flex: 1, padding: '0 36px 36px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, minHeight: 0 }}>
          {/* Table */}
          <div className="surface" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-container1-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 className="font-display" style={{ margin: 0, fontSize: 20 }}>{clips.length} clips</h2>
              <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--color-container2)', borderRadius: 8 }}>
                {['All', 'Manual', 'Motion', 'Schedule'].map((v, i) => (
                  <button key={v} style={{
                    padding: '4px 12px', fontSize: 11.5, fontWeight: 600,
                    background: i === 0 ? 'var(--color-container1)' : 'transparent',
                    color: i === 0 ? 'var(--color-title)' : 'var(--color-common)',
                    border: i === 0 ? '1px solid var(--color-container1-border)' : '1px solid transparent',
                    borderRadius: 6, cursor: 'pointer',
                  }}>{v}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.8fr 0.7fr 0.9fr 60px', padding: '10px 20px', borderBottom: '1px solid var(--color-container1-border)' }}>
              {['Camera · Started', 'Duration', 'Size', 'By', 'Stop reason', ''].map(h => <div key={h} className="label">{h}</div>)}
            </div>
            <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto' }}>
              {clips.map((r, i) => {
                const isSel = r.id === selected.id;
                return (
                  <div key={r.id} style={{
                    display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.8fr 0.7fr 0.9fr 60px',
                    alignItems: 'center', padding: '12px 20px',
                    borderBottom: i < clips.length - 1 ? '1px solid var(--color-container1-border)' : 'none',
                    background: isSel ? 'var(--color-primary-soft)' : (r.active ? 'var(--color-wrong-soft)' : 'transparent'),
                    cursor: 'pointer',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <div style={{ width: 48, height: 30, borderRadius: 5, overflow: 'hidden', background: 'var(--color-container2)', flexShrink: 0, position: 'relative' }}>
                        <img src={r.cam.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                        {r.active && <span style={{ position: 'absolute', top: 3, left: 3, width: 5, height: 5, borderRadius: '50%', background: 'var(--color-wrong)', boxShadow: '0 0 0 3px rgba(194,52,43,0.25)' }}/>}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cam.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{r.t} · {r.cam.slug}</div>
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--color-title)' }}>{r.dur}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--color-common)' }}>{r.size}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-common)' }}>{r.by}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                      {r.active
                        ? <span className="chip chip-wrong"><StatusDot status="rec" pulse/>Recording</span>
                        : r.reason}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                      <button className="btn btn-ghost" style={{ padding: 6 }}><Icon name="play_arrow" size={16}/></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Preview pane */}
          <div className="surface" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-container1-border)' }}>
              <div className="label">Selected clip</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-title)', marginTop: 4 }}>{selected.cam.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{selected.cam.slug} · started 14:22 · in progress</div>
            </div>
            <div style={{ position: 'relative', margin: 16, borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '16/9' }}>
              <img src={selected.cam.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
              <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(194,52,43,0.85)', padding: '4px 8px', borderRadius: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }}/>
                <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>REC 23:14</span>
              </div>
            </div>
            <div style={{ padding: '0 20px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center', padding: '6px 0 14px' }}>
                <button className="btn btn-ghost" style={{ padding: 8 }}><Icon name="skip_previous" size={20}/></button>
                <button style={{ width: 44, height: 44, borderRadius: '50%', border: 'none', background: 'var(--color-primary)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="play_arrow" size={22} color="#fff"/></button>
                <button className="btn btn-ghost" style={{ padding: 8 }}><Icon name="skip_next" size={20}/></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                {[
                  ['Duration', selected.dur],
                  ['Size', selected.size],
                  ['Started by', selected.by],
                  ['Reason', selected.active ? 'In progress' : selected.reason],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--color-container2)', borderRadius: 8 }}>
                    <span style={{ color: 'var(--color-muted)' }}>{k}</span>
                    <span style={{ color: 'var(--color-title)', fontWeight: 600, fontFamily: k === 'Started by' ? 'inherit' : 'var(--font-mono)' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn" style={{ flex: 1, justifyContent: 'center' }}><Icon name="download" size={15}/>Download</button>
                <button className="btn" style={{ flex: 1, justifyContent: 'center', color: 'var(--color-wrong)' }}><Icon name="stop_circle" size={15}/>Stop</button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

window.RecordingsArtboard = RecordingsArtboard;
