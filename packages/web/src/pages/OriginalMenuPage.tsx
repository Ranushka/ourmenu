import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, Menu } from '../lib/api';

/**
 * The real menu, as uploaded -- every page, in order, exactly as printed
 * (photos, layout, sections a parser might get wrong or skip). The
 * searchable/orderable list on the main menu page is built from parsed
 * data and won't always be perfect; this is the fallback a diner can
 * check against, or just prefers to browse directly.
 */
export function OriginalMenuPage() {
  const { slug = '' } = useParams();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMenu(slug).then(setMenu).catch((e) => setError(e.message));
  }, [slug]);

  if (error) return <div className="page-error">{error}</div>;
  if (!menu) return <div className="page-loading">Loading…</div>;

  return (
    <div className="original-menu-page">
      <header className="menu-header">
        <h1>{menu.restaurantName}</h1>
        <Link to={`/m/${menu.slug}`}>← Back to searchable menu</Link>
      </header>
      <div className="original-menu-pages">
        {menu.sourceImageUrls.map((url, i) => (
          <img key={url} src={url} alt={`Menu page ${i + 1}`} className="original-menu-page-image" />
        ))}
        {menu.sourceImageUrls.length === 0 && <p className="no-results">No original pages available.</p>}
      </div>
    </div>
  );
}
