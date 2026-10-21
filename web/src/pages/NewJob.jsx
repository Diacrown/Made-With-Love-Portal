import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, q } from '../lib/supabase';
import { useLoad } from '../lib/hooks';
import { useRefData } from '../lib/refdata';
import { useAuth } from '../auth/AuthProvider';
import { uploadJobFile } from '../lib/files';
import { mapError } from '../lib/errors';
import JobForm from '../components/JobForm';
import { Empty, ErrorScreen, Loading, PageHead, useAction, useToast } from '../components/ui';

export default function NewJob() {
  const ref = useRefData();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const variant = params.get('form') === 'advanced' ? 'advanced' : 'simple';
  const [run, busy] = useAction();
  const [uploading, setUploading] = useState(false);

  const { loading, error, data: customers, reload } = useLoad(() =>
    q(supabase.from('customers').select('id, alias, office_id').order('alias')), []);

  if (loading) return <Loading />;
  if (error) return <ErrorScreen error={error} onRetry={reload} />;
  const allowed = customers.filter((c) => can('job.create', c.office_id));

  async function save({ job, metals, stones, files }) {
    const created = await run(() => q(supabase.rpc('save_job', { p_job_id: null, p_job: job, p_metals: metals, p_stones: stones })), 'Job created');
    if (!created) return;
    if (files.length) {
      setUploading(true);
      const failed = [];
      for (const f of files) {
        try { await uploadJobFile(created.id, f, 'reference'); } catch (e) { failed.push(`${f.name}: ${mapError(e).message}`); }
      }
      setUploading(false);
      if (failed.length) toast(`Job saved, but ${failed.length} file(s) did not upload. ${failed[0]}`, 'warn');
    }
    navigate(`/jobs/${created.id}`);
  }

  return (
    <>
      <PageHead crumb={<><Link to="/jobs">Jobs</Link> / New</>} title="Create a new job card"
        sub="Simple for a quick request; Advanced for a full design brief with stamping and engraving." />
      <div className="subtabs" role="tablist">
        {[['simple', 'Simple'], ['advanced', 'Advanced']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={variant === k} className={`subtab ${variant === k ? 'active' : ''}`} onClick={() => setParams(k === 'simple' ? {} : { form: k })}>{l}</button>
        ))}
      </div>
      {allowed.length === 0 ? <Empty>You cannot create jobs for any customer you can see. Add a customer first.</Empty> : (
        <div className="card"><div className="card-bd">
          <JobForm key={variant} variant={variant} customers={allowed} officeById={ref.officeById} busy={busy || uploading}
            submitLabel={uploading ? 'Uploading files…' : 'Create job'} onSubmit={save} onCancel={() => navigate('/jobs')} />
        </div></div>
      )}
    </>
  );
}
