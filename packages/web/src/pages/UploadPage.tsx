import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, MenuStatus, UploadProgress } from '../lib/api';

/**
 * Anyone can land here — a diner tired of an unsearchable paper menu, or a
 * restaurant wanting a proper digital menu. They pick a photo (or a PDF
 * straight from their files); we read the restaurant's name off the menu
 * itself. The one thing we can't derive from a photo or a URL is where
 * orders should go, so that's the only thing asked for.
 *
 * `initialWhatsapp` is set when this renders in place of a 404 on /m/:slug
 * -- the slug itself is a WhatsApp number now, so a diner landing on a
 * restaurant's not-yet-created link can just upload it themselves with the
 * number already filled in, instead of hitting a dead end.
 */
export function UploadPage({ initialWhatsapp }: { initialWhatsapp?: string } = {}) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    slug: string;
    manageToken: string;
    restaurantName: string;
    status: MenuStatus;
    totalPages: number | null;
    pagesRead: number | null;
  } | null>(null);

  function uploadButtonLabel(p: UploadProgress | null): string {
    if (!p) return 'Uploading…';
    if (p.phase === 'uploading') return p.totalChunks > 1 ? `Uploading… (${p.chunksUploaded} of ${p.totalChunks})` : 'Uploading…';
    return p.totalPages > 1 ? `Reading page ${p.pagesConverted} of ${p.totalPages}…` : 'Reading the menu…';
  }

  function onFileChange(f: File | null) {
    setFile(f);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setUploadProgress(null);
    setUploading(true);
    try {
      const { urls: imageUrls } = await api.uploadFile(file, setUploadProgress);
      setUploading(false);
      setParsing(true);
      const res = await api.createMenu({ imageUrls, restaurantWhatsapp: whatsapp });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      setParsing(false);
    }
  }

  if (result) {
    return (
      <div className="upload-result">
        <h2>{result.restaurantName} is digitized 🎉</h2>
        <p>
          Diner link: <a href={`/m/${result.slug}`}>{window.location.origin}/m/{result.slug}</a>
        </p>
        <p>
          Manage link (keep this private — fix the name, number, or any misread items here):{' '}
          <a href={`/m/${result.slug}/manage/${result.manageToken}`}>
            {window.location.origin}/m/{result.slug}/manage/{result.manageToken}
          </a>
        </p>
        {result.status === 'processing' && (
          <p className="field-hint">
            This was a long menu ({result.pagesRead} of {result.totalPages} pages read so far) — we're still reading
            through the rest of it in the background. The page will fill in more items over the next minute or two.
          </p>
        )}
        <button onClick={() => navigate(`/m/${result.slug}`)}>Open menu</button>
      </div>
    );
  }

  const busy = uploading || parsing;

  return (
    <div className="upload-page">
      <h1>Digitize a menu</h1>
      <p>Take a photo of a menu (or pick a PDF) — we'll turn it into a searchable, orderable page tied to WhatsApp.</p>

      <label>
        Restaurant's WhatsApp number
        <input
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="+9715XXXXXXXX"
          type="tel"
        />
      </label>
      <p className="field-hint">
        This is the only thing we can't read off the menu itself — it's where orders placed on this link get sent.
      </p>

      <label>
        Menu photo or PDF
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
      </label>
      {previewUrl && <img src={previewUrl} alt="Menu preview" className="upload-preview" />}
      {file && !previewUrl && <p className="upload-filename">📄 {file.name}</p>}

      {error && <p className="page-error">{error}</p>}
      <button disabled={busy || !file || !whatsapp} onClick={submit}>
        {uploading ? uploadButtonLabel(uploadProgress) : parsing ? 'Reading the menu…' : 'Digitize menu'}
      </button>
    </div>
  );
}
