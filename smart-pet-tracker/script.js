// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    databaseURL: "https://smart-pet-tracker-71673-default-rtdb.asia-southeast1.firebasedatabase.app/",
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database(app);

// Get data from Firebase
const latitudeRef = db.ref('tracker/latitude');
const longitudeRef = db.ref('tracker/longitude');
const motionRef = db.ref('tracker/motion');
const statusRef = db.ref('tracker/status');

// Update UI with data from Firebase
latitudeRef.on('value', (snapshot) => {
    document.getElementById('latitude').innerText = snapshot.val();
});

longitudeRef.on('value', (snapshot) => {
    document.getElementById('longitude').innerText = snapshot.val();
});

motionRef.on('value', (snapshot) => {
    document.getElementById('motion').innerText = snapshot.val();
});

statusRef.on('value', (snapshot) => {
    document.getElementById('status').innerText = snapshot.val();
});

// Initialize map
const map = L.map('map').setView([3.52151, 98.66684], 13);

// Set up map tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Update map with pet location
latitudeRef.on('value', (latSnapshot) => {
    longitudeRef.on('value', (lonSnapshot) => {
        const lat = latSnapshot.val();
        const lon = lonSnapshot.val();

        const petLocation = [lat, lon];
        L.marker(petLocation).addTo(map)
            .bindPopup('Pet Location')
            .openPopup();

        map.setView(petLocation, 13);
    });
});