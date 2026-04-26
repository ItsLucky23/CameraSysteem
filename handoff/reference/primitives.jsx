/* eslint-disable */
// Shared primitives used across all camera-app artboards.
// Exported via window so each artboard file can grab them.

const { useState, useEffect, useRef, useMemo } = React;

const cx = (...parts) => parts.filter(Boolean).join(' ');

// ---------- Brand mark ----------
function BrandMark({ size = 28, color = 'var(--color-primary)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <rect x="1" y="1" width="26" height="26" rx="8" stroke={color} strokeWidth="1.5"/>
      <circle cx="14" cy="14" r="6.5" stroke={color} strokeWidth="1.5"/>
      <circle cx="14" cy="14" r="2.5" fill={color}/>
      <circle cx="20.5" cy="7.5" r="1.25" fill={color}/>
    </svg>
  );
}

function Wordmark({ small }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <BrandMark size={small ? 22 : 26}/>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
        <span className="font-display" style={{ fontSize: small ? 18 : 22, color: 'var(--color-title)' }}>Aperture</span>
        <span style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted)', fontWeight: 600 }}>Camera Control</span>
      </div>
    </div>
  );
}

// ---------- Icon ----------
function Icon({ name, size = 18, color, style }) {
  return (
    <span className="icon" style={{ fontSize: size, color: color || 'inherit', ...style }}>{name}</span>
  );
}

// ---------- Status dot ----------
function StatusDot({ status = 'online', pulse }) {
  const map = {
    online: 'var(--color-correct)',
    offline: 'var(--color-wrong)',
    idle: 'var(--color-warning)',
    rec: 'var(--color-wrong)',
  };
  return (
    <span style={{
      display: 'inline-block',
      width: 8, height: 8,
      borderRadius: '50%',
      background: map[status] || map.online,
      boxShadow: pulse ? `0 0 0 4px ${map[status]}22` : undefined,
    }}/>
  );
}

// ---------- Sidebar (vertical nav rail) ----------
function SideRail({ active = 'dashboard' }) {
  const items = [
    { id: 'dashboard', icon: 'dashboard', label: 'Overview' },
    { id: 'cameras', icon: 'videocam', label: 'Cameras' },
    { id: 'recordings', icon: 'movie', label: 'Recordings' },
    { id: 'access', icon: 'key', label: 'Access' },
    { id: 'admin', icon: 'tune', label: 'Admin' },
  ];
  const bottom = [
    { id: 'settings', icon: 'settings', label: 'Settings' },
  ];
  const Item = ({ it }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px',
      borderRadius: 10,
      color: active === it.id ? 'var(--color-title)' : 'var(--color-common)',
      background: active === it.id ? 'var(--color-container2)' : 'transparent',
      cursor: 'pointer',
      fontSize: 13.5, fontWeight: active === it.id ? 600 : 500,
    }}>
      <Icon name={it.icon} size={19}/>
      <span>{it.label}</span>
      {active === it.id && (
        <span style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: 'var(--color-primary)' }}/>
      )}
    </div>
  );
  return (
    <aside style={{
      width: 220,
      background: 'var(--color-container1)',
      borderRight: '1px solid var(--color-container1-border)',
      display: 'flex', flexDirection: 'column',
      padding: '22px 14px',
      flexShrink: 0,
    }}>
      <div style={{ padding: '0 6px 22px' }}><Wordmark/></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => <Item key={it.id} it={it}/>)}
      </div>
      <div style={{ flex: 1 }}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {bottom.map(it => <Item key={it.id} it={it}/>)}
      </div>
      <div style={{
        marginTop: 16, padding: 12,
        background: 'var(--color-container2)',
        borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--color-primary-soft)',
          color: 'var(--color-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700,
        }}>EM</div>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-title)' }}>Eli Marek</span>
          <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>Operator</span>
        </div>
      </div>
    </aside>
  );
}

// ---------- Top bar (used inside artboard pages) ----------
function PageTopBar({ title, subtitle, actions, eyebrow }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, padding: '32px 36px 18px' }}>
      <div>
        {eyebrow && <div className="label" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h1 className="font-display" style={{ fontSize: 36, margin: 0, lineHeight: 1.05, color: 'var(--color-title)' }}>{title}</h1>
        {subtitle && <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--color-common)', maxWidth: 540 }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>}
    </header>
  );
}

