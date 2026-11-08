import { useState, type FormEvent } from 'react';
import { ErrorState, Spinner } from '../../components/ui';
import { patch, post, put } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import type { Localized } from '../../lib/types';
import { useToast } from '../../state/toast';
import { AHead, dt, en, ErrorBox, F, LocInput, Modal, Tabs } from '../kit';

/** Mirrors server/src/lib/permissions.ts. The server is authoritative; labels help staff choose. */
const PERMISSIONS: [string, string][] = [
  ['overview:read', 'Overview dashboard'],
  ['orders:read', 'View orders'],
  ['orders:write', 'Update orders & fulfilment'],
  ['orders:refund', 'Issue refunds'],
  ['products:read', 'View products'],
  ['products:write', 'Edit products'],
  ['categories:write', 'Edit categories'],
  ['inventory:read', 'View stock'],
  ['inventory:write', 'Adjust stock'],
  ['customers:read', 'View customers'],
  ['customers:write', 'Suspend / reactivate customer accounts'],
  ['discounts:read', 'View discounts'],
  ['discounts:write', 'Edit discounts'],
  ['content:write', 'Website content & policy drafts'],
  ['media:write', 'Upload / delete media'],
  ['reviews:moderate', 'Moderate reviews'],
  ['reports:read', 'Reports'],
  ['staff:manage', 'Staff & roles (sensitive)'],
  ['settings:write', 'Store settings'],
  ['business:write', 'Legal identity & policy approval (sensitive)'],
  ['payments:manage', 'Payment gateway credentials & live mode (sensitive)'],
  ['audit:read', 'Activity log'],
];

type Role = { _id: string; key: string; name: Localized; permissions: string[]; system: boolean };
type StaffRow = { _id: string; name: string; email: string; title: string; active: boolean; role?: { _id: string; key: string; name: Localized }; lastLoginAt?: string };

