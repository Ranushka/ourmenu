import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, Menu } from '../lib/api';
import { loadDinerProfile, saveDinerProfile } from '../lib/dinerProfile';
import { UploadPage } from './UploadPage';

type ViewMode = 'list' | 'grid';
type VegFilter = 'all' | 'veg';

interface CartLine {
  quantity: number;
  note: string;
}

export function MenuPage() {
  const { slug = '' } = useParams();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  const [vegFilter, setVegFilter] = useState<VegFilter>('all');
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [showCheckout, setShowCheckout] = useState(false);
  const [profile, setProfile] = useState(loadDinerProfile());
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function load() {
      api
        .getMenu(slug)
        .then((m) => {
          if (cancelled) return;
          setMenu(m);
          // A long menu keeps parsing after the first page-chunk -- poll
          // for more items landing until the background parse finishes.
          if (m.status === 'processing') timer = setTimeout(load, 5000);
        })
        .catch((e) => {
          if (cancelled) return;
          // The slug is a WhatsApp number now -- if nothing's been
          // uploaded for it yet, let whoever landed here upload it
          // themselves instead of hitting a dead end.
          if (e instanceof ApiError && e.status === 404) setNotFound(true);
          else setError(e.message);
        });
    }
    load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug]);

  const items = useMemo(() => {
    if (!menu) return [];
    return menu.items.filter((item) => {
      if (!item.isAvailable) return false;
      if (vegFilter === 'veg' && item.isVeg !== true) return false;
      if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [menu, search, vegFilter]);

  const cartCount = Object.values(cart).reduce((sum, l) => sum + l.quantity, 0);

  function setQuantity(itemId: string, quantity: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[itemId];
      else next[itemId] = { quantity, note: prev[itemId]?.note ?? '' };
      return next;
    });
  }

  function setNote(itemId: string, note: string) {
    setCart((prev) => (prev[itemId] ? { ...prev, [itemId]: { ...prev[itemId], note } } : prev));
  }

  async function orderNow() {
    if (!menu) return;
    setPlacing(true);
    try {
      saveDinerProfile(profile);
      const { whatsappLink } = await api.placeOrder({
        menuSlug: menu.slug,
        items: Object.entries(cart).map(([menuItemId, l]) => ({
          menuItemId,
          quantity: l.quantity,
          note: l.note || undefined,
        })),
        address: profile.address,
        preferences: profile.preferences,
        phone: profile.phone,
        name: profile.name,
      });
      window.location.href = whatsappLink;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlacing(false);
    }
  }

  if (notFound) return <UploadPage initialWhatsapp={/^\d+$/.test(slug) ? `+${slug}` : undefined} />;
  if (error) return <div className="page-error">{error}</div>;
  if (!menu) return <div className="page-loading">Loading menu…</div>;

  return (
    <div className="menu-page">
      <header className="menu-header">
        <h1>{menu.restaurantName}</h1>
        {menu.status === 'processing' && <p className="field-hint">Still reading through the rest of this menu — more items may appear shortly.</p>}
        <div className="menu-controls">
          <input
            className="search-input"
            placeholder="Search the menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="control-row">
            <button className={vegFilter === 'veg' ? 'active' : ''} onClick={() => setVegFilter(vegFilter === 'veg' ? 'all' : 'veg')}>
              🌱 Veg only
            </button>
            <button onClick={() => setView(view === 'list' ? 'grid' : 'list')}>
              {view === 'list' ? '⊞ Grid view' : '☰ List view'}
            </button>
          </div>
        </div>
      </header>

      <div className={`item-container ${view}`}>
        {items.map((item) => (
          <div key={item.id} className="item-card">
            {item.photoUrl && <img src={item.photoUrl} alt={item.name} className="item-photo" />}
            <div className="item-info">
              <div className="item-title-row">
                <span className="item-name">
                  {item.isVeg === true && '🌱 '}
                  {item.name}
                </span>
                <span className="item-price">
                  {item.currency} {item.price}
                </span>
              </div>
              {item.description && <p className="item-desc">{item.description}</p>}
              <div className="item-qty">
                <button onClick={() => setQuantity(item.id, (cart[item.id]?.quantity ?? 0) - 1)}>-</button>
                <span>{cart[item.id]?.quantity ?? 0}</span>
                <button onClick={() => setQuantity(item.id, (cart[item.id]?.quantity ?? 0) + 1)}>+</button>
              </div>
              {cart[item.id] && (
                <input
                  className="item-note"
                  placeholder="Preference for this item (e.g. no sauce)"
                  value={cart[item.id].note}
                  onChange={(e) => setNote(item.id, e.target.value)}
                />
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="no-results">No items match.</p>}
      </div>

      {cartCount > 0 && (
        <div className="cart-bar">
          {!showCheckout ? (
            <button className="cart-bar-summary" onClick={() => setShowCheckout(true)}>
              {cartCount} item{cartCount > 1 ? 's' : ''} — Order now
            </button>
          ) : (
            <div className="checkout-panel">
              <label>
                Address
                <input value={profile.address ?? ''} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
              </label>
              <label>
                Preferences (no sauce, fully cooked, etc.)
                <input value={profile.preferences ?? ''} onChange={(e) => setProfile({ ...profile, preferences: e.target.value })} />
              </label>
              <label>
                Your WhatsApp number
                <input value={profile.phone ?? ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
              </label>
              <div className="checkout-actions">
                <button onClick={() => setShowCheckout(false)}>Back</button>
                <button disabled={placing} onClick={orderNow}>
                  {placing ? 'Sending…' : 'Send order on WhatsApp'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
