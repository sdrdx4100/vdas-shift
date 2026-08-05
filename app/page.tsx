"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";

type Dataset = {
  id: string;
  name: string;
  original_filename: string;
  file_type: string;
  row_count: number;
  column_count: number;
  file_size: number;
  tags: string[];
  created_at: string;
};

type ShiftEvent = {
  index: number;
  time: number;
  rpm: number;
  torque: number;
  from_gear: number;
  to_gear: number;
  direction: "up" | "down";
  transition: string;
};

type Boundary = {
  transition: string;
  direction: "up" | "down";
  torque: number;
  rpm: number;
  rpm_p10: number;
  rpm_p90: number;
  count: number;
  confidence: number;
};

type Analysis = {
  events: ShiftEvent[];
  boundaries: Boundary[];
  summary: {
    event_count: number;
    upshifts: number;
    downshifts: number;
    transitions: Record<string, number>;
    coverage: "low" | "medium" | "high";
  };
};

type Mapping = Record<"time" | "engine_speed" | "driver_torque" | "current_gear" | "target_gear" | "vehicle_speed" | "accelerator", string>;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8711/api";

const mappingLabels: Array<[keyof Mapping, string, string]> = [
  ["time", "時間軸", "Timestamp"],
  ["engine_speed", "エンジン回転数", "EngSpeed"],
  ["driver_torque", "Dr要求トルク", "DriverRequestTorque"],
  ["current_gear", "現在ギア", "CurrentGear"],
  ["target_gear", "目標ギア", "TargetGear"],
  ["vehicle_speed", "車速（任意）", "VehicleSpeed"],
  ["accelerator", "アクセル開度（任意）", "AcceleratorPedal"],
];

const initialMapping: Mapping = Object.fromEntries(mappingLabels.map(([key, , value]) => [key, value])) as Mapping;

const signalColumns = [
  "Timestamp", "EngSpeed", "DriverRequestTorque", "CurrentGear", "TargetGear",
  "VehicleSpeed", "AcceleratorPedal", "BrakeSwitch", "DriveMode", "ATF_Temperature",
];