// ---------- Camera image w/ subtle overlay ----------
function CameraThumb({ src, status = 'online', label, slug, height = 120, rounded = 12 }) {
  const offline = status === 'offline';
  return (
    <div style={{
      position: 'relative',
      height,
      borderRadius: rounded,
      overflow: 'hidden',
      background: 'var(--color-container2)',
    }}>
      {src ? (
        <img alt="" src={src} style={{
          width: '100%', height: '100%', objectFit: 'cover',
          filter: offline ? 'grayscale(1) opacity(0.55)' : 'saturate(0.9) contrast(1.02)',
        }}/>
      ) : <div className="cam-placeholder" style={{ width: '100%', height: '100%' }}/>}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%)',
        pointerEvents: 'none',
      }}/>
      {!offline && (
        <div style={{
          position: 'absolute', top: 10, left: 10,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
          color: '#fff',
          padding: '4px 8px', borderRadius: 6,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px rgba(34,197,94,0.18)' }}/>
          Live
        </div>
      )}
      {offline && (
        <div style={{
          position: 'absolute', top: 10, left: 10,
          background: 'rgba(0,0,0,0.6)', color: '#fff',
          padding: '4px 8px', borderRadius: 6,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>Offline</div>
      )}
      {slug && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'rgba(0,0,0,0.45)', color: '#fff',
          padding: '4px 8px', borderRadius: 6,
          fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)',
        }}>{slug}</div>
      )}
      {label && (
        <div style={{
          position: 'absolute', bottom: 10, left: 12,
          color: '#fff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em',
          textShadow: '0 1px 6px rgba(0,0,0,0.45)',
        }}>{label}</div>
      )}
    </div>
  );
}

