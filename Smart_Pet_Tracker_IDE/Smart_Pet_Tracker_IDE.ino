#include <WiFi.h>
#include <TinyGPSPlus.h>
#include <Wire.h>
#include <MPU6050.h>
#include <Firebase_ESP_Client.h>
#include <time.h>
#include <math.h>
#include <ArduinoJson.h>

// ======================
// WIFI
// ======================
#define WIFI_COUNT 3

const char* WIFI_SSID[WIFI_COUNT] = {
  "Dhayf",
  "Said",
  "FIKTI_KORIDOR"
};

const char* WIFI_PASS[WIFI_COUNT] = {
  "16092004",
  "123456789",
  "#fiktiunggul"
};

// ======================
// FIREBASE
// ======================
#define API_KEY "AIzaSyApJako7bLyWbtkzXQ4TR8bUc0Vk_EgeUs"
#define DATABASE_URL "https://smart-pet-tracker-71673-default-rtdb.asia-southeast1.firebasedatabase.app/"

// ======================
// PIN ESP32-C3
// ======================
#define GPS_RX_PIN 5
#define GPS_TX_PIN 4
#define I2C_SDA_PIN 6
#define I2C_SCL_PIN 7

// ======================
// SIM800L
// ======================
#define SIM800_RX_PIN 20
#define SIM800_TX_PIN 21
const char* PHONE_NUMBER = "+628116711609";

HardwareSerial sim800Serial(0);
bool sim800Ready = false;

// ======================
// GEOFENCE
// ======================
#define HOME_LAT 3.513021
#define HOME_LON 98.667547
#define GEOFENCE_RADIUS 10.0

// ======================
// INTERVAL
// ======================
unsigned long lastSend = 0;
const unsigned long sendInterval = 3000;

unsigned long lastSmsSent = 0;
const unsigned long smsInterval = 30000; // 1 menit

unsigned long lastWiFiCheck = 0;
const unsigned long wifiCheckInterval = 10000;

// ======================
// FIREBASE
// ======================
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
bool firebaseReady = false;

// ======================
// GPS
// ======================
TinyGPSPlus gps;
HardwareSerial gpsSerial(1);

// simpan koordinat terakhir yang valid
bool lastGpsValid = false;
double lastLatitude = 0.0;
double lastLongitude = 0.0;
double lastJarak = 0.0;

// ======================
// MPU6050
// ======================
MPU6050 mpu;

// ======================
// SENSOR VAR
// ======================
int16_t ax, ay, az;
float axf = 0, ayf = 0, azf = 0;
float accel = 0;
float prevAccel = 0;
float delta = 0;

String aktivitasHewan = "DIAM";
String statusGeofence = "AMAN";

// ======================
// HITUNG JARAK
// ======================
double hitungJarak(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000.0;

  double dLat = (lat2 - lat1) * PI / 180.0;
  double dLon = (lon2 - lon1) * PI / 180.0;

  lat1 = lat1 * PI / 180.0;
  lat2 = lat2 * PI / 180.0;

  double a = sin(dLat / 2) * sin(dLat / 2) +
             cos(lat1) * cos(lat2) *
             sin(dLon / 2) * sin(dLon / 2);

  double c = 2 * atan2(sqrt(a), sqrt(1 - a));

  return R * c;
}

// ======================
// FORMAT WAKTU
// ======================
String getFormattedTime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "Waktu belum sinkron";
  }

  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
  return String(buf);
}

// ======================
// WIFI
// ======================
void connectWiFi() {
  Serial.println("Mencari WiFi...");

  for (int i = 0; i < WIFI_COUNT; i++) {
    WiFi.disconnect(true);
    delay(500);

    Serial.print("Mencoba WiFi: ");
    Serial.println(WIFI_SSID[i]);

    WiFi.begin(WIFI_SSID[i], WIFI_PASS[i]);

    int attempt = 0;
    while (WiFi.status() != WL_CONNECTED && attempt < 20) {
      delay(500);
      Serial.print(".");
      attempt++;
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println();
      Serial.println("WiFi terhubung");
      Serial.print("IP Address: ");
      Serial.println(WiFi.localIP());
      return;
    }

    Serial.println();
    Serial.println("Gagal, lanjut WiFi berikutnya...");
  }

  Serial.println("Tidak ada WiFi yang berhasil terhubung");
}