function seeded(index: number) {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function makeDemoAnalysis(): Analysis {
  const events: ShiftEvent[] = [];
  let index = 0;
  for (let gear = 1; gear <= 5; gear += 1) {
    for (let i = 0; i < 34; i += 1) {
      const torque = 24 + i * 8.8 + (seeded(index) - 0.5) * 18;
      const rpm = 1240 + gear * 105 + torque * (2.9 + gear * 0.18) + (seeded(index + 3) - 0.5) * 230;
      events.push({ index, time: index * 3.72, rpm, torque, from_gear: gear, to_gear: gear + 1, direction: "up", transition: `${gear}→${gear + 1}` });
      index += 1;
    }
  }
  for (let gear = 2; gear <= 6; gear += 1) {
    for (let i = 0; i < 16; i += 1) {
      const torque = 18 + i * 15 + (seeded(index) - 0.5) * 14;
      const rpm = 820 + gear * 70 + torque * 2.25 + (seeded(index + 7) - 0.5) * 170;
      events.push({ index, time: index * 3.72, rpm, torque, from_gear: gear, to_gear: gear - 1, direction: "down", transition: `${gear}→${gear - 1}` });
      index += 1;
    }
  }

  const boundaries: Boundary[] = [];
  const transitions = [...new Set(events.map((event) => event.transition))];
  for (const transition of transitions) {
    const points = events.filter((event) => event.transition === transition).sort((a, b) => a.torque - b.torque);
    for (let start = 0; start < points.length; start += 5) {
      const bucket = points.slice(start, start + 5);
      if (!bucket.length) continue;
      const rpms = bucket.map((point) => point.rpm).sort((a, b) => a - b);
      boundaries.push({
        transition,
        direction: bucket[0].direction,
        torque: bucket.reduce((sum, point) => sum + point.torque, 0) / bucket.length,
        rpm: rpms[Math.floor(rpms.length / 2)],
        rpm_p10: rpms[0],
        rpm_p90: rpms[rpms.length - 1],
        count: bucket.length,
        confidence: Math.min(1, bucket.length / 6),
      });
    }
  }
  return {
    events,
    boundaries,
    summary: {
      event_count: events.length,
      upshifts: events.filter((event) => event.direction === "up").length,
      downshifts: events.filter((event) => event.direction === "down").length,
      transitions: Object.fromEntries(transitions.map((transition) => [transition, events.filter((event) => event.transition === transition).length])),
      coverage: "high",
    },
  };
}

const demoDataset: Dataset = {
  id: "demo-01",
  name: "Vehicle_A_高速・市街地",
  original_filename: "260805_roadtest_vehicle_a.mf4",
  file_type: "mf4",
  row_count: 2_847_392,
  column_count: 186,
  file_size: 1_284_000_000,
  tags: ["Vehicle A", "Dレンジ", "Normal", "評価車#03"],
  created_at: "2026-08-05 08:42",
};

const demoAnalysis = makeDemoAnalysis();

function formatNumber(value: number) {
  return new Intl.NumberFormat("ja-JP").format(value);
}

function formatBytes(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(value / 1_000)} KB`;
}

function Icon({ name }: { name: string }) {
  const icons: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    data: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    map: <><path d="M4 19V5l5-2 6 2 5-2v14l-5 2-6-2-5 2Z"/><path d="M9 3v14M15 5v14"/></>,
    tune: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
    event: <><path d="M5 3v18M19 3v18M5 8h14M5 16h14"/><path d="m9 12 2 2 4-4"/></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
    tag: <><path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8" cy="8" r="1"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>;
}

function ShiftMapChart({ analysis, selected, direction }: { analysis: Analysis; selected: string; direction: "all" | "up" | "down" }) {
  const width = 900;
  const height = 470;
  const pad = { left: 72, right: 24, top: 28, bottom: 58 };
  const filtered = analysis.events.filter((event) => (selected === "all" || event.transition === selected) && (direction === "all" || event.direction === direction));
  const xMin = Math.min(...filtered.map((event) => event.rpm), 500);
  const xMax = Math.max(...filtered.map((event) => event.rpm), 4500);
  const yMin = Math.min(...filtered.map((event) => event.torque), 0);
  const yMax = Math.max(...filtered.map((event) => event.torque), 350);
  const sx = (value: number) => pad.left + ((value - xMin) / (xMax - xMin || 1)) * (width - pad.left - pad.right);
  const sy = (value: number) => height - pad.bottom - ((value - yMin) / (yMax - yMin || 1)) * (height - pad.top - pad.bottom);
  const transitions = [...new Set(filtered.map((event) => event.transition))];
  const colors = ["#42c7ff", "#8f7cff", "#33d49d", "#ffb85c", "#ff6d8a", "#78a8ff"];
  const colorFor = (transition: string) => colors[Math.max(0, transitions.indexOf(transition)) % colors.length];
  const ticksX = Array.from({ length: 6 }, (_, i) => xMin + ((xMax - xMin) * i) / 5);
  const ticksY = Array.from({ length: 6 }, (_, i) => yMin + ((yMax - yMin) * i) / 5);

  return (
    <div className="chart-wrap">
      <svg className="shift-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="エンジン回転数とDr要求トルクに対する変速点">
        <defs>
          <linearGradient id="plot-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#14283d"/><stop offset="1" stopColor="#0c1928"/></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect x={pad.left} y={pad.top} width={width - pad.left - pad.right} height={height - pad.top - pad.bottom} rx="8" fill="url(#plot-bg)" />
        {ticksY.map((tick) => <g key={`y-${tick}`}><line x1={pad.left} x2={width-pad.right} y1={sy(tick)} y2={sy(tick)} className="grid-line"/><text x={pad.left-14} y={sy(tick)+5} textAnchor="end" className="axis-tick">{Math.round(tick)}</text></g>)}
        {ticksX.map((tick) => <g key={`x-${tick}`}><line y1={pad.top} y2={height-pad.bottom} x1={sx(tick)} x2={sx(tick)} className="grid-line"/><text x={sx(tick)} y={height-pad.bottom+25} textAnchor="middle" className="axis-tick">{Math.round(tick)}</text></g>)}
        <text x={(pad.left+width-pad.right)/2} y={height-12} textAnchor="middle" className="axis-label">エンジン回転数 [rpm]</text>
        <text transform={`translate(18 ${(pad.top+height-pad.bottom)/2}) rotate(-90)`} textAnchor="middle" className="axis-label">Dr要求トルク [Nm]</text>
        {filtered.map((event, i) => <circle key={`${event.index}-${i}`} cx={sx(event.rpm)} cy={sy(event.torque)} r={selected === "all" ? 3.1 : 4.2} fill={colorFor(event.transition)} opacity={selected === "all" ? .42 : .62}><title>{event.transition} · {Math.round(event.rpm)} rpm · {Math.round(event.torque)} Nm</title></circle>)}
        {transitions.map((transition) => {
          const boundary = analysis.boundaries.filter((item) => item.transition === transition).sort((a,b) => a.torque-b.torque);
          if (boundary.length < 2) return null;
          const d = boundary.map((point, i) => `${i ? "L" : "M"}${sx(point.rpm).toFixed(1)},${sy(point.torque).toFixed(1)}`).join(" ");
          return <path key={transition} d={d} fill="none" stroke={colorFor(transition)} strokeWidth="3" strokeLinecap="round" filter="url(#glow)" />;
        })}
      </svg>
      <div className="legend">{transitions.map((transition) => <span key={transition}><i style={{ background: colorFor(transition) }}/>{transition}</span>)}</div>
      {!filtered.length && <div className="empty-chart">条件に一致する変速イベントがありません</div>}
    </div>
  );
}

export default function Home() {
  const [datasets, setDatasets] = useState<Dataset[]>([demoDataset]);
  const [selectedDataset, setSelectedDataset] = useState(demoDataset.id);
  const [analysis, setAnalysis] = useState<Analysis>(demoAnalysis);
  const [mapping, setMapping] = useState<Mapping>(initialMapping);
  const [selectedTransition, setSelectedTransition] = useState("all");
  const [direction, setDirection] = useState<"all" | "up" | "down">("up");
  const [activeNav, setActiveNav] = useState("map");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("デモデータ表示中 — ローカルAPI接続時は実データに切り替わります");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingDbc, setPendingDbc] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const dataset = datasets.find((item) => item.id === selectedDataset) ?? datasets[0] ?? demoDataset;
  const transitions = Object.entries(analysis.summary.transitions).sort(([a], [b]) => a.localeCompare(b));

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/datasets`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((items: Dataset[]) => {
        if (items.length) {
          setDatasets(items);
          setSelectedDataset(items[0].id);
          setNotice("ローカルAPI接続済み");
          loadSchema(items[0].id);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function loadSchema(id: string) {
    try {
      const response = await fetch(`${API_BASE}/datasets/${id}/schema`);
      if (!response.ok) return;
      const schema = await response.json();
      setMapping((current) => ({ ...current, ...Object.fromEntries(Object.entries(schema.suggested_mapping).filter(([, value]) => value)) }));
    } catch { /* demo mode */ }
  }

  async function runAnalysis() {
    if (selectedDataset === demoDataset.id) {
      setAnalysis(demoAnalysis);
      setNotice("デモデータを再解析しました");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/datasets/${selectedDataset}/shift-map`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping, bins: 12 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "解析に失敗しました");
      setAnalysis(body);
      setSelectedTransition("all");
      setNotice(`${body.summary.event_count}件の変速判断点を抽出しました`);
      setMappingOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "解析に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  function chooseDataset(id: string) {
    setSelectedDataset(id);
    setSelectedTransition("all");
    if (id === demoDataset.id) {
      setAnalysis(demoAnalysis);
    } else {
      loadSchema(id);
      setMappingOpen(true);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) setPendingFile(file);
  }

  async function upload() {
    if (!pendingFile) return;
    setBusy(true);
    const data = new FormData();
    data.append("file", pendingFile);
    data.append("name", pendingFile.name.replace(/\.[^.]+$/, ""));
    data.append("tags", JSON.stringify(["未分類"]));
    if (pendingDbc) data.append("dbc", pendingDbc);
    try {
      const response = await fetch(`${API_BASE}/datasets/upload`, { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "アップロードに失敗しました");
      setDatasets((items) => [body, ...items.filter((item) => item.id !== demoDataset.id)]);
      setSelectedDataset(body.id);
      setUploadOpen(false);
      setMappingOpen(true);
      setPendingFile(null);
      setPendingDbc(null);
      setNotice(`${body.name} を取り込みました`);
      await loadSchema(body.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "ローカルAPIへ接続できません");
    } finally {
      setBusy(false);
    }
  }

  const displayedEvents = useMemo(() => analysis.events
    .filter((event) => selectedTransition === "all" || event.transition === selectedTransition)
    .filter((event) => direction === "all" || event.direction === direction)
    .slice(0, 8), [analysis, selectedTransition, direction]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><span/><span/></div><div><strong>VDAS</strong><small>SHIFT MAP ANALYZER</small></div></div>
        <nav>
          <button className={activeNav === "overview" ? "active" : ""} onClick={() => setActiveNav("overview")}><Icon name="grid"/>概要</button>
          <button className={activeNav === "data" ? "active" : ""} onClick={() => { setActiveNav("data"); setUploadOpen(true); }}><Icon name="data"/>データ管理</button>
          <p>ANALYSIS</p>
          <button className={activeNav === "map" ? "active" : ""} onClick={() => setActiveNav("map")}><Icon name="map"/>シフトマップ</button>
          <button className={activeNav === "mapping" ? "active" : ""} onClick={() => { setActiveNav("mapping"); setMappingOpen(true); }}><Icon name="tune"/>信号マッピング</button>
          <button className={activeNav === "events" ? "active" : ""} onClick={() => setActiveNav("events")}><Icon name="event"/>変速イベント</button>
        </nav>
        <div className="sidebar-foot"><div className="privacy-dot"/><div><strong>LOCAL WORKSPACE</strong><small>データは端末内に保存</small></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">TRANSMISSION CALIBRATION</p><h1>シフトマップ解析</h1></div>
          <div className="top-actions"><span className="status"><i/> READY</span><button className="ghost" onClick={() => setMappingOpen(true)}><Icon name="settings"/>信号設定</button><button className="primary" onClick={() => setUploadOpen(true)}><Icon name="upload"/>データを追加</button></div>
        </header>

        <div className="content">
          <div className="notice"><span>i</span>{notice}</div>
          <section className="dataset-bar">
            <div className="dataset-select"><label>解析データセット</label><select value={selectedDataset} onChange={(event) => chooseDataset(event.target.value)}>{datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="dataset-meta"><div><small>FORMAT</small><strong>{dataset.file_type.toUpperCase()}</strong></div><div><small>ROWS</small><strong>{formatNumber(dataset.row_count)}</strong></div><div><small>SIGNALS</small><strong>{dataset.column_count}</strong></div><div><small>SIZE</small><strong>{formatBytes(dataset.file_size)}</strong></div></div>
            <div className="tag-list"><Icon name="tag"/>{dataset.tags.map((tag) => <span key={tag}>{tag}</span>)}<button aria-label="タグを追加">＋</button></div>
          </section>

          <section className="metric-grid">
            <article><p>変速イベント</p><strong>{analysis.summary.event_count}</strong><small>検出済み判断点</small><div className="mini-bars">{[4,7,5,9,6,8,11,7,10,13,9,12].map((h,i) => <i key={i} style={{height:`${h*2}px`}}/>)}</div></article>
            <article><p>アップシフト</p><strong>{analysis.summary.upshifts}</strong><small>全体の {Math.round(analysis.summary.upshifts / Math.max(1, analysis.summary.event_count) * 100)}%</small><span className="trend up">↗ 境界推定可能</span></article>
            <article><p>ダウンシフト</p><strong>{analysis.summary.downshifts}</strong><small>全体の {Math.round(analysis.summary.downshifts / Math.max(1, analysis.summary.event_count) * 100)}%</small><span className="trend down">↘ ヒステリシス確認</span></article>
            <article><p>データ充足度</p><strong className="coverage">{analysis.summary.coverage === "high" ? "良好" : analysis.summary.coverage === "medium" ? "中" : "不足"}</strong><small>推定信頼度</small><div className="confidence"><i style={{width: analysis.summary.coverage === "high" ? "86%" : analysis.summary.coverage === "medium" ? "54%" : "24%"}}/></div></article>
          </section>

          <section className="panel chart-panel">
            <div className="panel-head"><div><p className="eyebrow">EMPIRICAL DECISION SURFACE</p><h2>実測シフト境界</h2><span>変速判断直前のエンジン回転数 × Dr要求トルク</span></div><div className="filters"><select value={selectedTransition} onChange={(e) => setSelectedTransition(e.target.value)}><option value="all">全ギア段</option>{transitions.map(([name,count]) => <option key={name} value={name}>{name}（{count}）</option>)}</select><div className="segment"><button className={direction === "up" ? "active" : ""} onClick={() => setDirection("up")}>UP</button><button className={direction === "down" ? "active" : ""} onClick={() => setDirection("down")}>DOWN</button><button className={direction === "all" ? "active" : ""} onClick={() => setDirection("all")}>ALL</button></div></div></div>
            <ShiftMapChart analysis={analysis} selected={selectedTransition} direction={direction}/>
            <div className="chart-foot"><span><i className="point-dot"/>実測判断点</span><span><i className="line-dot"/>中央値境界</span><p>内部マップの完全な復元ではなく、観測条件に対する経験的境界です。</p></div>
          </section>

          <section className="lower-grid">
            <article className="panel transition-panel"><div className="panel-head"><div><p className="eyebrow">COVERAGE BY TRANSITION</p><h2>ギア段別データ量</h2></div></div><div className="transition-list">{transitions.slice(0,6).map(([name,count], index) => <button key={name} onClick={() => setSelectedTransition(name)} className={selectedTransition === name ? "active" : ""}><strong>{name}</strong><div><i style={{width:`${Math.min(100, count/40*100)}%`, background: ["#42c7ff","#8f7cff","#33d49d","#ffb85c","#ff6d8a","#78a8ff"][index%6]}}/></div><span>{count} pts</span></button>)}</div></article>
            <article className="panel events-panel"><div className="panel-head"><div><p className="eyebrow">LATEST DECISIONS</p><h2>抽出イベント</h2></div><button onClick={() => setActiveNav("events")}>すべて表示 →</button></div><div className="event-table"><div className="event-row header"><span>TIME</span><span>SHIFT</span><span>RPM</span><span>Dr TORQUE</span></div>{displayedEvents.slice(0,5).map((event) => <div className="event-row" key={`${event.index}-${event.transition}`}><span>{event.time.toFixed(2)} s</span><span className={event.direction}>{event.transition}</span><span>{Math.round(event.rpm).toLocaleString()} rpm</span><span>{Math.round(event.torque)} Nm</span></div>)}</div></article>
          </section>
        </div>
      </section>

      {uploadOpen && <div className="modal-backdrop" onMouseDown={() => setUploadOpen(false)}><section className="modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setUploadOpen(false)}>×</button><p className="eyebrow">DATA INGESTION</p><h2>計測データを追加</h2><p className="modal-copy">MF4は直接読み込みます。Raw CAN/J1939の場合だけ、対応するDBCを一緒に指定してください。</p><div className={`dropzone ${pendingFile ? "has-file" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onClick={() => fileInput.current?.click()}><Icon name="upload"/><strong>{pendingFile ? pendingFile.name : "MF4 / CSV / Parquet をドロップ"}</strong><span>{pendingFile ? formatBytes(pendingFile.size) : "またはクリックしてファイルを選択"}</span><input ref={fileInput} hidden type="file" accept=".mf4,.mdf,.csv,.parquet,.pq" onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}/></div><label className="file-field"><span>DBC（任意）</span><input type="file" accept=".dbc,.arxml" onChange={(e) => setPendingDbc(e.target.files?.[0] ?? null)}/><small>{pendingDbc?.name ?? "デコード済みMF4なら不要です"}</small></label><div className="modal-actions"><button className="ghost" onClick={() => setUploadOpen(false)}>キャンセル</button><button className="primary" disabled={!pendingFile || busy} onClick={upload}>{busy ? "取り込み中…" : "取り込む"}</button></div></section></div>}

      {mappingOpen && <div className="drawer-backdrop" onMouseDown={() => setMappingOpen(false)}><aside className="drawer" onMouseDown={(e) => e.stopPropagation()}><div className="drawer-head"><div><p className="eyebrow">SIGNAL ASSIGNMENT</p><h2>信号マッピング</h2></div><button onClick={() => setMappingOpen(false)}>×</button></div><p>MF4やJ1939で異なる信号名を、解析に使う役割へ割り当てます。候補は自動選択されています。</p><div className="mapping-list">{mappingLabels.map(([key,label]) => <label key={key}><span>{label}{["engine_speed","driver_torque","current_gear","target_gear"].includes(key) && <b>必須</b>}</span><select value={mapping[key]} onChange={(e) => setMapping((current) => ({...current,[key]:e.target.value}))}><option value="">未使用</option>{signalColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>)}</div><div className="drawer-note"><strong>推定の考え方</strong><span>TargetGearが変化した瞬間を変速判断点として採用し、その時点の回転数と要求トルクを記録します。</span></div><div className="modal-actions"><button className="ghost" onClick={() => setMappingOpen(false)}>閉じる</button><button className="primary" disabled={busy} onClick={runAnalysis}>{busy ? "解析中…" : "マップを生成"}</button></div></aside></div>}
    </main>
  );
}