// ---------- Sample data ----------
const cameraSeed = [
  { id: '1', slug: 'C-001', name: 'Front Entrance', status: 'online', mode: 'record',  uptime: '07d 14h 22m', loc: 'Main Lobby',     fps: 24, src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCbzPduZN1NL9trZqJD-Q8aKa_7koHU9XdV4qQynowtsjcSzaIEJaOrB_jRLbTVIPnMuTJcuSn9dlW4xCUKgBOPWIASkjc1dp9YZon0fLfrZBAYs242vZVA_li5fl4SZlH9rh5Vg-aLF7-UL5rMxgjVZZakA32OKbKpo6KOvJfWRLHR9vd6LpcDbXlm7q4KDU2SyYRb059VsLZlwXMiyjGY_0laAIVObnFdUD-JSbBTu_oUt-s0c4KKfbnrQXZsGfNTWqkTdeNACJ8' },
  { id: '2', slug: 'C-002', name: 'Loading Bay',     status: 'online', mode: 'live',    uptime: '12d 03h 41m', loc: 'East Wing',      fps: 18, src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBmlYstIprhvGMELiVCiWHFDQnObtlWZBFiDYltghxLcpTECq9z5rUaFwqBtPhwzLMZkVy5naBfPm_ppx3nEj_fOAN13wtprBZDD2PaJbSbxQFTGZyUvx9mianPlBRE9MXp_0DuU1LcrwNrhGpdFZDue3uOFDvJ0wD14hfoYf1wOsbPrvyA0QNJK0DYqgJbeUL5YMrCqnpWO_udMeulxDliXBw8l3Vlkf7ptDIjWX36emvsClJVJaDpTG_APOuv9lES11czAuTDkMI' },
  { id: '3', slug: 'C-003', name: 'Server Room',     status: 'online', mode: 'live',    uptime: '21d 09h 12m', loc: 'Basement L2',    fps: 30, src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBptm649nDGzGwRTIuSp_X2GZRo9DPrY0b0XCfkL31ukNfrOgpk173kaM2Z4LX9Q6BWcPQttBs31JNGkldm1c6ZtFOpCJYyZdiEFgsRYfjYa-rCjOuKqnRIUcLc5MeactPWt_awH9WTX8vQTcwdI3Tv_shJS747U-jajjq2nrtg1zCCPxb33Z6rhvoZcHWF-uUexzEm5ugixS9MpAPFDLJ5QtB5q6WZZUnssR0MXtfITYgOLuiN-iHlNoa57c4_JrgasMh1xBPOZD0' },
  { id: '4', slug: 'C-004', name: 'Rear Loading',    status: 'offline', mode: 'off',    uptime: '--',           loc: 'West Yard',      fps: 0,  src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAhj8KCmDmXB0aXB2v4SzTBYFbm3PQnaWRf9tgSPPfjtzhKHXL3yninfZ2RGRxwoBJKcNqgEa35IOSQzo6uWw-36qc5Nk7T7gcYbKltPVsfhmXGhMeWOtq9qijqec3ckdmAbtqElrrBY2400q0De9l0x17hN61c7zKqHIz0dGitIuLf2gbHRyl22ZKWUTWrIRooVhIl0_aAbAH_sSMMzfOARES1Ainsxqq0czIiYAIgR6TWKq3DqBy-_wRoVbBoXolpR7ZurkJ5qmI' },
  { id: '5', slug: 'C-005', name: 'Reception Desk',  status: 'online', mode: 'idle',    uptime: '03d 22h 08m', loc: 'Main Lobby',     fps: 15, src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCHRDaAGDYq5vcEFvUiv-ZC3cjER5NptSIkNj8nmBCkAkrUutoGxV8TdRfczlrN9eFa6eez_lPV8V7oUIH41bq9nhMQyoYWCvIU9o22SVhjN_rMQsXYaW8ekFu4J_y9_Y3_8XJaYfmIMIJe3jOjvnvppU4dczbVBSN84jji5FyOED50ZSCSQ-IgQ9zvcORqHBCZ0CWb5if-xaqKeLEMU6rcrbSqCV7BEAZINcLSPFJBPfBCKUlWIBKQy7LXJ_nnfEEn_m0qhoBWGxY' },
  { id: '6', slug: 'C-006', name: 'Conference Room', status: 'online', mode: 'record',  uptime: '09d 11h 04m', loc: 'Floor 3',        fps: 24, src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD14a21ifBG7QN5oqaBQ3QlaMPECev3AiAK_VcEvU44zdvjh6pIWv9sRaUf84XkxJCNb4p1wexaK1EJX5jn5oG1YRpklJRo0XzzU1YJJ-qKmJFwDbJdS3Cy8JoG0ZQCCkZxRf3Y3fZLgZW9rfMGDdYs188ZFs-5Kz14kyy1kHLYpCcYZPbBa-9-QAUcG_m0kZP3RkmX5whcHVsv50YgRmD60U-U1ch5LP_SKvwR-g8Ir-0nHdUjcpMCfNJ4XOZhe7FdKTYF7YRmfrg' },
  { id: '7', slug: 'C-007', name: 'Parking North',   status: 'online', mode: 'live',    uptime: '15d 06h 33m', loc: 'External',       fps: 12, src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA3yYyT-NEVUV7QseMGKqcsk1D56xPTW0czUfhtrjVrTSY80uxUpK9B_ba_i59_V7ot8SCtCc_IS-MTdRLnt8DwRhgfEQwcAbn5GEsYyoxXSIbZGNvoX-NWfgChxKH9PnexnvzKmjcVi-0Zkcl-nfcazbvKnTpoRa0o9BT8B2o5eMPJ--weymJUTvubYbFsRLzBluGZ5jdp9Jd0oOQUCHXUDqbWh8suiEuuGtoCo48W7kvW-CwuZEjeQBw6dOUetlAImfxf-SbdJAI' },
  { id: '8', slug: 'C-008', name: 'Stairwell B',     status: 'idle',   mode: 'idle',    uptime: '02d 17h 55m', loc: 'Floor 2',        fps: 8,  src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBeKC1MX7r72ICx9vl131HiK6FDWNMxBi3BKy8UpOLAQMTpE4zOPzr-upt5TGfEpAccpMuKoPurzgBvpd_yc1gkTm72A0D9uXn6qY5N29ud2qzQOkhnaxBA3XOH9nzmEdPOug8iQP95sq0atu-UCPr7FDFW2qOcouYJzvJvTMj9tItkHBxwuLOg8xcxVYZW8ewAni0ZxX8XczGxstz-HBDRsf7uJtwCsoBUkRoxCGMlY_LmCvYxHcYt9sF29dXaNgIm-k0QkxLfu-4' },
];

const userSeed = [
  { id: 'u1', name: 'Eli Marek',       email: 'eli@aperture.io',     role: 'admin',    cams: 8, init: 'EM' },
  { id: 'u2', name: 'Tomás Reyes',     email: 'tomas@aperture.io',   role: 'operator', cams: 5, init: 'TR' },
  { id: 'u3', name: 'Priya Anand',     email: 'priya@aperture.io',   role: 'operator', cams: 3, init: 'PA' },
  { id: 'u4', name: 'Jordan Vance',    email: 'jordan@aperture.io',  role: 'operator', cams: 6, init: 'JV' },
  { id: 'u5', name: 'Hana Okafor',     email: 'hana@aperture.io',    role: 'admin',    cams: 8, init: 'HO' },
  { id: 'u6', name: 'Ren Watanabe',    email: 'ren@aperture.io',     role: 'operator', cams: 2, init: 'RW' },
];

Object.assign(window, {
  cx, BrandMark, Wordmark, Icon, StatusDot,
  SideRail, PageTopBar, CameraThumb,
  cameraSeed, userSeed,
});
