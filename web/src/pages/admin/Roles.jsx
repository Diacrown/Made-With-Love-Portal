import { supabase, q } from '../../lib/supabase';
import { useLoad } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Card, ErrorScreen, Loading, useAction } from '../../components/ui';

export default function Roles() {
  const { reloadAccess } = useAuth();
  const [run, busy] = useAction();
  const { loading, error, data, reload } = useLoad(async () => {
    const [roles, perms, rp] = await Promise.all([
      q(supabase.from('roles').select('*').order('id')),
      q(supabase.from('permissions').select('*').order('code')),
      q(supabase.from('role_permissions').select('role_id, permission_id')),
    ]);
    return { roles, perms, has: new Set(rp.map((x) => `${x.role_id}:${x.permission_id}`)) };
  }, []);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;

  const toggle = (role, perm) => {
    const on = data.has.has(`${role.id}:${perm.id}`);
    if (role.code === 'admin' && perm.code === 'admin.manage' && on) {
      if (!window.confirm('Removing admin.manage from the Administrator role locks every admin out of this panel. Continue?')) return;
    }
    run(async () => {
      if (on) await q(supabase.from('role_permissions').delete().match({ role_id: role.id, permission_id: perm.id }));
      else await q(supabase.from('role_permissions').insert({ role_id: role.id, permission_id: perm.id }));
      await reload();
      await reloadAccess();
    }, on ? `Removed ${perm.code} from ${role.name}` : `Gave ${perm.code} to ${role.name}`);
  };

  return (
    <Card title="Roles and permissions" actions={<small className="muted">Changes apply immediately to everyone with that role.</small>}>
      <div className="table-wrap">
        <table className="table matrix">
          <thead>
            <tr><th>Permission</th>{data.roles.map((r) => <th key={r.id} title={r.description}>{r.name}</th>)}</tr>
          </thead>
          <tbody>
            {data.perms.map((p) => (
              <tr key={p.id}>
                <td><span className="mono">{p.code}</span><br /><small className="muted">{p.description}</small></td>
                {data.roles.map((r) => (
                  <td key={r.id} className="c">
                    <input type="checkbox" aria-label={`${r.name}: ${p.code}`} disabled={busy}
                      checked={data.has.has(`${r.id}:${p.id}`)} onChange={() => toggle(r, p)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
