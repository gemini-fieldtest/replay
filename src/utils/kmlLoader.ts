export interface GeoCoordinate {
  latitude: number;
  longitude: number;
  altitude: number;
}

export const loadKML = async (url: string): Promise<GeoCoordinate[]> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch KML: ${response.statusText}`);
    }
    const text = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');

    const coordinates = [];
    const placemarks = xmlDoc.getElementsByTagName('Placemark');

    for (let i = 0; i < placemarks.length; i++) {
        const lineStrings = placemarks[i].getElementsByTagName('LineString');
        if (lineStrings.length > 0) {
            const coordNode = lineStrings[0].getElementsByTagName('coordinates')[0];
            if (coordNode && coordNode.textContent) {
                const coordText = coordNode.textContent.trim();
                const coordPairs = coordText.split(/\s+/);
                
                for (const pair of coordPairs) {
                    const [lon, lat, alt] = pair.split(',').map(parseFloat);
                    if (!isNaN(lat) && !isNaN(lon)) {
                         coordinates.push({
                            latitude: lat,
                            longitude: lon,
                            altitude: alt || 0
                        });
                    }
                }
            }
        }
    }

    return coordinates;
  } catch (error) {
    console.error('Error loading KML:', error);
    return [];
  }
};
