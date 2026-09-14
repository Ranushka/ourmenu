import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Anyone can land here — a diner tired of an unsearchable paper menu, or a
 * restaurant wanting a proper digital menu. They pick a photo (or a PDF
 * straight from their files), we parse it, and hand back a shareable link
 * + a private manage link.
 */
export function UploadPage() {
  const navigate = useNavigate();
  const [restaurantName, setRestaurantName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [role, setRole] = useState<'DINER' | 'RESTAURANT'>('DINER');
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; manageToken: string } | null>(null);

  function onFileChange(f: File | null) {
    setFile(f);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { url: imageUrl } = await api.uploadFile(file);
      setUploading(false);
      setParsing(true);
      const res = await api.createMenu({ restaurantName, imageUrl, createdByRole: role });
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
        <h2>Menu digitized 🎉</h2>
        <p>
          Diner link: <a href={`/m/${result.slug}`}>{window.location.origin}/m/{result.slug}</a>
        </p>
        <p>
          Manage link (keep this private):{' '}
          <a href={`/m/${result.slug}/manage/${result.manageToken}`}>
            {window.location.origin}/m/{result.slug}/manage/{result.manageToken}
          </a>
        </p>
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
        Restaurant name
        <input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} />
      </label>

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

      <label>
        Who's uploading?
        <select value={role} onChange={(e) => setRole(e.target.value as 'DINER' | 'RESTAURANT')}>
          <option value="DINER">Just a diner — I don't have this restaurant's menu online</option>
          <option value="RESTAURANT">I'm the restaurant</option>
        </select>
      </label>

      {error && <p className="page-error">{error}</p>}
      <button disabled={busy || !restaurantName || !file} onClick={submit}>
        {uploading ? 'Uploading…' : parsing ? 'Reading the menu…' : 'Digitize menu'}
      </button>
    </div>
  );
}
