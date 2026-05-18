import { useState, useEffect, useCallback } from 'react';
import './App.css';
import {
  getEmployees, createEmployee,
  getLocations, createLocation,
  getBalancesForEmployee, createBalance,
  getPtoRequestsForEmployee, createPtoRequest, approvePtoRequest, rejectPtoRequest,
  runReconciliation,
  minutesToHours, nanoid,
  type Employee, type Location, type Balance, type PtoRequest, type ReconciliationResult,
} from './api';

// ── Small helpers ─────────────────────────────────────────────────────────────

function Badge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>;
}

function Alert({ msg, type = 'error' }: { msg: string; type?: 'error' | 'success' }) {
  return <div className={`alert alert-${type}`}>{msg}</div>;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

// ── Employees view ────────────────────────────────────────────────────────────

function EmployeesView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [hcmId, setHcmId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try { setEmployees(await getEmployees()); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await createEmployee({ hcmEmployeeId: hcmId, name, email, managerId: managerId || undefined });
      setName(''); setEmail(''); setHcmId(''); setManagerId('');
      setSuccess('Employee created.');
      load();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div>
      <div className="card">
        <h2>Add Employee</h2>
        {error && <Alert msg={error} />}
        {success && <Alert msg={success} type="success" />}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="Alice Smith" />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="alice@co.com" />
            </div>
            <div className="field">
              <label>HCM Employee ID</label>
              <input value={hcmId} onChange={e => setHcmId(e.target.value)} required placeholder="HCM-001" />
            </div>
            <div className="field">
              <label>Manager (optional)</label>
              <select value={managerId} onChange={e => setManagerId(e.target.value)}>
                <option value="">— none —</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">Add</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>All Employees ({employees.length})</h2>
        {employees.length === 0 ? <p className="empty">No employees yet.</p> : (
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>HCM ID</th><th>Manager</th></tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td>{emp.name}</td>
                  <td>{emp.email}</td>
                  <td><code>{emp.hcmEmployeeId}</code></td>
                  <td>{employees.find(e => e.id === emp.managerId)?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Locations view ────────────────────────────────────────────────────────────

function LocationsView() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [tz, setTz] = useState('America/New_York');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    try { setLocations(await getLocations()); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await createLocation({ code, name, timezone: tz });
      setCode(''); setName('');
      setSuccess('Location created.');
      load();
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div>
      <div className="card">
        <h2>Add Location</h2>
        {error && <Alert msg={error} />}
        {success && <Alert msg={success} type="success" />}
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <div className="field">
              <label>Code</label>
              <input value={code} onChange={e => setCode(e.target.value)} required placeholder="NYC" />
            </div>
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="New York" />
            </div>
            <div className="field">
              <label>Timezone</label>
              <input value={tz} onChange={e => setTz(e.target.value)} required placeholder="America/New_York" />
            </div>
            <button type="submit" className="btn btn-primary">Add</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>All Locations ({locations.length})</h2>
        {locations.length === 0 ? <p className="empty">No locations yet.</p> : (
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Timezone</th></tr></thead>
            <tbody>
              {locations.map(loc => (
                <tr key={loc.id}>
                  <td><code>{loc.code}</code></td>
                  <td>{loc.name}</td>
                  <td>{loc.timezone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Balances view ─────────────────────────────────────────────────────────────

function BalancesView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]);
  const [seedLoc, setSeedLoc] = useState('');
  const [seedMins, setSeedMins] = useState('2400');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    Promise.all([getEmployees(), getLocations()])
      .then(([emps, locs]) => { setEmployees(emps); setLocations(locs); })
      .catch(e => setError((e as Error).message));
  }, []);

  async function loadBalances(empId: string) {
    setError('');
    try { setBalances(await getBalancesForEmployee(empId)); }
    catch (e) { setError((e as Error).message); }
  }

  function handleSelectEmp(id: string) {
    setSelectedEmp(id);
    if (id) loadBalances(id);
    else setBalances([]);
  }

  async function handleSeed(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await createBalance({ employeeId: selectedEmp, locationId: seedLoc, balanceMinutes: Number(seedMins) });
      setSuccess('Balance seeded.');
      loadBalances(selectedEmp);
    } catch (err) { setError((err as Error).message); }
  }

  const locName = (id: string) => locations.find(l => l.id === id)?.name ?? id;

  return (
    <div>
      <div className="card">
        <h2>View Balances</h2>
        {error && <Alert msg={error} />}
        {success && <Alert msg={success} type="success" />}
        <div className="form-row">
          <div className="field">
            <label>Employee</label>
            <select value={selectedEmp} onChange={e => handleSelectEmp(e.target.value)}>
              <option value="">— select —</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        </div>

        {selectedEmp && (
          <>
            {balances.length === 0 ? <p className="empty">No balances for this employee.</p> : (
              <table>
                <thead>
                  <tr><th>Location</th><th>Balance (hrs)</th><th>Pending (hrs)</th><th>Available (hrs)</th><th>Version</th></tr>
                </thead>
                <tbody>
                  {balances.map(b => (
                    <tr key={b.id}>
                      <td>{locName(b.locationId)}</td>
                      <td>{minutesToHours(b.balanceMinutes)}</td>
                      <td>{minutesToHours(b.pendingMinutes)}</td>
                      <td><strong>{minutesToHours(b.balanceMinutes - b.pendingMinutes)}</strong></td>
                      <td>{b.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 style={{ marginTop: 20 }}>Seed Balance</h3>
            <form onSubmit={handleSeed}>
              <div className="form-row">
                <div className="field">
                  <label>Location</label>
                  <select value={seedLoc} onChange={e => setSeedLoc(e.target.value)} required>
                    <option value="">— select —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Balance (minutes)</label>
                  <input type="number" value={seedMins} onChange={e => setSeedMins(e.target.value)} min="0" required />
                </div>
                <button type="submit" className="btn btn-primary">Seed</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── PTO Requests view ─────────────────────────────────────────────────────────

function PtoView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedEmp, setSelectedEmp] = useState('');
  const [requests, setRequests] = useState<PtoRequest[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Submit form state
  const [locId, setLocId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [mins, setMins] = useState('480');
  const [memo, setMemo] = useState('');

  // Manager action state
  const [managerId, setManagerId] = useState('');

  useEffect(() => {
    Promise.all([getEmployees(), getLocations()])
      .then(([emps, locs]) => { setEmployees(emps); setLocations(locs); })
      .catch(e => setError((e as Error).message));
  }, []);

  async function loadRequests(empId: string) {
    setError('');
    try { setRequests(await getPtoRequestsForEmployee(empId)); }
    catch (e) { setError((e as Error).message); }
  }

  function handleSelectEmp(id: string) {
    setSelectedEmp(id);
    if (id) loadRequests(id);
    else setRequests([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await createPtoRequest(
        { employeeId: selectedEmp, locationId: locId, startDate, endDate, requestedMinutes: Number(mins), memo: memo || undefined },
        nanoid(),
      );
      setSuccess('PTO request submitted.');
      setStartDate(''); setEndDate(''); setMemo('');
      loadRequests(selectedEmp);
    } catch (err) { setError((err as Error).message); }
  }

  async function handleApprove(reqId: string) {
    setError(''); setSuccess('');
    if (!managerId) { setError('Select a manager first.'); return; }
    try {
      await approvePtoRequest(reqId, managerId, nanoid());
      setSuccess('Approved.');
      loadRequests(selectedEmp);
    } catch (err) { setError((err as Error).message); }
  }

  async function handleReject(reqId: string) {
    setError(''); setSuccess('');
    if (!managerId) { setError('Select a manager first.'); return; }
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    try {
      await rejectPtoRequest(reqId, managerId, reason, nanoid());
      setSuccess('Rejected.');
      loadRequests(selectedEmp);
    } catch (err) { setError((err as Error).message); }
  }

  const locName = (id: string) => locations.find(l => l.id === id)?.name ?? id;

  return (
    <div>
      {error && <Alert msg={error} />}
      {success && <Alert msg={success} type="success" />}

      <div className="card">
        <h2>Select Employee</h2>
        <div className="form-row">
          <div className="field">
            <label>Employee</label>
            <select value={selectedEmp} onChange={e => handleSelectEmp(e.target.value)}>
              <option value="">— select —</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Acting Manager (for approve/reject)</label>
            <select value={managerId} onChange={e => setManagerId(e.target.value)}>
              <option value="">— select —</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {selectedEmp && (
        <>
          <div className="card">
            <h2>Submit PTO Request</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="field">
                  <label>Location</label>
                  <select value={locId} onChange={e => setLocId(e.target.value)} required>
                    <option value="">— select —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Start Date</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
                </div>
                <div className="field">
                  <label>End Date</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Minutes</label>
                  <input type="number" value={mins} onChange={e => setMins(e.target.value)} min="1" required style={{ minWidth: 90 }} />
                </div>
                <div className="field">
                  <label>Memo</label>
                  <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="optional" />
                </div>
                <button type="submit" className="btn btn-primary">Submit</button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>PTO Requests ({requests.length})</h2>
            {requests.length === 0 ? <p className="empty">No requests yet.</p> : (
              <table>
                <thead>
                  <tr><th>Location</th><th>Dates</th><th>Minutes</th><th>Status</th><th>Memo</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id}>
                      <td>{locName(r.locationId)}</td>
                      <td>{fmtDate(r.startDate)} → {fmtDate(r.endDate)}</td>
                      <td>{r.requestedMinutes}</td>
                      <td><Badge status={r.status} /></td>
                      <td>{r.memo ?? '—'}</td>
                      <td>
                        {r.status === 'PENDING' && (
                          <div className="actions">
                            <button className="btn btn-success" onClick={() => handleApprove(r.id)}>Approve</button>
                            <button className="btn btn-danger" onClick={() => handleReject(r.id)}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Reconciliation view ───────────────────────────────────────────────────────

function ReconciliationView() {
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRun() {
    setLoading(true); setError(''); setResult(null);
    try { setResult(await runReconciliation()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <div className="card">
        <h2>Reconciliation</h2>
        <p style={{ color: '#64748b', marginBottom: 16, fontSize: 13 }}>
          Pulls all balances from HCM and repairs any drift in local records.
        </p>
        {error && <Alert msg={error} />}
        <button className="btn btn-primary" onClick={handleRun} disabled={loading}>
          {loading ? 'Running…' : 'Run Reconciliation'}
        </button>
      </div>

      {result && (
        <div className="card">
          <h2>Last Run Result</h2>
          <div className="stats-row">
            <div className="stat-box">
              <div className="stat">{result.inspectedRows}</div>
              <div className="stat-label">Rows Inspected</div>
            </div>
            <div className="stat-box">
              <div className="stat">{result.driftCount}</div>
              <div className="stat-label">Drift Detected</div>
            </div>
            <div className="stat-box">
              <div className="stat">{result.repairsApplied}</div>
              <div className="stat-label">Repairs Applied</div>
            </div>
            <div className="stat-box">
              <div className="stat">{result.errorsCount}</div>
              <div className="stat-label">Errors</div>
            </div>
            <div className="stat-box">
              <div className="stat" style={{ fontSize: 14 }}>{result.status}</div>
              <div className="stat-label">Status</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

type View = 'employees' | 'locations' | 'balances' | 'pto' | 'reconciliation';

const NAV: { id: View; label: string }[] = [
  { id: 'employees', label: '👤 Employees' },
  { id: 'locations', label: '📍 Locations' },
  { id: 'balances', label: '💰 Balances' },
  { id: 'pto', label: '🏖 PTO Requests' },
  { id: 'reconciliation', label: '🔄 Reconciliation' },
];

export default function App() {
  const [view, setView] = useState<View>('employees');

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>ReadyOn</h1>
        {NAV.map(n => (
          <button
            key={n.id}
            className={view === n.id ? 'active' : ''}
            onClick={() => setView(n.id)}
          >
            {n.label}
          </button>
        ))}
      </nav>
      <main className="main">
        {view === 'employees'      && <EmployeesView />}
        {view === 'locations'      && <LocationsView />}
        {view === 'balances'       && <BalancesView />}
        {view === 'pto'            && <PtoView />}
        {view === 'reconciliation' && <ReconciliationView />}
      </main>
    </div>
  );
}
