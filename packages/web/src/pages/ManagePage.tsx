import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, Menu } from '../lib/api';

/**
 * Restaurant-side manage view, reached only via the private manageToken
 * link. The restaurant name and WhatsApp number are already set from
 * upload time (parsed from the menu / entered by whoever uploaded it) —
 * this is for corrections, not initial setup.
 */
export function ManagePage() {
  const { manageToken = '' } = useParams();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingDetails, setEditingDetails] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [whatsappDraft, setWhatsappDraft] = useState('');

  function reload() {
    return api
      .getManageMenu(manageToken)
      .then((m) => {
        setMenu(m);
        setNameDraft(m.restaurantName);
        setWhatsappDraft(m.restaurantWhatsapp);
        return m;
      })
      .catch((e) => {
        setError(e.message);
        return null;
      });
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // A long menu keeps parsing after the first page-chunk -- poll for
    // more items landing until the background parse finishes.
    function poll() {
      reload().then((m) => {
        if (!cancelled && m?.status === 'processing') timer = setTimeout(poll, 5000);
      });
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageToken]);

  async function toggleAvailable(itemId: string, isAvailable: boolean) {
    await api.updateItem(manageToken, itemId, { isAvailable: !isAvailable });
    reload();
  }

  async function updatePhoto(itemId: string) {
    const photoUrl = prompt('Photo URL (illustration purposes only):');
    if (photoUrl === null) return;
    await api.updateItem(manageToken, itemId, { photoUrl });
    reload();
  }

  async function saveDetails() {
    await api.updateMenu(manageToken, { restaurantName: nameDraft, restaurantWhatsapp: whatsappDraft });
    setEditingDetails(false);
    reload();
  }

  if (error) return <div className="page-error">{error}</div>;
  if (!menu) return <div className="page-loading">Loading…</div>;

  return (
    <div className="manage-page">
      <h1>Manage: {menu.restaurantName}</h1>

      <p className="manage-diner-link">
        Diner link (share this one): <a href={`/m/${menu.slug}`}>{window.location.origin}/m/{menu.slug}</a>
      </p>
      {menu.status === 'processing' && (
        <p className="field-hint">
          Still reading through this menu{menu.totalPages ? ` — page ${menu.pagesRead ?? 0} of ${menu.totalPages}` : ''} — more items will appear here shortly.
        </p>
      )}
      {menu.status === 'failed' && <p className="page-error">Some pages of this menu failed to parse. What's below is what we could read.</p>}
      {menu.status === 'ready' && menu.parseError && (
        <p className="page-error">A couple of pages didn't parse cleanly — what's below is what we could read from the rest.</p>
      )}

      {!editingDetails ? (
        <p className="manage-details-row">
          Orders go to WhatsApp: {menu.restaurantWhatsapp}{' '}
          <button onClick={() => setEditingDetails(true)}>Fix name / number</button>
        </p>
      ) : (
        <div className="manage-details-edit">
          <label>
            Restaurant name
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
          </label>
          <label>
            WhatsApp number orders go to
            <input value={whatsappDraft} onChange={(e) => setWhatsappDraft(e.target.value)} placeholder="+9715XXXXXXXX" />
          </label>
          <div className="checkout-actions">
            <button onClick={() => setEditingDetails(false)}>Cancel</button>
            <button onClick={saveDetails}>Save</button>
          </div>
        </div>
      )}

      <div className="manage-table-scroll">
        <table className="manage-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Price</th>
              <th>Available</th>
              <th>Photo</th>
            </tr>
          </thead>
          <tbody>
            {menu.items.map((item) => (
              <tr key={item.id} className={item.isAvailable ? '' : 'unavailable'}>
                <td>{item.name}</td>
                <td>
                  {item.currency} {item.price}
                </td>
                <td>
                  <button onClick={() => toggleAvailable(item.id, item.isAvailable)}>
                    {item.isAvailable ? 'Available' : 'Sold out'}
                  </button>
                </td>
                <td>
                  <button onClick={() => updatePhoto(item.id)}>{item.photoUrl ? 'Change photo' : 'Add photo'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