export function Staff() {
  const [tab, setTab] = useState<'staff' | 'roles'>('staff');
  const staff = useApi<StaffRow[]>('/api/admin/staff');
  const roles = useApi<Role[]>('/api/admin/staff/roles/all');
  const [invite, setInvite] = useState<{ name: string; email: string; title: string; roleId: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [roleEdit, setRoleEdit] = useState<Partial<Role> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  if (staff.error) return <ErrorState message={staff.error.message} />;
  if (!staff.data || !roles.data) return <Spinner />;

  const sendInvite = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await post<{ inviteLink: string | null; emailStatus: string }>('/api/admin/staff', invite);
      setInvite(null);
      setLink(r.inviteLink);
      toast(r.emailStatus === 'sent' ? 'Invitation emailed' : 'Account created — share the set-password link privately');
      staff.reload();
    } catch (ex) {
      setErr(ex);
    }
  };
  const saveRole = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const body = { key: roleEdit!.key, name: roleEdit!.name, permissions: roleEdit!.permissions ?? [] };
      if (roleEdit!._id) await put(`/api/admin/staff/roles/${roleEdit!._id}`, body);
      else await post('/api/admin/staff/roles', body);
      setRoleEdit(null);
      roles.reload();
    } catch (ex) {
      setErr(ex);
    }
  };

  return (
    <>
      <AHead title="Staff & roles">
        {tab === 'staff' ? (
          <button className="btn btn--primary btn--sm" onClick={() => setInvite({ name: '', email: '', title: '', roleId: roles.data!.find((r) => r.key === 'sales_executive')?._id ?? roles.data![0]._id })}>
            + Invite staff member
          </button>
        ) : (
          <button className="btn btn--primary btn--sm" onClick={() => setRoleEdit({ key: '', name: { ar: '', en: '' }, permissions: [] })}>
            + New role
          </button>
        )}
      </AHead>
      <Tabs
        tabs={[
          ['staff', 'Staff accounts'],
          ['roles', 'Roles & permissions'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {link ? (
        <div className="alert alert--warning" style={{ marginBottom: 12, wordBreak: 'break-all' }}>
          Email is not configured, so share this single-use link (valid 72 hours) with the staff member privately:
          <br />
          <code>{link}</code>
        </div>
      ) : null}
      {tab === 'staff' ? (
        <div className="a-card table-wrap staff-table-card">
          <p className="muted staff-note" style={{ fontSize: 13 }}>
            Staff named by CELIBERY (Q27/Q39): Usama M. Usman (BDM, approver) and Shuja Mubeen (Online Sales Executive). Invite them with their work emails — they set their own passwords.
          </p>
          <table className="table staff-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Last sign-in</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.data.map((s) => (
                <tr key={s._id}>
                  <td>
                    {s.name}
                    <div className="muted">
                      {s.email} {s.title ? `· ${s.title}` : ''}
                    </div>
                  </td>
                  <td>
                    <select
                      className="select"
                      style={{ minHeight: 34 }}
                      value={s.role?._id ?? ''}
                      onChange={async (e) => {
                        try {
                          await patch(`/api/admin/staff/${s._id}`, { roleId: e.target.value });
                          staff.reload();
                        } catch (ex) {
                          toast((ex as Error).message, 'error');
                        }
                      }}
                    >
                      {roles.data!.map((r) => (
                        <option key={r._id} value={r._id}>
                          {en(r.name)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{dt(s.lastLoginAt)}</td>
                  <td>{s.active ? <span className="badge badge--success">active</span> : <span className="badge badge--danger">disabled</span>}</td>
                  <td className="actions">
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={async () => {
                        try {
                          await patch(`/api/admin/staff/${s._id}`, { active: !s.active });
                          staff.reload();
                        } catch (ex) {
                          toast((ex as Error).message, 'error');
                        }
                      }}
                    >
                      {s.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={async () => {
                        const r = await post<{ inviteLink: string | null; emailStatus: string }>(`/api/admin/staff/${s._id}/reset-link`);
                        setLink(r.inviteLink);
                        toast(r.emailStatus === 'sent' ? 'Reset link emailed' : 'Reset link created');
                      }}
                    >
                      Send reset link
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="a-card table-wrap staff-table-card">
          <table className="table staff-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Permissions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.data.map((r) => (
                <tr key={r._id}>
                  <td>
                    <strong>{en(r.name)}</strong>
                    <div className="muted">{r.key}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{r.permissions.join(', ')}</td>
                  <td>{r.system ? <span className="badge">system</span> : <button className="btn btn--ghost btn--sm" onClick={() => setRoleEdit(r)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invite ? (
        <Modal title="Invite staff member" onClose={() => setInvite(null)}>
          <form className="form-grid staff-invite-form" onSubmit={sendInvite}>
            <ErrorBox error={err} />
            <F label="Full name">
              <input className="input" required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            </F>
            <F label="Work email">
              <input className="input" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            </F>
            <F label="Job title">
              <input className="input" value={invite.title} onChange={(e) => setInvite({ ...invite, title: e.target.value })} />
            </F>
            <F label="Role">
              <select className="select" value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })}>
                {roles.data.map((r) => (
                  <option key={r._id} value={r._id}>
                    {en(r.name)}
                  </option>
                ))}
              </select>
            </F>
            <button className="btn btn--primary">Create & send invitation</button>
          </form>
        </Modal>
      ) : null}
      {roleEdit ? (
        <Modal title={roleEdit._id ? 'Edit role' : 'New role'} onClose={() => setRoleEdit(null)} wide>
          <form className="form-grid form-grid--2 staff-role-form" onSubmit={saveRole}>
            <div className="span-2">
              <ErrorBox error={err} />
            </div>
            <F label="Key (lowercase, underscores)">
              <input className="input" required disabled={Boolean(roleEdit._id)} value={roleEdit.key ?? ''} onChange={(e) => setRoleEdit({ ...roleEdit, key: e.target.value })} />
            </F>
            <span />
            <LocInput label="Name" required value={roleEdit.name} onChange={(v) => setRoleEdit({ ...roleEdit, name: v })} />
            <div className="field span-2">
              <span className="label">Permissions</span>
              <div className="perm-grid staff-perm-grid">
                {PERMISSIONS.map(([p, label]) => (
                  <label key={p} className="check" title={p}>
                    <input
                      type="checkbox"
                      checked={roleEdit.permissions?.includes(p) ?? false}
                      onChange={(e) => setRoleEdit({ ...roleEdit, permissions: e.target.checked ? [...(roleEdit.permissions ?? []), p] : (roleEdit.permissions ?? []).filter((x) => x !== p) })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <button className="btn btn--primary span-2">Save role</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function ActivityLog() {
  const { data, error, loading } = useApi<{ _id: string; userName: string; action: string; entity: string; entityId: string; summary: string; createdAt: string }[]>('/api/admin/audit');
  if (error) return <ErrorState message={error.message} />;
  if (loading || !data) return <Spinner />;
  return (
    <>
      <AHead title="Activity log" />
      <div className="a-card table-wrap activity-table-card">
        <table className="table activity-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>What</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a._id}>
                <td>{dt(a.createdAt)}</td>
                <td>{a.userName || 'system'}</td>
                <td>
                  {a.action} {a.entity}
                </td>
                <td>{a.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}


