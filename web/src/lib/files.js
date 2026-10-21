import { supabase, q } from './supabase';

const BUCKET = 'job-files';
export const MAX_BYTES = 50 * 1024 * 1024;
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4,video/quicktime,application/json,text/csv,application/zip';

const safeName = (n) => n.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80) || 'file';

/** Upload one file to jobs/<jobId>/... and record it. Removes the stored object if the record fails. */
export async function uploadJobFile(jobId, file, kind = 'reference', extra = {}) {
  if (file.size > MAX_BYTES) {
    const e = new Error(`${file.name} is larger than 50 MB`); e.code = '23514'; throw e;
  }
  const path = `jobs/${jobId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) throw upErr;
  try {
    return await q(supabase.from('job_files').insert({
      job_id: jobId, kind, storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type || null, size_bytes: file.size, ...extra,
    }).select().single());
  } catch (e) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw e;
  }
}

/** Short-lived links (10 minutes) for private files. -> { path: url } */
export async function signedUrls(paths) {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  if (error) throw error;
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

export async function downloadFile(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  return data;
}

export async function deleteJobFile(row) {
  await q(supabase.from('job_files').delete().eq('id', row.id));
  await supabase.storage.from(BUCKET).remove([row.storage_path]);
}

export const isImage = (f) => /^image\//.test(f.mime_type || f.type || '');
export const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