// ======================
// SIM800L
// ======================
bool cekSIM800() {
  sim800Serial.println("AT");
  delay(1000);

  String resp = "";
  while (sim800Serial.available()) {
    resp += (char)sim800Serial.read();
  }

  return resp.indexOf("OK") != -1;
}

void initSIM800() {
  sim800Serial.begin(9600, SERIAL_8N1, SIM800_RX_PIN, SIM800_TX_PIN);
  delay(3000);

  sim800Ready = cekSIM800();

  if (sim800Ready) {
    Serial.println("SIM800L siap");
    sim800Serial.println("AT+CMGF=1");
    delay(500);
  } else {
    Serial.println("SIM800L tidak merespons");
  }
}

void kirimSMS(String pesan) {
  if (!sim800Ready) {
    Serial.println("SIM800L belum siap, SMS batal");
    return;
  }

  Serial.println("Mengirim SMS...");
  sim800Serial.println("AT+CMGF=1");
  delay(500);

  sim800Serial.print("AT+CMGS=\"");
  sim800Serial.print(PHONE_NUMBER);
  sim800Serial.println("\"");
  delay(1000);

  sim800Serial.print(pesan);
  delay(500);

  sim800Serial.write(26); // CTRL+Z
  delay(5000);

  String resp = "";
  while (sim800Serial.available()) {
    resp += (char)sim800Serial.read();
  }

  Serial.println("RESP SMS:");
  Serial.println(resp);

  if (resp.indexOf("+CMGS") != -1) {
    Serial.println("SMS berhasil dikirim");
  } else {
    Serial.println("SMS kemungkinan gagal");
  }
}

void kirimDataViaSMS(bool gpsValid, double latitude, double longitude, double jarak) {
  // Hapus pengecekan interval waktu jika ingin SMS dikirim terus menerus
  String pesan = "Pet Tracker OFFLINE\n";
  pesan += "Aktivitas: " + aktivitasHewan + "\n";
  pesan += "Status: " + statusGeofence + "\n";
  pesan += "Delta: " + String(delta, 2) + "\n";

  if (gpsValid) {
    pesan += "Lat: " + String(latitude, 6) + "\n";
    pesan += "Lon: " + String(longitude, 6) + "\n";
    pesan += "Jarak: " + String(jarak, 1) + "m\n";
    pesan += "Maps: https://maps.google.com/?q=" + String(latitude, 6) + "," + String(longitude, 6) + "\n";
  } else if (lastGpsValid) {
    pesan += "Lat terakhir: " + String(lastLatitude, 6) + "\n";
    pesan += "Lon terakhir: " + String(lastLongitude, 6) + "\n";
    pesan += "Jarak terakhir: " + String(lastJarak, 1) + "m\n";
    pesan += "Maps: https://maps.google.com/?q=" + String(lastLatitude, 6) + "," + String(lastLongitude, 6) + "\n";
  } else {
    pesan += "GPS: belum valid\n";
  }

  pesan += "Waktu: " + getFormattedTime();

  kirimSMS(pesan);  // Mengirim SMS tanpa interval pembatasan
  lastSmsSent = millis();  // Menyimpan waktu pengiriman SMS terakhir
}

// ======================
// FIREBASE
// ======================
void kirimKeFirebase(bool gpsValid, double latitude, double longitude, double jarak) {
  if (!firebaseReady) {
    Serial.println("Firebase belum siap, skip kirim Firebase");
    return;
  }

  FirebaseJson json;
  json.set("aktivitas", aktivitasHewan);
  json.set("status_geofence", statusGeofence);
  json.set("accel_delta", delta);
  json.set("gps_valid", gpsValid);
  json.set("updated_at", getFormattedTime());
  json.set("home_lat", HOME_LAT);
  json.set("home_lon", HOME_LON);
  json.set("radius", GEOFENCE_RADIUS);

  if (gpsValid) {
    json.set("latitude", latitude);
    json.set("longitude", longitude);
    json.set("jarak", jarak);
  } else if (lastGpsValid) {
    json.set("latitude", lastLatitude);
    json.set("longitude", lastLongitude);
    json.set("jarak", lastJarak);
  } else {
    json.set("latitude", 0.0);
    json.set("longitude", 0.0);
    json.set("jarak", -1.0);
  }

  bool ok = Firebase.RTDB.setJSON(&fbdo, "tracker", &json);

  if (ok) {
    Serial.println("Firebase update berhasil");
  } else {
    Serial.print("Firebase update gagal: ");
    Serial.println(fbdo.errorReason());
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("Booting ESP32-C3 Smart Pet Tracker...");

  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  mpu.initialize();

  if (mpu.testConnection()) {
    Serial.println("MPU6050 terhubung");
  } else {
    Serial.println("MPU6050 gagal terhubung");
  }

  initSIM800();

  WiFi.mode(WIFI_STA);
  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");

    Serial.print("Sinkronisasi waktu");
    time_t now = time(nullptr);
    int retry = 0;
    while (now < 100000 && retry < 20) {
      Serial.print(".");
      delay(500);
      now = time(nullptr);
      retry++;
    }
    Serial.println();
  }

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  if (WiFi.status() == WL_CONNECTED) {
    if (Firebase.signUp(&config, &auth, "", "")) {
      Serial.println("Firebase signup berhasil");
      firebaseReady = true;
    } else {
      Serial.print("Firebase signup gagal: ");
      Serial.println(config.signer.signupError.message.c_str());
      firebaseReady = false;
    }

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
  } else {
    Serial.println("Boot tanpa WiFi, Firebase dilewati");
    firebaseReady = false;
  }
}

