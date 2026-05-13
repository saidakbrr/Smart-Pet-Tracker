import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, onValue, ref } from 'firebase/database';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type TrackerData = {
  accel_delta?: number;
  aktivitas?: string;
  gps_valid?: boolean;
  home_lat?: number;
  home_lon?: number;
  jarak?: number;
  latitude?: number;
  longitude?: number;
  radius?: number;
  status_geofence?: string;
  updated_at?: string;
};

const firebaseConfig = {
  apiKey: "AIzaSyApJako7bLyWbtkzXQ4TR8bUc0Vk_EgeUs",
  authDomain: "smart-pet-tracker-71673.firebaseapp.com",
  databaseURL: "https://smart-pet-tracker-71673-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smart-pet-tracker-71673",
  storageBucket: "smart-pet-tracker-71673.firebasestorage.app",
  messagingSenderId: "93781321361",
  appId: "1:93781321361:web:dd874ed1dbe41e97d1c130",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

async function prepareNotifications() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('tracker-alerts', {
        name: 'Tracker Alerts',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const settings = await Notifications.getPermissionsAsync();
    if (!settings.granted) {
      await Notifications.requestPermissionsAsync();
    }
  } catch (error) {
    console.log('Notif init error:', error);
  }
}

async function sendLocalNotification(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: null,
    });
  } catch (error) {
    console.log('Notif send error:', error);
  }
}

function safeNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeText(value: unknown, fallback = '-') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function createMapHtml({
  homeLat,
  homeLon,
  petLat,
  petLon,
  radius,
  gpsValid,
  status,
}: {
  homeLat: number;
  homeLon: number;
  petLat: number;
  petLon: number;
  radius: number;
  gpsValid: boolean;
  status: string;
}) {
  const safeHomeLat = Number.isFinite(homeLat) ? homeLat : 0;
  const safeHomeLon = Number.isFinite(homeLon) ? homeLon : 0;
  const safePetLat = Number.isFinite(petLat) ? petLat : 0;
  const safePetLon = Number.isFinite(petLon) ? petLon : 0;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 10;
  const centerLat = gpsValid && safePetLat !== 0 ? safePetLat : safeHomeLat;
  const centerLon = gpsValid && safePetLon !== 0 ? safePetLon : safeHomeLon;
  const showPetMarker = gpsValid && safePetLat !== 0 && safePetLon !== 0;

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { height: 100%; margin: 0; padding: 0; }
      body { background: #ffffff; }
      .leaflet-container { font-family: Arial, sans-serif; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const map = L.map('map', { zoomControl: true }).setView([${centerLat}, ${centerLon}], 17);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }).addTo(map);

      const homeMarker = L.marker([${safeHomeLat}, ${safeHomeLon}], {
      icon: L.icon({
    iconUrl: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png',
    iconSize: [32, 32],
      })
      }).addTo(map);
      homeMarker.bindPopup('Rumah');

      L.circle([${safeHomeLat}, ${safeHomeLon}], {
        radius: ${safeRadius},
        color: '#16a34a',
        fillColor: '#22c55e',
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(map);

      ${showPetMarker ? `
      const petMarker = L.marker([${safePetLat}, ${safePetLon}], {
    icon: L.icon({
    iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
    iconSize: [32, 32],
    })
      }).addTo(map);
    petMarker.bindPopup('Hewan');
      ` : ''}
    </script>
  </body>
</html>`;
}

export default function Index() {
  const [tracker, setTracker] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lastGeofenceRef = useRef<string | null>(null);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    prepareNotifications();

    const trackerRef = ref(db, 'tracker');

    const unsubscribe = onValue(
      trackerRef,
      async (snapshot) => {
        try {
          const value = snapshot.val();

          if (!value || typeof value !== 'object') {
            setTracker(null);
            setLoading(false);
            setError('Data tracker belum ada di Firebase.');
            return;
          }

          const nextData: TrackerData = {
            accel_delta: safeNumber(value.accel_delta),
            aktivitas: safeText(value.aktivitas, 'DIAM'),
            gps_valid: Boolean(value.gps_valid),
            home_lat: safeNumber(value.home_lat),
            home_lon: safeNumber(value.home_lon),
            jarak:
              typeof value.jarak === 'number' && Number.isFinite(value.jarak)
                ? value.jarak
                : -1,
            latitude: safeNumber(value.latitude),
            longitude: safeNumber(value.longitude),
            radius: safeNumber(value.radius, 10),
            status_geofence: safeText(value.status_geofence, 'AMAN'),
            updated_at: safeText(value.updated_at, '-'),
          };

          setTracker(nextData);
          setError(null);
          setLoading(false);

          const geofence = nextData.status_geofence ?? 'AMAN';

          if (firstLoadRef.current) {
            lastGeofenceRef.current = geofence;
            firstLoadRef.current = false;
            return;
          }

          if (lastGeofenceRef.current !== geofence) {
            if (geofence === 'HEWAN_KELUAR') {
              await sendLocalNotification('Peringatan Geofence', 'Hewan keluar rumah');
            }
            lastGeofenceRef.current = geofence;
          }
        } catch (e) {
          console.log('Read snapshot error:', e);
          setError('Gagal membaca data realtime.');
          setLoading(false);
        }
      },
      (firebaseError) => {
        console.log('Firebase listener error:', firebaseError);
        setError(firebaseError?.message || 'Koneksi ke Firebase gagal.');
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const geofenceColor = useMemo(() => {
    return tracker?.status_geofence === 'HEWAN_KELUAR' ? '#ffdddd' : '#ddffea';
  }, [tracker?.status_geofence]);

  const activityColor = useMemo(() => {
    return tracker?.aktivitas === 'AKTIF' ? '#fff3d6' : '#e8f0ff';
  }, [tracker?.aktivitas]);

  const canShowMap = useMemo(() => {
    const homeLat = safeNumber(tracker?.home_lat, 0);
    const homeLon = safeNumber(tracker?.home_lon, 0);
    return homeLat !== 0 && homeLon !== 0;
  }, [tracker?.home_lat, tracker?.home_lon]);

  const mapHtml = useMemo(() => {
    if (!tracker || !canShowMap) return '';

    return createMapHtml({
      homeLat: safeNumber(tracker.home_lat, 0),
      homeLon: safeNumber(tracker.home_lon, 0),
      petLat: safeNumber(tracker.latitude, 0),
      petLon: safeNumber(tracker.longitude, 0),
      radius: safeNumber(tracker.radius, 10),
      gpsValid: Boolean(tracker.gps_valid),
      status: safeText(tracker.status_geofence, 'AMAN'),
    });
  }, [tracker, canShowMap]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centerWrap}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Menghubungkan ke Smart Pet Tracker...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>SMART PET TRACKER</Text>

        {error ? (
          <View style={[styles.card, styles.errorCard]}>
            <Text style={styles.cardTitle}>Status</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: geofenceColor }]}> 
          <Text style={styles.cardTitle}>Geofence</Text>
          <Text style={styles.bigValue}>{tracker?.status_geofence ?? '-'}</Text>
          <Text style={styles.smallText}>Radius aman: {safeNumber(tracker?.radius, 0)} meter</Text>
          <Text style={styles.smallText}>
            Jarak dari rumah:{' '}
            {typeof tracker?.jarak === 'number' && tracker.jarak >= 0
              ? `${tracker.jarak.toFixed(2)} meter`
              : 'GPS belum valid'}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: activityColor }]}>
          <Text style={styles.cardTitle}>Deteksi Aktivitas</Text>
          <Text style={styles.bigValue}>{tracker?.aktivitas ?? '-'}</Text>
          </View>
        

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Lokasi Tracker</Text>
          <Row label="GPS Valid" value={tracker?.gps_valid ? 'Ya' : 'Tidak'} />

          {canShowMap ? (
            <View style={styles.mapWrap}>
              <WebView
                key={tracker?.updated_at ?? 'map'}
                originWhitelist={['*']}
                source={{ html: mapHtml }}
                style={styles.map}
                javaScriptEnabled
                domStorageEnabled
                cacheEnabled={false}
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.mapLoading}>
                    <ActivityIndicator size="small" />
                    <Text style={styles.mapLoadingText}>Memuat peta...</Text>
                  </View>
                )}
              />
            </View>
          ) : (
            <Text style={styles.smallText}>Map belum bisa ditampilkan karena koordinat rumah belum valid.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Update Terakhir</Text>
          <Text style={styles.bigValueSmall}>{safeText(tracker?.updated_at, '-')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  centerWrap: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#ffffff',
    fontSize: 16,
  },
  content: {
    padding: 18,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 12,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: 14,
    color: '#cbd5e1',
    marginBottom: 18,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  errorCard: {
    backgroundColor: '#3b0d0d',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  errorText: {
    color: '#fecaca',
    fontSize: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  bigValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  bigValueSmall: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  smallText: {
    fontSize: 14,
    color: '#334155',
    marginTop: 4,
  },
  mapWrap: {
    marginTop: 14,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    height: 260,
  },
  map: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  mapLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  mapLoadingText: {
    marginTop: 8,
    color: '#334155',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  rowLabel: {
    fontSize: 14,
    color: '#475569',
    flex: 1,
  },
  rowValue: {
    fontSize: 14,
    color: '#0f172a',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
});
