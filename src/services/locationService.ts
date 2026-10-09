export interface GeoLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

export function getCurrentLocation(): Promise<GeoLocation> {
  if (!('geolocation' in navigator)) {
    return Promise.reject(new Error('Geolocation is not supported by this browser.'));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy,
      }),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      },
    );
  });
}

export function watchCurrentLocation(
  onLocation: (location: GeoLocation) => void,
  onError?: (error: GeolocationPositionError | Error) => void,
): () => void {
  if (!('geolocation' in navigator)) {
    onError?.(new Error('Geolocation is not supported by this browser.'));
    return () => undefined;
  }

  const watchId = navigator.geolocation.watchPosition(
    ({ coords }) => onLocation({
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy,
    }),
    (error) => onError?.(error),
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 5000,
    },
  );

  return () => navigator.geolocation.clearWatch(watchId);
}
