export interface SharedPlace { name: string; address: string; area: string; lat: number; lng: number }

/** The message sent for a place: its name, address and an OpenStreetMap link. Never the sender's own position. */
export const placeMessage = (p: SharedPlace): string => {
  const where = [p.address, p.area].filter(Boolean).join(', ');
  const link = `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(5)}&mlon=${p.lng.toFixed(5)}#map=18/${p.lat.toFixed(5)}/${p.lng.toFixed(5)}`;
  return `${p.name}${where ? `\n${where}` : ''}\n${link}`;
};

