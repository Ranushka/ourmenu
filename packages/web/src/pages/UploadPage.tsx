import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

/**
 * Anyone can land here — a diner tired of an unsearchable paper menu, or a
 * restaurant wanting a proper digital menu. They upload a photo, we parse
 * it, and hand back a shareable link + a private manage link.
 */
export function UploadPage() {
  const navigate = useNavigate();
  const [restaurantName, setRestaurantName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [role, setRole] = useState<'DINER' | 'RESTAURANT'>('DINER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slug: string; manageToken: string } | null>(null);

  // NOTE: imageUrl is a placeholder input for now — wire up real image
  // upload (e.g. to object storage) before this ships; the API already
  // expects a publicly-fetchable URL it can hand to the vision model.
  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.createMenu({ restaurantName, imageUrl, createdByRole: role });
      setResult(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
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

  return (
    <div className="upload-page">
      <h1>Digitize a menu</h1>
      <p>Upload a photo of a menu — we'll turn it into a searchable, orderable page tied to WhatsApp.</p>

      <label>
        Restaurant name
        <input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} />
      </label>
      <label>
        Menu photo URL
        <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
      </label>
      <label>
        Who's uploading?
        <select value={role} onChange={(e) => setRole(e.target.value as 'DINER' | 'RESTAURANT')}>
          <option value="DINER">Just a diner — I don't have this restaurant's menu online</option>
          <option value="RESTAURANT">I'm the restaurant</option>
        </select>
      </label>

      {error && <p className="page-error">{error}</p>}
      <button disabled={loading || !restaurantName || !imageUrl} onClick={submit}>
        {loading ? 'Reading the menu…' : 'Digitize menu'}
      </button>
    </div>
  );
}