void loop() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (millis() - lastWiFiCheck >= wifiCheckInterval) {
    lastWiFiCheck = millis();

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi putus, reconnect...");
      connectWiFi();

      if (WiFi.status() == WL_CONNECTED && !firebaseReady) {
        config.api_key = API_KEY;
        config.database_url = DATABASE_URL;

        if (Firebase.signUp(&config, &auth, "", "")) {
          Serial.println("Firebase signup ulang berhasil");
          firebaseReady = true;
        } else {
          Serial.print("Firebase signup ulang gagal: ");
          Serial.println(config.signer.signupError.message.c_str());
        }

        Firebase.begin(&config, &auth);
        Firebase.reconnectWiFi(true);
      }
    }
  }

  if (millis() - lastSend >= sendInterval) {
    lastSend = millis();

    mpu.getAcceleration(&ax, &ay, &az);

    axf = ax / 16384.0;
    ayf = ay / 16384.0;
    azf = az / 16384.0;

    accel = sqrt(axf * axf + ayf * ayf + azf * azf);
    delta = fabs(accel - prevAccel);
    prevAccel = accel;

    aktivitasHewan = (delta < 0.05) ? "DIAM" : "JALAN";

    bool gpsValid = false;
    double latitude = 0.0;
    double longitude = 0.0;
    double jarak = 0.0;

    if (gps.location.isValid()) {
      gpsValid = true;
      latitude = gps.location.lat();
      longitude = gps.location.lng();
      jarak = hitungJarak(HOME_LAT, HOME_LON, latitude, longitude);

      lastGpsValid = true;
      lastLatitude = latitude;
      lastLongitude = longitude;
      lastJarak = jarak;

      statusGeofence = (jarak <= GEOFENCE_RADIUS) ? "AMAN" : "HEWAN_KELUAR";
    } else {
      statusGeofence = "AMAN";
    }

    if (WiFi.status() == WL_CONNECTED) {
      kirimKeFirebase(gpsValid, latitude, longitude, jarak);
    } else {
      kirimDataViaSMS(gpsValid, latitude, longitude, jarak);
    }

    Serial.println("===== DATA TRACKER ESP32-C3 =====");
    Serial.print("Aktivitas     : ");
    Serial.println(aktivitasHewan);
    Serial.print("Status        : ");
    Serial.println(statusGeofence);
    Serial.print("Delta Acc     : ");
    Serial.println(delta, 4);

    if (gpsValid) {
      Serial.print("Latitude      : ");
      Serial.println(latitude, 6);
      Serial.print("Longitude     : ");
      Serial.println(longitude, 6);
      Serial.print("Jarak Home    : ");
      Serial.print(jarak);
      Serial.println(" meter");
    } else if (lastGpsValid) {
      Serial.println("GPS sekarang belum valid, pakai koordinat terakhir");
      Serial.print("Last Latitude : ");
      Serial.println(lastLatitude, 6);
      Serial.print("Last Longitude: ");
      Serial.println(lastLongitude, 6);
    } else {
      Serial.println("GPS           : Belum valid");
    }

    Serial.print("Updated At    : ");
    Serial.println(getFormattedTime());

    Serial.print("Mode Kirim    : ");
    Serial.println(WiFi.status() == WL_CONNECTED ? "Firebase (WiFi)" : "SMS (SIM800L)");
    Serial.println("=================================");
  }
}