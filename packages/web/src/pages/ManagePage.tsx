import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, Menu } from '../lib/api';

/** Restaurant-side manage view, reached only via the private manageToken link. */
export function ManagePage() {
  const { manageToken = '' } = useParams();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState('');

  function reload() {
    api.getManageMenu(manageToken).then(setMenu).catch((e) => setError(e.message));
  }

  useEffect(reload, [manageToken]);

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

  async function claim() {
    if (!whatsapp) return;
    await api.claimMenu(manageToken, whatsapp);
    reload();
  }

  if (error) return <div className="page-error">{error}</div>;
  if (!menu) return <div className="page-loading">Loading…</div>;

  return (
    <div className="manage-page">
      <h1>Manage: {menu.restaurantName}</h1>

      {!menu.restaurantWhatsapp ? (
        <div className="claim-box">
          <p>Orders placed on this menu will be sent to your WhatsApp. Set the number to receive them:</p>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+9715XXXXXXXX" />
          <button onClick={claim}>Save</button>
        </div>
      ) : (
        <p>Orders go to WhatsApp: {menu.restaurantWhatsapp}</p>
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
